import type { ActorIdentity } from "./auth";
import { ensureDatabase, first, getD1 } from "./inventory-db";
import { QboApiError, QboBusyError, qboQuery, qboRequest } from "./qbo-client";
import { buildQboMappingContext, mapQboDelivery, QboMappingError, qboSpecialItemIds } from "./qbo-transform";
import type { QboDelivery, QboEntityLink, QboMappedEntity, QboProcessResult } from "./qbo-types";

type Row = Record<string, unknown>;

const entityEndpoint: Record<string, string> = {
  Customer: "customer", Vendor: "vendor", Item: "item", PurchaseOrder: "purchaseorder", Invoice: "invoice", Bill: "bill",
  CreditMemo: "creditmemo", VendorCredit: "vendorcredit", Payment: "payment", BillPayment: "billpayment", JournalEntry: "journalentry",
};

const entityPriority: Record<string, number> = {
  business_partner_customer: 10, business_partner_vendor: 10, product: 20, qbo_special_item: 20,
  purchase_order: 30, customer_invoice: 40, vendor_bill: 40, customer_credit: 50, vendor_credit: 50,
  payment: 60, inventory_value_entry: 70, landed_cost_allocation: 70, returnable_event: 70,
  customer_credit_application: 60, vendor_credit_application: 60,
};

const qboPurchaseOrderEvents = new Set([
  "purchase_order.approved",
  "purchase_order.amendment_rejected_restored",
  "purchase_order.remainder_closed",
  "purchase_order.remainder_reopened",
]);

function now() { return new Date().toISOString(); }
function backoff(attempts: number) { return new Date(Date.now() + Math.min(60 * 60_000, 10_000 * 2 ** Math.min(attempts, 8))).toISOString(); }
function parseJson(value: unknown) { try { return JSON.parse(String(value ?? "{}")) as Record<string, unknown>; } catch { return {}; } }
function boundedLimit(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), maximum)) : fallback;
}

async function all(sql: string, ...bindings: unknown[]) {
  return (await getD1().prepare(sql).bind(...bindings).all<Row>()).results;
}

async function enqueue(input: {
  connectionId: string;
  dedupeKey: string;
  entityType: string;
  entityId: string;
  outboxEventId?: string | null;
  operation?: "upsert" | "void" | "deactivate" | "reconcile";
  sourceVersion?: number | null;
  payload?: Record<string, unknown>;
  availableAt?: string;
}) {
  const when = now();
  const result = await getD1().prepare(`INSERT OR IGNORE INTO qbo_sync_deliveries
    (id,connection_id,outbox_event_id,dedupe_key,local_entity_type,local_entity_id,operation,source_version,payload_json,status,attempts,available_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',0,?,?)`).bind(
      `qbo-delivery-${crypto.randomUUID()}`, input.connectionId, input.outboxEventId ?? null, input.dedupeKey,
      input.entityType, input.entityId, input.operation ?? "upsert", input.sourceVersion ?? null,
      JSON.stringify(input.payload ?? {}), input.availableAt ?? when, when,
    ).run();
  return Number(result.meta?.changes ?? 0);
}

async function projectOutboxForConnection(connection: Row, limit: number) {
  const cursor = await first<{ sequence: string }>("SELECT last_changed_at AS sequence FROM qbo_sync_cursors WHERE connection_id=? AND entity_type='outbox_projection'", String(connection.id));
  const events = await all(`SELECT rowid AS sequence,id,event_type AS eventType,aggregate_type AS aggregateType,aggregate_id AS aggregateId,payload_json AS payloadJson,created_at AS createdAt
    FROM outbox_events WHERE rowid>? AND created_at>=? ORDER BY rowid LIMIT ?`, Number(cursor?.sequence ?? 0), connection.syncFrom, limit);
  let projected = 0;
  for (const event of events) {
    const aggregate = String(event.aggregateType);
    const eventType = String(event.eventType);
    const payload = parseJson(event.payloadJson);
    const operation = eventType === "customer_invoice.voided" ? "void" : eventType === "master.deactivated" ? "deactivate" : "upsert";
    const targets: Array<{ type: string; id: string }> = [];
    if (aggregate === "business_partner") {
      const partner = await first<{ partnerType: string }>("SELECT partner_type AS partnerType FROM business_partners WHERE id=?", String(event.aggregateId));
      const kind = partner?.partnerType?.toLowerCase();
      if (["customer", "both"].includes(kind ?? "")) targets.push({ type: "business_partner_customer", id: String(event.aggregateId) });
      if (["vendor", "supplier", "both"].includes(kind ?? "")) targets.push({ type: "business_partner_vendor", id: String(event.aggregateId) });
    } else if (aggregate === "product") targets.push({ type: "product", id: String(event.aggregateId) });
    else if (aggregate === "purchase_order") {
      let shouldProject = qboPurchaseOrderEvents.has(eventType);
      if (eventType === "purchase_order.canceled") {
        const approval = await first<{ approved: number }>(`SELECT 1 AS approved FROM audit_events
          WHERE entity_type='purchase_order' AND entity_id=? AND action='approved' LIMIT 1`, String(event.aggregateId));
        shouldProject = Boolean(approval);
      }
      if (shouldProject) targets.push({ type: "purchase_order", id: String(event.aggregateId) });
    }
    else if (aggregate === "customer_invoice") targets.push({ type: "customer_invoice", id: String(event.aggregateId) });
    else if (aggregate === "vendor_bill") {
      const bill = await first<{ status: string }>("SELECT status FROM vendor_bills WHERE id=?", String(event.aggregateId));
      if (bill && !["draft", "on_hold", "void", "voided"].includes(bill.status)) targets.push({ type: "vendor_bill", id: String(event.aggregateId) });
    }
    else if (aggregate === "customer_credit") targets.push({ type: "customer_credit", id: String(event.aggregateId) });
    else if (aggregate === "vendor_credit") targets.push({ type: "vendor_credit", id: String(event.aggregateId) });
    else if (aggregate === "payment") targets.push({ type: "payment", id: String(event.aggregateId) });
    else if (aggregate === "landed_cost") targets.push({ type: "landed_cost_allocation", id: String(event.aggregateId) });
    if (payload.paymentId) targets.push({ type: "payment", id: String(payload.paymentId) });
    for (const target of targets) projected += await enqueue({
      connectionId: String(connection.id), dedupeKey: `outbox:${event.id}:${target.type}`, entityType: target.type,
      entityId: target.id, outboxEventId: String(event.id), operation, payload,
    });
  }
  if (events.length) {
    await getD1().prepare(`INSERT INTO qbo_sync_cursors (connection_id,entity_type,last_changed_at,last_checked_at,last_error)
      VALUES (?,'outbox_projection',?,?,NULL) ON CONFLICT(connection_id,entity_type) DO UPDATE SET
      last_changed_at=excluded.last_changed_at,last_checked_at=excluded.last_checked_at,last_error=NULL`)
      .bind(connection.id, String(events.at(-1)?.sequence ?? cursor?.sequence ?? "0"), now()).run();
  }
  return projected;
}

