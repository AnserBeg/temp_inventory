import { ensureDatabase, first, getD1 } from "./inventory-db";
import { qboConfig } from "./qbo-client";
import { constantTimeEqual, hmacSha256Base64, sha256Hex } from "./qbo-crypto";
import { recordQboExternalConflict } from "./qbo-sync";

type Row = Record<string, unknown>;
const MAX_WEBHOOK_BYTES = 1024 * 1024;

type NormalizedEntity = { name: string; id: string; operation: string; lastUpdated: string };
type NormalizedNotification = { realmId: string; lastUpdated: string; entities: NormalizedEntity[] };

const cloudEntityNames: Record<string, string> = {
  account: "Account", bill: "Bill", billpayment: "BillPayment", creditmemo: "CreditMemo", customer: "Customer",
  invoice: "Invoice", item: "Item", journalentry: "JournalEntry", payment: "Payment", paymentmethod: "PaymentMethod",
  purchaseorder: "PurchaseOrder", taxcode: "TaxCode", term: "Term", vendor: "Vendor", vendorcredit: "VendorCredit",
};

function titleCase(value: string) {
  return value.split(/[-_]/u).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("");
}

export function normalizeQboWebhookPayload(payload: unknown): NormalizedNotification[] {
  if (payload && !Array.isArray(payload) && typeof payload === "object") {
    const legacy = payload as Row;
    if (Array.isArray(legacy.eventNotifications)) {
      return (legacy.eventNotifications as Row[]).flatMap((notification) => {
        const realmId = String(notification.realmId ?? "").trim();
        const change = notification.dataChangeEvent as Row | undefined;
        const lastUpdated = String(change?.lastUpdated ?? new Date().toISOString());
        if (!realmId) return [];
        const entities = Array.isArray(change?.entities) ? (change.entities as Row[]).flatMap((entity) => {
          const name = String(entity.name ?? "").trim();
          const id = String(entity.id ?? "").trim();
          return name && id ? [{ name, id, operation: String(entity.operation ?? "Update"), lastUpdated: String(entity.lastUpdated ?? lastUpdated) }] : [];
        }) : [];
        return [{ realmId, lastUpdated, entities }];
      });
    }
  }
  const cloudEvents = Array.isArray(payload) ? payload : payload && typeof payload === "object" && (payload as Row).specversion ? [payload] : [];
  return cloudEvents.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const event = value as Row;
    const realmId = String(event.intuitaccountid ?? "").trim();
    const entityId = String(event.intuitentityid ?? "").trim();
    const type = String(event.type ?? "").trim();
    const match = /^qbo\.([a-z0-9_-]+)\.([a-z0-9_-]+)\.v\d+$/iu.exec(type);
    if (String(event.specversion ?? "") !== "1.0" || !realmId || !entityId || !match) return [];
    const changedAt = String(event.time ?? new Date().toISOString());
    const entityKey = match[1].toLowerCase().replaceAll("-", "").replaceAll("_", "");
    const operation = titleCase(match[2]);
    return [{ realmId, lastUpdated: changedAt, entities: [{ name: cloudEntityNames[entityKey] ?? titleCase(match[1]), id: entityId, operation, lastUpdated: changedAt }] }];
  });
}

