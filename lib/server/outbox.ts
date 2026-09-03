import { env } from "cloudflare:workers";
import { deleteAttachmentObject } from "./attachments";
import { sendWithCompanyMailbox } from "./email-client";
import { getD1 } from "./inventory-db";

type OutboxEnvironment = {
  OUTBOX_WEBHOOK_URL?: string;
  OUTBOX_WEBHOOK_SECRET?: string;
};

type OutboxRow = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payloadJson: string;
  attempts: number;
  createdAt: string;
};

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
const INTERNAL_DRAFT_PO_EMAIL = "purchase_order.draft_approval_email_requested";
const INTERNAL_APPROVED_PO_EMAIL = "purchase_order.approved_email_requested";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function signature(secret: string, timestamp: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
}

/**
 * Claims and delivers a small batch of durable outbox events. Delivery is at-least-once;
 * consumers use the event ID as their deduplication key. A failed delivery is retained with
 * exponential backoff and can be retried manually or by the Worker's scheduled handler.
 */
export async function processOutboxBatch({ limit = 20 }: { limit?: number } = {}) {
  const runtime = env as unknown as OutboxEnvironment;
  const webhookUrl = runtime.OUTBOX_WEBHOOK_URL?.trim();
  const secret = runtime.OUTBOX_WEBHOOK_SECRET?.trim();
  if (Boolean(webhookUrl) !== Boolean(secret)) throw new Error("OUTBOX_WEBHOOK_URL and OUTBOX_WEBHOOK_SECRET must be configured together.");
  const webhookConfigured = Boolean(webhookUrl && secret);

  let endpoint: URL | null = null;
  if (webhookConfigured) {
    try { endpoint = new URL(webhookUrl!); } catch { throw new Error("OUTBOX_WEBHOOK_URL must be an absolute HTTP(S) URL."); }
    if (!/^https?:$/.test(endpoint.protocol)) throw new Error("OUTBOX_WEBHOOK_URL must use HTTP or HTTPS.");
  }

  const db = getD1();
  const now = new Date();
  const claimedAt = now.toISOString();
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
  await db.prepare(`UPDATE outbox_events SET status='processing',locked_at=?
    WHERE id IN (SELECT id FROM outbox_events
      WHERE ((status IN ('pending','failed') AND available_at<=?) OR (status='processing' AND locked_at<?))
        AND (?=1 OR event_type IN ('attachment.delete_requested','purchase_order.draft_approval_email_requested','purchase_order.approved_email_requested'))
      ORDER BY created_at,id LIMIT ?)`)
    .bind(claimedAt, claimedAt, new Date(now.getTime() - 10 * 60_000).toISOString(), webhookConfigured ? 1 : 0, bounded).run();
  const claimed = await db.prepare(`SELECT id,event_type AS eventType,aggregate_type AS aggregateType,
      aggregate_id AS aggregateId,payload_json AS payloadJson,attempts,created_at AS createdAt
    FROM outbox_events WHERE status='processing' AND locked_at=? ORDER BY created_at,id`).bind(claimedAt).all<OutboxRow>();

  let processed = 0; let failed = 0;
  for (const event of claimed.results ?? []) {
    let payload: unknown;
    try { payload = JSON.parse(event.payloadJson); } catch { payload = { malformedPayload: true, raw: event.payloadJson }; }
    const body = JSON.stringify({ id: event.id, type: event.eventType, aggregate: { type: event.aggregateType, id: event.aggregateId }, occurredAt: event.createdAt, payload });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    try {
      if (event.eventType === "attachment.delete_requested") {
        const objectKey = payload && typeof payload === "object" && "objectKey" in payload ? String((payload as { objectKey?: unknown }).objectKey ?? "") : "";
        await deleteAttachmentObject(objectKey);
      }
      if (event.eventType === INTERNAL_DRAFT_PO_EMAIL) {
        const values = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const recipient = String(values.recipient ?? "").trim();
        const number = String(values.number ?? "Purchase order").trim();
        const recordId = String(values.recordId ?? event.aggregateId).trim();
        const origin = new URL(String(values.appOrigin ?? ""));
        if (!/^https?:$/u.test(origin.protocol)) throw new Error("Draft purchase-order link must use HTTP or HTTPS.");
        const reviewUrl = new URL("/", origin);
        reviewUrl.searchParams.set("view", "purchase-orders");
        reviewUrl.searchParams.set("po", recordId);
        reviewUrl.searchParams.set("number", number);
        const safeNumber = escapeHtml(number);
        const safeUrl = escapeHtml(reviewUrl.toString());
        await sendWithCompanyMailbox({
          recipients: [recipient],
          subject: `${number} draft created — approval required`,
          htmlBody: `<p>A new purchase order draft, <strong>${safeNumber}</strong>, was created and requires approval.</p><p><a href="${safeUrl}">Review purchase order</a></p>`,
        });
      }
      if (event.eventType === INTERNAL_APPROVED_PO_EMAIL) {
        const values = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const recipients = Array.isArray(values.recipients) ? values.recipients.map(String) : [];
        const number = String(values.number ?? "Purchase order").trim();
        const recordId = String(values.recordId ?? event.aggregateId).trim();
        const origin = new URL(String(values.appOrigin ?? ""));
        if (!/^https?:$/u.test(origin.protocol)) throw new Error("Approved purchase-order link must use HTTP or HTTPS.");
        const reviewUrl = new URL("/", origin);
        reviewUrl.searchParams.set("view", "purchase-orders");
        reviewUrl.searchParams.set("po", recordId);
        reviewUrl.searchParams.set("number", number);
        const safeNumber = escapeHtml(number);
        const safeUrl = escapeHtml(reviewUrl.toString());
        await sendWithCompanyMailbox({
          recipients,
          subject: `${number} approved`,
          htmlBody: `<p>The draft purchase order <strong>${safeNumber}</strong> has been approved.</p><p><a href="${safeUrl}">View purchase order</a></p>`,
        });
      }
      if (endpoint && secret && event.eventType !== INTERNAL_DRAFT_PO_EMAIL && event.eventType !== INTERNAL_APPROVED_PO_EMAIL) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "PaneFlow-Outbox/1.0",
            "x-paneflow-event-id": event.id,
            "x-paneflow-event-type": event.eventType,
            "x-paneflow-timestamp": timestamp,
            "x-paneflow-signature": `sha256=${await signature(secret, timestamp, body)}`,
          },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
      }
      await db.prepare("UPDATE outbox_events SET status='processed',attempts=attempts+1,processed_at=?,locked_at=NULL,last_error=NULL WHERE id=? AND status='processing' AND locked_at=?")
        .bind(new Date().toISOString(), event.id, claimedAt).run();
      processed += 1;
    } catch (caught) {
      const attempts = event.attempts + 1;
      const delaySeconds = Math.min(3_600, 15 * 2 ** Math.min(attempts - 1, 8));
      const availableAt = new Date(Date.now() + delaySeconds * 1_000).toISOString();
      const message = (caught instanceof Error ? caught.message : "Webhook delivery failed.").slice(0, 1_000);
      await db.prepare("UPDATE outbox_events SET status='failed',attempts=attempts+1,available_at=?,locked_at=NULL,last_error=? WHERE id=? AND status='processing' AND locked_at=?")
        .bind(availableAt, message, event.id, claimedAt).run();
      failed += 1;
    }
  }
  return { configured: webhookConfigured, claimed: claimed.results?.length ?? 0, processed, failed };
}