async function projectImmutableAccounting(connection: Row, limit: number) {
  let projected = 0;
  const valueEntries = await all(`SELECT ive.id FROM inventory_value_entries ive WHERE ive.posted_at>=? AND ive.entry_type<>'landed_cost'
    AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='inventory_value_entry' AND d.local_entity_id=ive.id)
    ORDER BY ive.posted_at,ive.id LIMIT ?`, connection.syncFrom, connection.id, limit);
  for (const item of valueEntries) projected += await enqueue({ connectionId: String(connection.id), dedupeKey: `inventory-value:${item.id}`, entityType: "inventory_value_entry", entityId: String(item.id) });
  const landed = await all(`SELECT lca.id FROM landed_cost_allocations lca WHERE lca.posted_at>=?
    AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='landed_cost_allocation' AND d.local_entity_id=lca.id)
    ORDER BY lca.posted_at,lca.id LIMIT ?`, connection.syncFrom, connection.id, limit);
  for (const item of landed) projected += await enqueue({ connectionId: String(connection.id), dedupeKey: `landed-cost:${item.id}`, entityType: "landed_cost_allocation", entityId: String(item.id) });
  const returnables = await all(`SELECT re.id FROM returnable_events re WHERE re.posted_at>=? AND re.event_type='forfeit' AND re.amount_cents<>0
    AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='returnable_event' AND d.local_entity_id=re.id)
    ORDER BY re.posted_at,re.id LIMIT ?`, connection.syncFrom, connection.id, limit);
  for (const item of returnables) projected += await enqueue({ connectionId: String(connection.id), dedupeKey: `returnable-forfeit:${item.id}`, entityType: "returnable_event", entityId: String(item.id) });
  return projected;
}

async function projectCreditApplications(connection: Row, limit: number) {
  let projected = 0;
  const customerCredits = await all(`SELECT cc.id FROM customer_credits cc
    JOIN qbo_entity_links credit_link ON credit_link.connection_id=? AND credit_link.local_entity_type='customer_credit' AND credit_link.local_entity_id=cc.id AND credit_link.qbo_entity_type='CreditMemo' AND credit_link.status='synced'
    JOIN qbo_entity_links invoice_link ON invoice_link.connection_id=? AND invoice_link.local_entity_type='customer_invoice' AND invoice_link.local_entity_id=cc.customer_invoice_id AND invoice_link.qbo_entity_type='Invoice' AND invoice_link.status='synced'
    WHERE cc.posted_at>=? AND cc.customer_invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='customer_credit_application' AND d.local_entity_id=cc.id)
    ORDER BY cc.posted_at,cc.id LIMIT ?`, connection.id, connection.id, connection.syncFrom, connection.id, limit);
  for (const item of customerCredits) projected += await enqueue({ connectionId: String(connection.id), dedupeKey: `credit-application:customer:${item.id}`, entityType: "customer_credit_application", entityId: String(item.id) });
  const vendorCredits = await all(`SELECT vc.id FROM vendor_credits vc
    JOIN qbo_entity_links credit_link ON credit_link.connection_id=? AND credit_link.local_entity_type='vendor_credit' AND credit_link.local_entity_id=vc.id AND credit_link.qbo_entity_type='VendorCredit' AND credit_link.status='synced'
    JOIN qbo_entity_links bill_link ON bill_link.connection_id=? AND bill_link.local_entity_type='vendor_bill' AND bill_link.local_entity_id=vc.vendor_bill_id AND bill_link.qbo_entity_type='Bill' AND bill_link.status='synced'
    WHERE vc.posted_at>=? AND vc.vendor_bill_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='vendor_credit_application' AND d.local_entity_id=vc.id)
    ORDER BY vc.posted_at,vc.id LIMIT ?`, connection.id, connection.id, connection.syncFrom, connection.id, limit);
  for (const item of vendorCredits) projected += await enqueue({ connectionId: String(connection.id), dedupeKey: `credit-application:vendor:${item.id}`, entityType: "vendor_credit_application", entityId: String(item.id) });
  return projected;
}