export async function recordQboWebhook(request: Request) {
  await ensureDatabase();
  const config = qboConfig(request.url);
  if (!config.webhookVerifierToken) return Response.json({ error: { code: "QBO_WEBHOOK_NOT_CONFIGURED", message: "QBO_WEBHOOK_VERIFIER_TOKEN is not configured." } }, { status: 503 });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) return Response.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "QuickBooks webhook payload exceeds 1 MB." } }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_WEBHOOK_BYTES) return Response.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "QuickBooks webhook payload exceeds 1 MB." } }, { status: 413 });
  const supplied = request.headers.get("intuit-signature")?.trim() ?? "";
  const expected = await hmacSha256Base64(config.webhookVerifierToken, bytes);
  if (!supplied || !constantTimeEqual(supplied, expected)) return Response.json({ error: { code: "INVALID_SIGNATURE", message: "Invalid Intuit webhook signature." } }, { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { return Response.json({ error: { code: "INVALID_JSON", message: "Webhook payload is not valid JSON." } }, { status: 400 }); }
  const notifications = normalizeQboWebhookPayload(payload);
  const payloadJson = JSON.stringify(payload);
  const payloadHash = await sha256Hex(bytes);
  let accepted = 0;
  for (const realmId of new Set(notifications.map((notification) => notification.realmId))) {
    const connection = await first<{ id: string }>("SELECT id FROM qbo_connections WHERE realm_id=? AND status='connected'", realmId);
    const result = await getD1().prepare(`INSERT OR IGNORE INTO qbo_webhook_events
      (id,connection_id,realm_id,payload_sha256,payload_json,status,attempts,created_at) VALUES (?,?,?,?,?,'pending',0,?)`)
      .bind(`qbo-webhook-${crypto.randomUUID()}`, connection?.id ?? null, realmId, payloadHash, payloadJson, new Date().toISOString()).run();
    accepted += Number(result.meta?.changes ?? 0);
  }
  return Response.json({ accepted }, { status: 200 });
}

export async function processQboWebhookBatch(limit = 100) {
  await ensureDatabase();
  const parsedLimit = Number(limit);
  const boundedLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(Math.trunc(parsedLimit), 500)) : 100;
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  await getD1().prepare(`UPDATE qbo_webhook_events SET status='failed',processed_at=NULL,last_error='Recovered a stale webhook claim.'
    WHERE status='processing' AND processed_at<?`).bind(stale).run();
  const events = (await getD1().prepare(`SELECT id,connection_id AS connectionId,realm_id AS realmId,payload_json AS payloadJson
    FROM qbo_webhook_events WHERE status IN ('pending','failed') AND attempts<10 ORDER BY created_at LIMIT ?`).bind(boundedLimit).all<Row>()).results;
  let processed = 0; let conflicts = 0; let ignored = 0; let failed = 0;
  for (const event of events) {
    const claim = await getD1().prepare("UPDATE qbo_webhook_events SET status='processing',attempts=attempts+1,processed_at=? WHERE id=? AND status IN ('pending','failed')").bind(new Date().toISOString(), event.id).run();
    if (!claim.meta?.changes) continue;
    try {
      if (!event.connectionId) {
        await getD1().prepare("UPDATE qbo_webhook_events SET status='ignored',processed_at=?,last_error='No connected PaneFlow company matches this realm.' WHERE id=?").bind(new Date().toISOString(), event.id).run();
        ignored += 1; continue;
      }
      const payload = JSON.parse(String(event.payloadJson)) as unknown;
      const notifications = normalizeQboWebhookPayload(payload).filter((item) => item.realmId === String(event.realmId));
      const entities = notifications.flatMap((item) => item.entities);
      for (const entity of entities) {
        const qboEntityType = entity.name;
        const qboEntityId = entity.id;
        const changedAt = entity.lastUpdated;
        const link = await first<{ id: string; qboLastUpdatedAt: string | null; localEntityType: string; localEntityId: string; qboEntityType: string; qboEntityId: string }>(
          `SELECT id,qbo_last_updated_at AS qboLastUpdatedAt,local_entity_type AS localEntityType,local_entity_id AS localEntityId,
             qbo_entity_type AS qboEntityType,qbo_entity_id AS qboEntityId
           FROM qbo_entity_links WHERE connection_id=? AND qbo_entity_type=? AND qbo_entity_id=?`, String(event.connectionId), qboEntityType, qboEntityId);
        if (!link) continue;
        if (link.qboLastUpdatedAt && new Date(changedAt).getTime() <= new Date(link.qboLastUpdatedAt).getTime()) continue;
        const message = `QuickBooks reported an external ${entity.operation} at ${changedAt}. Review and retry to overwrite it from PaneFlow.`;
        await recordQboExternalConflict({ connectionId: String(event.connectionId), link, source: "webhook", sourceId: String(event.id),
          remoteOperation: entity.operation, changedAt, message });
        conflicts += 1;
      }
      const changedAt = notifications.map((item) => item.lastUpdated).sort().at(-1) ?? new Date().toISOString();
      await getD1().prepare(`INSERT INTO qbo_sync_cursors (connection_id,entity_type,last_changed_at,last_checked_at,last_error)
        VALUES (?,'webhook',?,?,NULL) ON CONFLICT(connection_id,entity_type) DO UPDATE SET
        last_changed_at=excluded.last_changed_at,last_checked_at=excluded.last_checked_at,last_error=NULL`)
        .bind(event.connectionId, changedAt, new Date().toISOString()).run();
      await getD1().prepare("UPDATE qbo_webhook_events SET status='processed',processed_at=?,last_error=NULL WHERE id=?").bind(new Date().toISOString(), event.id).run();
      processed += 1;
    } catch (error) {
      await getD1().prepare("UPDATE qbo_webhook_events SET status='failed',last_error=? WHERE id=?").bind(error instanceof Error ? error.message : String(error), event.id).run();
      failed += 1;
    }
  }
  return { processed, conflicts, ignored, failed };
}