async function projectInitialSync(connection: Row, limit: number) {
  if (!['queued', 'running'].includes(String(connection.initialSyncStatus))) return 0;
  if (connection.initialSyncStatus === "queued") {
    await getD1().prepare("UPDATE qbo_connections SET initial_sync_status='running',updated_at=? WHERE id=? AND initial_sync_status='queued'").bind(now(), connection.id).run();
  }
  let projected = 0;
  for (const id of qboSpecialItemIds) projected += await enqueue({ connectionId: String(connection.id), dedupeKey: `system:special:${id}:v1`, entityType: "qbo_special_item", entityId: id, sourceVersion: 1 });
  const partnerSources = [
    { type: "business_partner_customer", kinds: ["customer", "both"] },
    { type: "business_partner_vendor", kinds: ["vendor", "supplier", "both"] },
  ];
  for (const source of partnerSources) {
    const records = await all(`SELECT bp.id,bp.version FROM business_partners bp WHERE lower(bp.partner_type) IN (${source.kinds.map(() => "?").join(",")})
      AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type=? AND d.local_entity_id=bp.id AND d.dedupe_key LIKE 'initial:%')
      ORDER BY bp.created_at,bp.id LIMIT ?`, ...source.kinds, connection.id, source.type, limit);
    for (const record of records) projected += await enqueue({
      connectionId: String(connection.id), dedupeKey: `initial:${source.type}:${record.id}:v${record.version ?? 1}`,
      entityType: source.type, entityId: String(record.id), sourceVersion: Number(record.version ?? 1),
    });
  }
  const sources: Array<{ type: string; sql: string; dated: boolean }> = [
    { type: "product", sql: "SELECT p.id,p.version FROM products p WHERE NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='product' AND d.local_entity_id=p.id AND d.dedupe_key LIKE 'initial:%') ORDER BY p.created_at,p.id LIMIT ?", dated: false },
    { type: "purchase_order", sql: "SELECT po.id,po.version FROM purchase_orders po,(SELECT ? AS cutoff) c WHERE (po.lifecycle_status='approved' OR (po.lifecycle_status='canceled' AND EXISTS (SELECT 1 FROM audit_events ae WHERE ae.entity_type='purchase_order' AND ae.entity_id=po.id AND ae.action='approved'))) AND (po.created_at>=c.cutoff OR EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.purchase_order_id=po.id AND COALESCE(vb.posted_at,vb.invoice_date)>=c.cutoff)) AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='purchase_order' AND d.local_entity_id=po.id AND d.dedupe_key LIKE 'initial:%') ORDER BY po.created_at,po.id LIMIT ?", dated: true },
    { type: "customer_invoice", sql: "SELECT ci.id,ci.version FROM customer_invoices ci,(SELECT ? AS cutoff) c WHERE (ci.posted_at>=c.cutoff OR ci.total_cents>ci.paid_cents OR EXISTS (SELECT 1 FROM payments p WHERE p.document_type='customer_invoice' AND p.document_id=ci.id AND p.posted_at>=c.cutoff) OR EXISTS (SELECT 1 FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.posted_at>=c.cutoff)) AND ci.status NOT IN ('void','voided') AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='customer_invoice' AND d.local_entity_id=ci.id AND d.dedupe_key LIKE 'initial:%') ORDER BY ci.posted_at,ci.id LIMIT ?", dated: true },
    { type: "vendor_bill", sql: "SELECT vb.id,vb.version FROM vendor_bills vb,(SELECT ? AS cutoff) c WHERE (COALESCE(vb.posted_at,vb.invoice_date)>=c.cutoff OR vb.total_cents>vb.paid_cents OR EXISTS (SELECT 1 FROM payments p WHERE p.document_type='vendor_bill' AND p.document_id=vb.id AND p.posted_at>=c.cutoff) OR EXISTS (SELECT 1 FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.posted_at>=c.cutoff)) AND vb.status NOT IN ('draft','on_hold','void','voided') AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='vendor_bill' AND d.local_entity_id=vb.id AND d.dedupe_key LIKE 'initial:%') ORDER BY COALESCE(vb.posted_at,vb.invoice_date),vb.id LIMIT ?", dated: true },
    { type: "customer_credit", sql: "SELECT cc.id,cc.version FROM customer_credits cc,(SELECT ? AS cutoff) c WHERE (cc.posted_at>=c.cutoff OR EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.id=cc.customer_invoice_id AND (ci.posted_at>=c.cutoff OR ci.total_cents>ci.paid_cents OR EXISTS (SELECT 1 FROM payments p WHERE p.document_type='customer_invoice' AND p.document_id=ci.id AND p.posted_at>=c.cutoff) OR EXISTS (SELECT 1 FROM customer_credits later WHERE later.customer_invoice_id=ci.id AND later.posted_at>=c.cutoff)))) AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='customer_credit' AND d.local_entity_id=cc.id AND d.dedupe_key LIKE 'initial:%') ORDER BY cc.posted_at,cc.id LIMIT ?", dated: true },
    { type: "vendor_credit", sql: "SELECT vc.id,vc.version FROM vendor_credits vc,(SELECT ? AS cutoff) c WHERE (vc.posted_at>=c.cutoff OR EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.id=vc.vendor_bill_id AND (COALESCE(vb.posted_at,vb.invoice_date)>=c.cutoff OR vb.total_cents>vb.paid_cents OR EXISTS (SELECT 1 FROM payments p WHERE p.document_type='vendor_bill' AND p.document_id=vb.id AND p.posted_at>=c.cutoff) OR EXISTS (SELECT 1 FROM vendor_credits later WHERE later.vendor_bill_id=vb.id AND later.posted_at>=c.cutoff)))) AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='vendor_credit' AND d.local_entity_id=vc.id AND d.dedupe_key LIKE 'initial:%') ORDER BY vc.posted_at,vc.id LIMIT ?", dated: true },
    { type: "payment", sql: "SELECT p.id,NULL AS version FROM payments p,(SELECT ? AS cutoff) c WHERE (p.posted_at>=c.cutoff OR (p.document_type='customer_invoice' AND EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.id=p.document_id AND (ci.posted_at>=c.cutoff OR ci.total_cents>ci.paid_cents OR EXISTS (SELECT 1 FROM payments later WHERE later.document_type='customer_invoice' AND later.document_id=ci.id AND later.posted_at>=c.cutoff) OR EXISTS (SELECT 1 FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.posted_at>=c.cutoff)))) OR (p.document_type='vendor_bill' AND EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.id=p.document_id AND (COALESCE(vb.posted_at,vb.invoice_date)>=c.cutoff OR vb.total_cents>vb.paid_cents OR EXISTS (SELECT 1 FROM payments later WHERE later.document_type='vendor_bill' AND later.document_id=vb.id AND later.posted_at>=c.cutoff) OR EXISTS (SELECT 1 FROM vendor_credits vc WHERE vc.vendor_bill_id=vb.id AND vc.posted_at>=c.cutoff))))) AND NOT EXISTS (SELECT 1 FROM qbo_sync_deliveries d WHERE d.connection_id=? AND d.local_entity_type='payment' AND d.local_entity_id=p.id AND d.dedupe_key LIKE 'initial:%') ORDER BY p.posted_at,p.id LIMIT ?", dated: true },
  ];
  for (const source of sources) {
    const bindings = source.dated ? [connection.syncFrom, connection.id, limit] : [connection.id, limit];
    const records = await all(source.sql, ...bindings);
    for (const record of records) {
      projected += await enqueue({ connectionId: String(connection.id), dedupeKey: `initial:${source.type}:${record.id}:v${record.version ?? 1}`,
        entityType: source.type, entityId: String(record.id), sourceVersion: record.version == null ? null : Number(record.version) });
    }
  }
  return projected;
}

export async function projectQboDeliveries(options: { connectionId?: string; limit?: number } = {}) {
  await ensureDatabase();
  const limit = boundedLimit(options.limit, 1000, 5000);
  const connections = await all(`SELECT id,sync_from AS syncFrom,initial_sync_status AS initialSyncStatus FROM qbo_connections
    WHERE status='connected' ${options.connectionId ? "AND id=?" : ""} ORDER BY connected_at`, ...(options.connectionId ? [options.connectionId] : []));
  let projected = 0;
  for (const connection of connections) {
    projected += await projectInitialSync(connection, limit);
    projected += await projectOutboxForConnection(connection, limit);
    projected += await projectImmutableAccounting(connection, limit);
    projected += await projectCreditApplications(connection, limit);
  }
  return projected;
}

async function claimDelivery(connectionId?: string) {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  await getD1().prepare(`UPDATE qbo_sync_deliveries SET status='failed',available_at=?,last_error_code='QBO_STALE_CLAIM',last_error='Recovered a stale processing claim.'
    WHERE status='processing' AND locked_at<?`).bind(now(), stale).run();
  const candidate = await first<{ id: string }>(`SELECT d.id FROM qbo_sync_deliveries d JOIN qbo_connections c ON c.id=d.connection_id
    WHERE c.status='connected' AND d.status IN ('pending','failed') AND d.available_at<=? AND d.attempts<12 ${connectionId ? "AND d.connection_id=?" : ""}
    ORDER BY CASE d.local_entity_type
      WHEN 'business_partner_customer' THEN 10 WHEN 'business_partner_vendor' THEN 10 WHEN 'product' THEN 20 WHEN 'qbo_special_item' THEN 20
      WHEN 'purchase_order' THEN 30 WHEN 'customer_invoice' THEN 40 WHEN 'vendor_bill' THEN 40 WHEN 'customer_credit' THEN 50
      WHEN 'vendor_credit' THEN 50 WHEN 'payment' THEN 60 WHEN 'customer_credit_application' THEN 60 WHEN 'vendor_credit_application' THEN 60 ELSE 70 END,d.created_at,d.id LIMIT 1`,
    now(), ...(connectionId ? [connectionId] : []));
  if (!candidate) return null;
  return getD1().prepare(`UPDATE qbo_sync_deliveries SET status='processing',attempts=attempts+1,locked_at=? WHERE id=? AND status IN ('pending','failed')
    RETURNING id,connection_id AS connectionId,outbox_event_id AS outboxEventId,dedupe_key AS dedupeKey,local_entity_type AS localEntityType,
      local_entity_id AS localEntityId,operation,source_version AS sourceVersion,payload_json AS payloadJson,status,attempts,available_at AS availableAt,
      locked_at AS lockedAt,last_error_code AS lastErrorCode,last_error AS lastError,qbo_entity_type AS qboEntityType,qbo_entity_id AS qboEntityId,
      request_hash AS requestHash,created_at AS createdAt,processed_at AS processedAt`).bind(now(), candidate.id).first<QboDelivery>();
}

async function enqueueImmediateCreditApplication(delivery: QboDelivery) {
  if (delivery.localEntityType === "customer_credit") return enqueue({
    connectionId: delivery.connectionId, dedupeKey: `credit-application:customer:${delivery.localEntityId}`,
    entityType: "customer_credit_application", entityId: delivery.localEntityId,
  });
  if (delivery.localEntityType === "vendor_credit") return enqueue({
    connectionId: delivery.connectionId, dedupeKey: `credit-application:vendor:${delivery.localEntityId}`,
    entityType: "vendor_credit_application", entityId: delivery.localEntityId,
  });
  return 0;
}

function escapeQuery(value: string) { return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'"); }

async function existingLink(delivery: QboDelivery, qboEntityType: string) {
  return first<QboEntityLink>(`SELECT id,connection_id AS connectionId,local_entity_type AS localEntityType,local_entity_id AS localEntityId,
    qbo_entity_type AS qboEntityType,qbo_entity_id AS qboEntityId,qbo_sync_token AS qboSyncToken,local_version AS localVersion,
    source_hash AS sourceHash,qbo_last_updated_at AS qboLastUpdatedAt,status,last_synced_at AS lastSyncedAt,last_error AS lastError
    FROM qbo_entity_links WHERE connection_id=? AND local_entity_type=? AND local_entity_id=? AND qbo_entity_type=?`,
  delivery.connectionId, delivery.localEntityType, delivery.localEntityId, qboEntityType);
}

function markerFor(delivery: QboDelivery) { return `PaneFlow ${delivery.localEntityType}:${delivery.localEntityId}`; }

async function findExistingRemote(delivery: QboDelivery, mappedEntity: QboMappedEntity) {
  let field = "";
  let value = "";
  if (["Customer", "Vendor"].includes(mappedEntity.qboEntityType)) { field = "DisplayName"; value = String(mappedEntity.body.DisplayName ?? ""); }
  else if (mappedEntity.qboEntityType === "Item") { field = "Name"; value = String(mappedEntity.body.Name ?? ""); }
  else if (!["Payment", "BillPayment"].includes(mappedEntity.qboEntityType) && mappedEntity.body.DocNumber) { field = "DocNumber"; value = String(mappedEntity.body.DocNumber); }
  else if (["Payment", "BillPayment"].includes(mappedEntity.qboEntityType) && mappedEntity.body.TxnDate) { field = "TxnDate"; value = String(mappedEntity.body.TxnDate); }
  if (!field || !value) return null;
  const queryLimit = field === "TxnDate" ? 1000 : 2;
  const payload = await qboQuery(delivery.connectionId, `select * from ${mappedEntity.qboEntityType} where ${field} = '${escapeQuery(value)}' maxresults ${queryLimit}`);
  let candidates = ((payload.QueryResponse as Record<string, unknown> | undefined)?.[mappedEntity.qboEntityType] ?? []) as Array<Record<string, unknown>>;
  if (mappedEntity.qboEntityType === "Payment") {
    candidates = candidates.filter((candidate) => String(candidate.PaymentRefNum ?? "") === String(mappedEntity.body.PaymentRefNum ?? ""));
  } else if (mappedEntity.qboEntityType === "BillPayment") {
    candidates = candidates.filter((candidate) => String(candidate.DocNumber ?? "") === String(mappedEntity.body.DocNumber ?? ""));
  }
  if (!candidates.length) return null;
  if (candidates.length > 1) throw new QboMappingError(`More than one QuickBooks ${mappedEntity.qboEntityType} matches ${field} ${value}; resolve the duplicates before retrying.`, { code: "QBO_AMBIGUOUS_MATCH" });
  const candidate = candidates[0];
  if (["Customer", "Vendor", "Item"].includes(mappedEntity.qboEntityType)) return candidate;
  const note = String(candidate.PrivateNote ?? candidate.Memo ?? "");
  if (note.includes(markerFor(delivery))) return candidate;
  const expected = await expectedTotalCents(delivery);
  const actual = candidate.TotalAmt == null ? null : Math.round(Number(candidate.TotalAmt) * 100);
  const candidateCustomer = String((candidate.CustomerRef as Row | undefined)?.value ?? "");
  const bodyCustomer = String((mappedEntity.body.CustomerRef as Row | undefined)?.value ?? "");
  const candidateVendor = String((candidate.VendorRef as Row | undefined)?.value ?? "");
  const bodyVendor = String((mappedEntity.body.VendorRef as Row | undefined)?.value ?? "");
  const partnerMatches = bodyCustomer ? candidateCustomer === bodyCustomer : bodyVendor ? candidateVendor === bodyVendor : true;
  const dateMatches = !mappedEntity.body.TxnDate || !candidate.TxnDate || String(mappedEntity.body.TxnDate) === String(candidate.TxnDate);
  return expected != null && actual != null && Math.abs(expected - actual) <= 1 && partnerMatches && dateMatches ? candidate : null;
}

function remoteEntity(payload: Row, type: string) {
  const entity = payload[type];
  if (!entity || typeof entity !== "object") throw new QboApiError(`QuickBooks returned no ${type} record.`, { code: "QBO_MALFORMED_RESPONSE", status: 502, retryable: true });
  return entity as Record<string, unknown>;
}

async function expectedTotalCents(delivery: QboDelivery) {
  const table: Record<string, { name: string; column: string }> = {
    purchase_order: { name: "purchase_orders", column: "total_cents" }, customer_invoice: { name: "customer_invoices", column: "total_cents" },
    vendor_bill: { name: "vendor_bills", column: "total_cents" }, customer_credit: { name: "customer_credits", column: "amount_cents" },
    vendor_credit: { name: "vendor_credits", column: "amount_cents" }, payment: { name: "payments", column: "amount_cents" },
  };
  const source = table[delivery.localEntityType];
  if (!source) return null;
  const record = await first<{ amount: number }>(`SELECT ${source.column} AS amount FROM ${source.name} WHERE id=?`, delivery.localEntityId);
  return record ? Math.abs(Number(record.amount)) : null;
}

async function saveLink(delivery: QboDelivery, mappedEntity: QboMappedEntity, remote: Record<string, unknown>, status: "synced" | "conflict", error?: string) {
  const timestamp = now();
  const remoteId = String(remote.Id ?? "");
  if (!remoteId) throw new QboApiError("QuickBooks returned an entity without an Id.", { code: "QBO_MALFORMED_RESPONSE", status: 502, retryable: true });
  await getD1().prepare(`INSERT INTO qbo_entity_links
    (id,connection_id,local_entity_type,local_entity_id,qbo_entity_type,qbo_entity_id,qbo_sync_token,local_version,source_hash,qbo_last_updated_at,status,last_synced_at,last_error)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connection_id,local_entity_type,local_entity_id,qbo_entity_type) DO UPDATE SET
      qbo_entity_id=excluded.qbo_entity_id,qbo_sync_token=excluded.qbo_sync_token,local_version=excluded.local_version,source_hash=excluded.source_hash,
      qbo_last_updated_at=excluded.qbo_last_updated_at,status=excluded.status,last_synced_at=excluded.last_synced_at,last_error=excluded.last_error`)
    .bind(`qbo-link-${crypto.randomUUID()}`, delivery.connectionId, delivery.localEntityType, delivery.localEntityId, mappedEntity.qboEntityType,
      remoteId, String(remote.SyncToken ?? "0"), mappedEntity.localVersion ?? null, mappedEntity.sourceHash,
      String((remote.MetaData as Row | undefined)?.LastUpdatedTime ?? timestamp), status, timestamp, error ?? null).run();
  return remoteId;
}

async function performUpsert(delivery: QboDelivery, mappedEntity: QboMappedEntity) {
  const endpoint = entityEndpoint[mappedEntity.qboEntityType];
  if (!endpoint) throw new QboMappingError(`No QBO endpoint is registered for ${mappedEntity.qboEntityType}.`, { code: "QBO_UNSUPPORTED_ENTITY" });
  let link = await existingLink(delivery, mappedEntity.qboEntityType);
  if (link?.sourceHash === mappedEntity.sourceHash && link.status === "synced") {
    return { remoteId: link.qboEntityId, unchanged: true };
  }
  if (!link) {
    const adopted = await findExistingRemote(delivery, mappedEntity);
    if (adopted) {
      await saveLink(delivery, mappedEntity, adopted, "synced");
      link = await existingLink(delivery, mappedEntity.qboEntityType);
    }
  }
  const body = link
    ? { ...mappedEntity.body, Id: link.qboEntityId, SyncToken: link.qboSyncToken, sparse: true }
    : mappedEntity.body;
  let remote: Record<string, unknown>;
  try {
    const response = await qboRequest(delivery.connectionId, `/${endpoint}`, { method: "POST", body, requestId: delivery.id });
    remote = remoteEntity(response, mappedEntity.qboEntityType);
  } catch (error) {
    if (!link && error instanceof QboApiError && error.code === "6240") {
      const adopted = await findExistingRemote(delivery, mappedEntity);
      if (!adopted) throw error;
      remote = adopted;
    } else throw error;
  }
  const expected = await expectedTotalCents(delivery);
  const actual = remote.TotalAmt == null ? null : Math.round(Number(remote.TotalAmt) * 100);
  let mismatch: string | undefined;
  if (expected != null && actual != null && Math.abs(expected - actual) > 1) {
    mismatch = `QuickBooks total ${actual} cents does not match PaneFlow total ${expected} cents.`;
  }
  const remoteId = await saveLink(delivery, mappedEntity, remote, mismatch ? "conflict" : "synced", mismatch);
  if (mismatch) throw new QboMappingError(mismatch, { code: "QBO_TOTAL_MISMATCH", conflict: true });
  return { remoteId, unchanged: false };
}

async function performVoid(delivery: QboDelivery, mappedEntity: QboMappedEntity) {
  let link = await existingLink(delivery, mappedEntity.qboEntityType);
  if (!link) {
    const adopted = await findExistingRemote(delivery, mappedEntity);
    if (adopted) {
      await saveLink(delivery, mappedEntity, adopted, "synced");
      link = await existingLink(delivery, mappedEntity.qboEntityType);
    }
  }
  if (!link) throw new QboMappingError(`Cannot void ${delivery.localEntityType}:${delivery.localEntityId} because it has no QuickBooks link.`, { code: "QBO_LINK_MISSING" });
  const endpoint = entityEndpoint[mappedEntity.qboEntityType];
  const response = await qboRequest(delivery.connectionId, `/${endpoint}`, {
    method: "POST", query: { operation: "void" }, requestId: delivery.id, body: { Id: link.qboEntityId, SyncToken: link.qboSyncToken },
  });
  const remote = remoteEntity(response, mappedEntity.qboEntityType);
  await saveLink(delivery, mappedEntity, remote, "synced");
  return { remoteId: String(remote.Id), unchanged: false };
}

async function finishDelivery(delivery: QboDelivery, mappedEntity: QboMappedEntity, remoteId: string, requestHash: string) {
  await getD1().prepare(`UPDATE qbo_sync_deliveries SET status='succeeded',locked_at=NULL,last_error_code=NULL,last_error=NULL,
    qbo_entity_type=?,qbo_entity_id=?,request_hash=?,processed_at=? WHERE id=? AND status='processing'`)
    .bind(mappedEntity.qboEntityType, remoteId, requestHash, now(), delivery.id).run();
}

async function failDelivery(delivery: QboDelivery, error: unknown) {
  const mapping = error instanceof QboMappingError;
  const api = error instanceof QboApiError;
  const busy = error instanceof QboBusyError;
  const code = mapping ? error.code : api ? error.code : busy ? error.code : "QBO_UNEXPECTED";
  const message = error instanceof Error ? error.message : String(error);
  const retryable = mapping ? error.retryable : api ? error.retryable : busy;
  const conflict = mapping ? error.conflict : api ? error.conflict : false;
  if (code === "QBO_ZERO_VALUE" || code === "QBO_ENTITY_NOT_APPLICABLE") {
    await getD1().prepare(`UPDATE qbo_sync_deliveries SET status='succeeded',locked_at=NULL,last_error_code=?,last_error=?,processed_at=? WHERE id=?`)
      .bind(code, message, now(), delivery.id).run();
    return "succeeded" as const;
  }
  const exhausted = Boolean(retryable) && delivery.attempts >= 12;
  const status = conflict || !retryable || exhausted ? "conflict" : "failed";
  const storedMessage = exhausted ? `${message} Automatic retries were exhausted.` : message;
  await getD1().prepare(`UPDATE qbo_sync_deliveries SET status=?,locked_at=NULL,last_error_code=?,last_error=?,available_at=?,processed_at=? WHERE id=?`)
    .bind(status, code, storedMessage.slice(0, 4000), status === "failed" ? backoff(delivery.attempts) : delivery.availableAt, status === "failed" ? null : now(), delivery.id).run();
  return status;
}

async function updateInitialSyncCompletion(connectionId?: string) {
  const connections = await all(`SELECT id FROM qbo_connections WHERE initial_sync_status='running' ${connectionId ? "AND id=?" : ""}`, ...(connectionId ? [connectionId] : []));
  for (const connection of connections) {
    const outstanding = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM qbo_sync_deliveries WHERE connection_id=? AND status IN ('pending','processing','failed')`, String(connection.id));
    const conflicts = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM qbo_sync_deliveries WHERE connection_id=? AND status='conflict'`, String(connection.id));
    if (!Number(outstanding?.count ?? 0)) {
      await getD1().prepare(`UPDATE qbo_connections SET initial_sync_status=?,updated_at=?,last_error=? WHERE id=?`)
        .bind(Number(conflicts?.count ?? 0) ? "failed" : "completed", now(), Number(conflicts?.count ?? 0) ? `${conflicts?.count} sync conflict(s) require attention.` : null, String(connection.id)).run();
    }
  }
}

export async function processQboSyncBatch(options: { connectionId?: string; limit?: number; project?: boolean } = {}): Promise<QboProcessResult> {
  await ensureDatabase();
  const result: QboProcessResult = { projected: options.project === false ? 0 : await projectQboDeliveries({ connectionId: options.connectionId }), attempted: 0, succeeded: 0, failed: 0, conflicts: 0, deferred: 0 };
  const limit = boundedLimit(options.limit, 50, 250);
  for (let index = 0; index < limit; index += 1) {
    const delivery = await claimDelivery(options.connectionId);
    if (!delivery) break;
    result.attempted += 1;
    try {
      const context = await buildQboMappingContext(delivery.connectionId);
      const mappedEntity = await mapQboDelivery(delivery, context);
      const outcome = delivery.operation === "void" ? await performVoid(delivery, mappedEntity) : await performUpsert(delivery, mappedEntity);
      await finishDelivery(delivery, mappedEntity, outcome.remoteId, mappedEntity.sourceHash);
      result.projected += await enqueueImmediateCreditApplication(delivery);
      result.succeeded += 1;
    } catch (error) {
      const status = await failDelivery(delivery, error);
      if (status === "succeeded") result.succeeded += 1;
      else if (status === "conflict") result.conflicts += 1;
      else { result.failed += 1; result.deferred += 1; }
    }
  }
  await updateInitialSyncCompletion(options.connectionId);
  return result;
}

export async function retryQboDelivery(deliveryId: string, actor: ActorIdentity) {
  const timestamp = now();
  const delivery = await first<{ connectionId: string; localEntityType: string; localEntityId: string; status: string; lastErrorCode: string | null; qboEntityType: string | null; payloadJson: string }>(
    `SELECT connection_id AS connectionId,local_entity_type AS localEntityType,local_entity_id AS localEntityId,status,
      last_error_code AS lastErrorCode,qbo_entity_type AS qboEntityType,payload_json AS payloadJson FROM qbo_sync_deliveries WHERE id=?`, deliveryId);
  if (!delivery) throw new QboMappingError("QBO delivery was not found.", { code: "QBO_DELIVERY_NOT_FOUND" });
  if (!["failed", "conflict"].includes(delivery.status)) {
    throw new QboMappingError(`A ${delivery.status} QBO delivery cannot be retried.`, { code: "QBO_DELIVERY_NOT_RETRYABLE" });
  }
  if (["QBO_EXTERNAL_EDIT", "5010"].includes(delivery.lastErrorCode ?? "")) {
    const link = await first<QboEntityLink>(`SELECT id,connection_id AS connectionId,local_entity_type AS localEntityType,local_entity_id AS localEntityId,
      qbo_entity_type AS qboEntityType,qbo_entity_id AS qboEntityId,qbo_sync_token AS qboSyncToken,local_version AS localVersion,
      source_hash AS sourceHash,qbo_last_updated_at AS qboLastUpdatedAt,status,last_synced_at AS lastSyncedAt,last_error AS lastError
      FROM qbo_entity_links WHERE connection_id=? AND local_entity_type=? AND local_entity_id=?
        AND (? IS NULL OR qbo_entity_type=?) AND status='conflict' ORDER BY last_synced_at DESC LIMIT 1`,
    delivery.connectionId, delivery.localEntityType, delivery.localEntityId, delivery.qboEntityType, delivery.qboEntityType);
    if (link) {
      const endpoint = entityEndpoint[link.qboEntityType];
      if (!endpoint) throw new QboMappingError(`No QBO endpoint is registered for ${link.qboEntityType}.`, { code: "QBO_UNSUPPORTED_ENTITY" });
      const payload = parseJson(delivery.payloadJson);
      try {
        const response = await qboRequest(delivery.connectionId, `/${endpoint}/${encodeURIComponent(link.qboEntityId)}`);
        const remote = remoteEntity(response, link.qboEntityType);
        await getD1().prepare(`UPDATE qbo_entity_links SET qbo_sync_token=?,qbo_last_updated_at=?,status='error',last_error='Administrator approved a PaneFlow overwrite.' WHERE id=?`)
          .bind(String(remote.SyncToken ?? "0"), String((remote.MetaData as Row | undefined)?.LastUpdatedTime ?? timestamp), link.id).run();
      } catch (error) {
        const deleted = error instanceof QboApiError && error.status === 404 && /delete/iu.test(String(payload.remoteOperation ?? ""));
        if (!deleted) throw error;
        await getD1().prepare("DELETE FROM qbo_entity_links WHERE id=?").bind(link.id).run();
      }
    }
  }
  await getD1().batch([
    getD1().prepare(`UPDATE qbo_sync_deliveries SET status='pending',attempts=0,available_at=?,locked_at=NULL,last_error_code=NULL,last_error=NULL,processed_at=NULL WHERE id=?`).bind(timestamp, deliveryId),
    getD1().prepare(`UPDATE qbo_entity_links SET status='error',last_error='Administrator queued a retry.' WHERE connection_id=? AND local_entity_type=? AND local_entity_id=? AND status='conflict'`).bind(delivery.connectionId, delivery.localEntityType, delivery.localEntityId),
    getD1().prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      VALUES (?,'qbo_delivery',?,'retry_queued','QuickBooks delivery queued for retry.',?,?,?,?,?)`)
      .bind(`audit-qbo-${crypto.randomUUID()}`, deliveryId, actor.label, actor.id, actor.email, JSON.stringify(delivery), timestamp),
  ]);
  return { queued: true };
}

export async function recordQboExternalConflict(input: {
  connectionId: string;
  link: { id: string; localEntityType: string; localEntityId: string; qboEntityType: string; qboEntityId: string };
  source: "webhook" | "reconciliation";
  sourceId: string;
  remoteOperation: string;
  changedAt: string;
  message: string;
}) {
  const timestamp = now();
  const payload = JSON.stringify({ remoteOperation: input.remoteOperation, changedAt: input.changedAt, source: input.source, sourceId: input.sourceId });
  const existing = await first<{ id: string }>(`SELECT id FROM qbo_sync_deliveries WHERE connection_id=? AND local_entity_type=? AND local_entity_id=?
    AND qbo_entity_type=? AND status='conflict' AND last_error_code='QBO_EXTERNAL_EDIT' ORDER BY created_at DESC LIMIT 1`,
  input.connectionId, input.link.localEntityType, input.link.localEntityId, input.link.qboEntityType);
  const statements = [
    getD1().prepare("UPDATE qbo_entity_links SET status='conflict',last_error=? WHERE id=?").bind(input.message, input.link.id),
  ];
  if (existing) {
    statements.push(getD1().prepare(`UPDATE qbo_sync_deliveries SET payload_json=?,last_error=?,qbo_entity_id=?,processed_at=? WHERE id=?`)
      .bind(payload, input.message.slice(0, 4000), input.link.qboEntityId, timestamp, existing.id));
  } else {
    statements.push(getD1().prepare(`INSERT INTO qbo_sync_deliveries
      (id,connection_id,dedupe_key,local_entity_type,local_entity_id,operation,payload_json,status,attempts,available_at,last_error_code,last_error,
       qbo_entity_type,qbo_entity_id,created_at,processed_at)
      VALUES (?,?,?,?,?,'upsert',?,'conflict',0,?,'QBO_EXTERNAL_EDIT',?,?,?,?,?)`).bind(
      `qbo-delivery-${crypto.randomUUID()}`, input.connectionId, `external:${input.source}:${input.sourceId}:${input.link.id}`,
      input.link.localEntityType, input.link.localEntityId, payload, timestamp, input.message.slice(0, 4000),
      input.link.qboEntityType, input.link.qboEntityId, timestamp, timestamp,
    ));
  }
  await getD1().batch(statements);
  return { deliveryId: existing?.id ?? null, created: !existing };
}

export async function listQboDeliveries(connectionId: string, options: { status?: string; limit?: number } = {}) {
  const limit = boundedLimit(options.limit, 100, 500);
  const bindings: unknown[] = [connectionId];
  const statusClause = options.status && ["pending", "processing", "succeeded", "failed", "conflict", "canceled"].includes(options.status)
    ? (bindings.push(options.status), "AND status=?") : "";
  bindings.push(limit);
  return all(`SELECT id,connection_id AS connectionId,dedupe_key AS dedupeKey,local_entity_type AS localEntityType,local_entity_id AS localEntityId,
    operation,status,attempts,available_at AS availableAt,last_error_code AS lastErrorCode,last_error AS lastError,qbo_entity_type AS qboEntityType,
    qbo_entity_id AS qboEntityId,created_at AS createdAt,processed_at AS processedAt FROM qbo_sync_deliveries
    WHERE connection_id=? ${statusClause} ORDER BY CASE status WHEN 'conflict' THEN 0 WHEN 'failed' THEN 1 WHEN 'processing' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END,created_at DESC LIMIT ?`, ...bindings);
}

export async function qboSyncSummary(connectionId: string) {
  const counts = await all(`SELECT status,COUNT(*) AS count FROM qbo_sync_deliveries WHERE connection_id=? GROUP BY status`, connectionId);
  const links = await first<{ count: number; conflicts: number }>(`SELECT COUNT(*) AS count,SUM(CASE WHEN status='conflict' THEN 1 ELSE 0 END) AS conflicts FROM qbo_entity_links WHERE connection_id=?`, connectionId);
  const lastReconciliation = await first<Row>(`SELECT id,status,checked_count AS checkedCount,matched_count AS matchedCount,conflict_count AS conflictCount,
    error_count AS errorCount,started_at AS startedAt,completed_at AS completedAt,last_error AS lastError FROM qbo_reconciliation_runs WHERE connection_id=? ORDER BY started_at DESC LIMIT 1`, connectionId);
  return { counts: Object.fromEntries(counts.map((item) => [String(item.status), Number(item.count)])), links: { total: Number(links?.count ?? 0), conflicts: Number(links?.conflicts ?? 0) }, lastReconciliation };
}

export async function reconcileQboConnection(connectionId: string, limit = 100) {
  const runId = `qbo-reconcile-${crypto.randomUUID()}`;
  const startedAt = now();
  await getD1().prepare(`INSERT INTO qbo_reconciliation_runs (id,connection_id,status,started_at) VALUES (?,?,'running',?)`).bind(runId, connectionId, startedAt).run();
  const cursor = await first<{ linkId: string }>("SELECT last_changed_at AS linkId FROM qbo_sync_cursors WHERE connection_id=? AND entity_type='reconciliation'", connectionId);
  const links = await all(`SELECT id,local_entity_type AS localEntityType,local_entity_id AS localEntityId,qbo_entity_type AS qboEntityType,
    qbo_entity_id AS qboEntityId,qbo_sync_token AS qboSyncToken FROM qbo_entity_links WHERE connection_id=?
    ORDER BY CASE WHEN id>? THEN 0 ELSE 1 END,id LIMIT ?`, connectionId, cursor?.linkId ?? "", boundedLimit(limit, 100, 500));
  let matched = 0; let conflicts = 0; let errors = 0;
  const details: Row[] = [];
  for (const link of links) {
    try {
      const endpoint = entityEndpoint[String(link.qboEntityType)];
      const response = await qboRequest(connectionId, `/${endpoint}/${encodeURIComponent(String(link.qboEntityId))}`);
      const remote = remoteEntity(response, String(link.qboEntityType));
      if (String(remote.SyncToken ?? "0") === String(link.qboSyncToken)) {
        matched += 1;
        await getD1().prepare(`UPDATE qbo_entity_links SET status='synced',qbo_last_updated_at=?,last_synced_at=?,last_error=NULL WHERE id=?`)
          .bind(String((remote.MetaData as Row | undefined)?.LastUpdatedTime ?? now()), now(), link.id).run();
      }
      else {
        conflicts += 1;
        const message = `QuickBooks SyncToken changed from ${link.qboSyncToken} to ${remote.SyncToken}.`;
        details.push({ localEntityType: link.localEntityType, localEntityId: link.localEntityId, message });
        await recordQboExternalConflict({ connectionId, link: link as { id: string; localEntityType: string; localEntityId: string; qboEntityType: string; qboEntityId: string },
          source: "reconciliation", sourceId: runId, remoteOperation: "Update", changedAt: String((remote.MetaData as Row | undefined)?.LastUpdatedTime ?? now()), message });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const remoteConflict = error instanceof QboApiError && (error.conflict || error.status === 404);
      if (remoteConflict) conflicts += 1; else errors += 1;
      details.push({ localEntityType: link.localEntityType, localEntityId: link.localEntityId, message });
      if (remoteConflict) {
        await recordQboExternalConflict({ connectionId, link: link as { id: string; localEntityType: string; localEntityId: string; qboEntityType: string; qboEntityId: string },
          source: "reconciliation", sourceId: runId, remoteOperation: error instanceof QboApiError && error.status === 404 ? "Delete" : "Update", changedAt: now(), message });
      } else await getD1().prepare("UPDATE qbo_entity_links SET status='error',last_error=? WHERE id=?").bind(message, link.id).run();
    }
  }
  const completedAt = now();
  const status = errors ? "failed" : "completed";
  const statements = [getD1().prepare(`UPDATE qbo_reconciliation_runs SET status=?,checked_count=?,matched_count=?,conflict_count=?,error_count=?,summary_json=?,completed_at=?,last_error=? WHERE id=?`)
    .bind(status, links.length, matched, conflicts, errors, JSON.stringify({ details }), completedAt, errors ? `${errors} record(s) could not be checked.` : null, runId)];
  if (links.length) statements.push(getD1().prepare(`INSERT INTO qbo_sync_cursors (connection_id,entity_type,last_changed_at,last_checked_at,last_error)
    VALUES (?,'reconciliation',?,?,NULL) ON CONFLICT(connection_id,entity_type) DO UPDATE SET
    last_changed_at=excluded.last_changed_at,last_checked_at=excluded.last_checked_at,last_error=NULL`).bind(connectionId, String(links.at(-1)?.id), completedAt));
  await getD1().batch(statements);
  return { id: runId, status, checked: links.length, matched, conflicts, errors, details };
}

export function qboEntityPriority(entityType: string) { return entityPriority[entityType] ?? 100; }
