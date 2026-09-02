import { executeWorkflow, WorkflowError } from "./advanced-domain";
import type { ActorIdentity } from "./auth";
import { executeInventoryCommand, DomainError } from "./inventory-domain";
import { all, ensureDatabase, first, getD1, newId, nextDocumentNumber, roundQuantity } from "./inventory-db";
import { validateBaseProductQuantity, ProductQuantityError } from "./product-quantities";

type CountType = "correction" | "cycle" | "annual" | "opening";
type SessionStatus = "draft" | "counting" | "review" | "awaiting_approval" | "posted" | "cancelled";

export class CountSessionError extends Error {
  constructor(public code: string, message: string, public status = 400, public currentVersion?: number) {
    super(message);
  }
}

type SessionRow = {
  id: string;
  number: string;
  countType: CountType;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  scopeType: string;
  blindCount: number;
  status: SessionStatus;
  effectiveDate: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  submittedAt: string | null;
  postedAt: string | null;
  version: number;
  lineCount: number;
  countedCount: number;
  varianceCount: number;
  approvalCount: number;
  conflictCount: number;
  postedCount: number;
  varianceQuantity: number;
  varianceValueCents: number;
};

const sessionSummarySelect = `SELECT s.id,s.number,s.count_type AS countType,s.warehouse_id AS warehouseId,
  w.code AS warehouseCode,w.name AS warehouseName,s.scope_type AS scopeType,s.blind_count AS blindCount,
  s.status,s.effective_date AS effectiveDate,s.notes,s.created_by AS createdBy,s.created_at AS createdAt,
  s.started_at AS startedAt,s.submitted_at AS submittedAt,s.posted_at AS postedAt,s.version,
  COUNT(l.id) AS lineCount,
  COALESCE(SUM(CASE WHEN l.counted_qty IS NOT NULL THEN 1 ELSE 0 END),0) AS countedCount,
  COALESCE(SUM(CASE WHEN ABS(COALESCE(l.variance_qty,0))>0.000001 THEN 1 ELSE 0 END),0) AS varianceCount,
  COALESCE(SUM(CASE WHEN a.status='pending' THEN 1 ELSE 0 END),0) AS approvalCount,
  COALESCE(SUM(CASE WHEN l.status='conflict' THEN 1 ELSE 0 END),0) AS conflictCount,
  COALESCE(SUM(CASE WHEN l.status='posted' THEN 1 ELSE 0 END),0) AS postedCount,
  COALESCE(SUM(COALESCE(l.variance_qty,0)),0) AS varianceQuantity,
  COALESCE(SUM(ROUND(COALESCE(l.variance_qty,0)*COALESCE(l.unit_cost_cents,p.standard_cost_cents,0))),0) AS varianceValueCents
 FROM inventory_count_sessions s JOIN warehouses w ON w.id=s.warehouse_id
 LEFT JOIN inventory_count_session_lines l ON l.session_id=s.id
 LEFT JOIN products p ON p.id=l.product_id LEFT JOIN approvals a ON a.id=l.approval_id`;

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === "true";
}

function requiredText(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new CountSessionError("VALIDATION_ERROR", `${label} is required.`);
  return normalized;
}

function validDate(value: unknown, label: string) {
  const normalized = requiredText(value, label);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new CountSessionError("VALIDATION_ERROR", `${label} must be a valid YYYY-MM-DD date.`);
  }
  return normalized;
}

function normalizeCountType(value: unknown): CountType {
  const normalized = String(value ?? "cycle").trim().toLowerCase();
  if (!["correction", "cycle", "annual", "opening"].includes(normalized)) {
    throw new CountSessionError("VALIDATION_ERROR", "countType must be correction, cycle, annual, or opening.");
  }
  return normalized as CountType;
}

function normalizeLocationIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 250);
}

async function sessionById(sessionId: string) {
  const session = await first<SessionRow>(`${sessionSummarySelect} WHERE s.id=? GROUP BY s.id`, sessionId);
  if (!session) throw new CountSessionError("NOT_FOUND", "Inventory count session was not found.", 404);
  return session;
}

async function requireMutableSession(sessionId: string, allowed: SessionStatus[]) {
  const session = await sessionById(sessionId);
  if (!allowed.includes(session.status)) {
    throw new CountSessionError("INVALID_STATE", `${session.number} cannot be changed while it is ${session.status.replaceAll("_", " ")}.`, 409, session.version);
  }
  return session;
}

async function auditSession(actor: ActorIdentity, sessionId: string, action: string, summary: string, metadata: Record<string, unknown> = {}) {
  await getD1().prepare(`INSERT INTO audit_events
    (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
    VALUES (?,'inventory_count_session',?,?,?,?,?,?,?,?)`)
    .bind(newId("audit"), sessionId, action, summary, actor.label, actor.id, actor.email, JSON.stringify(metadata), new Date().toISOString()).run();
}

export async function getCountSessionWorkspace(input: { warehouseId?: string; sessionId?: string; productSearch?: string } = {}) {
  await ensureDatabase();
  const warehouseId = input.warehouseId?.trim() ?? "";
  if (input.productSearch != null) {
    const term = input.productSearch.trim();
    const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const products = await all<Record<string, unknown>>(`SELECT p.id,p.sku,p.manufacturer_sku AS manufacturerSku,p.name,
      p.category,p.tracking_policy AS trackingPolicy,p.inventory_policy AS inventoryPolicy,
      p.standard_cost_cents AS standardCostCents,u.code AS baseUomCode,u.precision AS quantityPrecision
      FROM products p LEFT JOIN units_of_measure u ON u.id=p.base_uom_id
      WHERE p.active=1 AND p.inventory_policy<>'drop_ship'
        AND (?='' OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(p.manufacturer_sku,'') LIKE ? ESCAPE '\\')
      ORDER BY p.sku LIMIT 50`, term, like, like, like);
    return { products };
  }

  const sessions = await all<SessionRow>(`${sessionSummarySelect}
    WHERE (?='' OR s.warehouse_id=?) GROUP BY s.id
    ORDER BY CASE s.status WHEN 'counting' THEN 0 WHEN 'review' THEN 1 WHEN 'awaiting_approval' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,s.created_at DESC
    LIMIT 100`, warehouseId, warehouseId);
  const warehouses = await all<Record<string, unknown>>("SELECT id,code,name,timezone FROM warehouses WHERE active=1 ORDER BY code");
  const locations = await all<Record<string, unknown>>(`SELECT l.id,l.code,l.name,l.location_type AS locationType,
    l.inventory_status AS inventoryStatus,l.warehouse_id AS warehouseId,w.code AS warehouseCode
    FROM locations l JOIN warehouses w ON w.id=l.warehouse_id WHERE l.active=1 AND w.active=1
      AND (?='' OR l.warehouse_id=?) ORDER BY w.code,l.code`, warehouseId, warehouseId);

  if (!input.sessionId) return { sessions, warehouses, locations };
  const session = await sessionById(input.sessionId);
  const lines = await all<Record<string, unknown>>(`SELECT l.id,l.session_id AS sessionId,l.product_id AS productId,l.location_id AS locationId,
    l.tracking_policy AS trackingPolicy,l.expected_qty AS expectedQuantity,l.expected_balance_version AS expectedBalanceVersion,
    l.counted_qty AS countedQuantity,l.variance_qty AS varianceQuantity,l.unit_cost_cents AS unitCostCents,l.reason,l.status,
    l.approval_id AS approvalId,a.status AS approvalStatus,a.version AS approvalVersion,l.posted_count_id AS postedCountId,
    l.counted_by AS countedBy,l.counted_at AS countedAt,l.last_error AS lastError,l.version,
    p.sku,p.manufacturer_sku AS manufacturerSku,p.name AS productName,p.category,p.standard_cost_cents AS standardCostCents,
    u.code AS baseUomCode,u.precision AS quantityPrecision,
    loc.code AS locationCode,loc.name AS locationName,loc.inventory_status AS inventoryStatus,w.code AS warehouseCode
    FROM inventory_count_session_lines l JOIN products p ON p.id=l.product_id
    JOIN locations loc ON loc.id=l.location_id JOIN warehouses w ON w.id=loc.warehouse_id
    LEFT JOIN units_of_measure u ON u.id=p.base_uom_id LEFT JOIN approvals a ON a.id=l.approval_id
    WHERE l.session_id=? ORDER BY loc.code,p.sku`, input.sessionId);
  return { sessions, warehouses, locations, session, lines };
}

export async function createCountSession(actor: ActorIdentity, payload: Record<string, unknown>) {
  await ensureDatabase();
  const idempotencyKey = requiredText(payload.idempotencyKey, "idempotencyKey");
  const existing = await first<{ id: string }>("SELECT id FROM inventory_count_sessions WHERE idempotency_key=?", idempotencyKey);
  if (existing) return { message: "Inventory count session already exists.", session: await sessionById(existing.id) };
  const countType = normalizeCountType(payload.countType);
  if (countType === "opening" && actor.role !== "administrator") {
    throw new CountSessionError("FORBIDDEN", "Only an administrator can create opening inventory.", 403);
  }
  const warehouseId = requiredText(payload.warehouseId, "warehouse");
  const warehouse = await first<{ id: string }>("SELECT id FROM warehouses WHERE id=? AND active=1", warehouseId);
  if (!warehouse) throw new CountSessionError("INVALID_WAREHOUSE", "Select an active warehouse.", 404);
  const locationIds = normalizeLocationIds(payload.locationIds);
  if (locationIds.length) {
    const placeholders = locationIds.map(() => "?").join(",");
    const matched = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM locations WHERE active=1 AND warehouse_id=? AND id IN (${placeholders})`, warehouseId, ...locationIds);
    if (Number(matched?.count ?? 0) !== locationIds.length) throw new CountSessionError("INVALID_LOCATION", "Every selected location must belong to the active warehouse.", 409);
  }
  const effectiveDate = validDate(payload.effectiveDate ?? new Date().toISOString().slice(0, 10), "effectiveDate");
  const sessionId = newId("count-session");
  const number = await nextDocumentNumber("STK");
  const now = new Date().toISOString();
  const scopeType = countType === "correction" || countType === "opening" ? "selected_items" : locationIds.length ? "selected_locations" : "warehouse";
  const db = getD1();
  await db.prepare(`INSERT INTO inventory_count_sessions
    (id,number,count_type,warehouse_id,scope_type,blind_count,status,effective_date,notes,created_by,created_by_id,created_by_email,created_at,idempotency_key,version)
    VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,1)`)
    .bind(sessionId, number, countType, warehouseId, scopeType, booleanValue(payload.blindCount) ? 1 : 0,
      effectiveDate, typeof payload.notes === "string" ? payload.notes.trim() || null : null,
      actor.label, actor.id, actor.email, now, idempotencyKey).run();

  if (!["correction", "opening"].includes(countType)) {
    const locationPredicate = locationIds.length ? `AND ib.location_id IN (${locationIds.map(() => "?").join(",")})` : "";
    await db.prepare(`INSERT OR IGNORE INTO inventory_count_session_lines
      (id,session_id,product_id,location_id,tracking_policy,expected_qty,expected_balance_version,unit_cost_cents,status,created_at,version)
      SELECT 'count-line-' || lower(hex(randomblob(16))),?,ib.product_id,ib.location_id,p.tracking_policy,
        ib.on_hand_qty,ib.version,p.standard_cost_cents,'uncounted',?,1
      FROM inventory_balances ib JOIN locations loc ON loc.id=ib.location_id JOIN products p ON p.id=ib.product_id
      WHERE loc.active=1 AND p.active=1 AND p.inventory_policy<>'drop_ship' AND loc.warehouse_id=? ${locationPredicate}`)
      .bind(sessionId, now, warehouseId, ...locationIds).run();
  }
  await auditSession(actor, sessionId, "inventory_count_session_created", `${number} created as a ${countType} count.`, { countType, warehouseId, locationIds, blindCount: booleanValue(payload.blindCount) });
  return { message: `${number} created.`, session: await sessionById(sessionId) };
}

export async function addCountLine(actor: ActorIdentity, payload: Record<string, unknown>) {
  await ensureDatabase();
  const sessionId = requiredText(payload.sessionId, "sessionId");
  const session = await requireMutableSession(sessionId, ["draft", "counting"]);
  const productId = requiredText(payload.productId, "product");
  const locationId = requiredText(payload.locationId, "location");
  const product = await first<{ id: string; trackingPolicy: string; inventoryPolicy: string; standardCostCents: number }>(
    "SELECT id,tracking_policy AS trackingPolicy,inventory_policy AS inventoryPolicy,standard_cost_cents AS standardCostCents FROM products WHERE id=? AND active=1", productId);
  if (!product || product.inventoryPolicy === "drop_ship") throw new CountSessionError("INVALID_PRODUCT", "Select an active inventory product.", 404);
  const location = await first<{ id: string }>("SELECT id FROM locations WHERE id=? AND active=1 AND warehouse_id=?", locationId, session.warehouseId);
  if (!location) throw new CountSessionError("INVALID_LOCATION", "Select an active location in this session's warehouse.", 404);
  const now = new Date().toISOString();
  const db = getD1();
  await db.prepare("INSERT OR IGNORE INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES (?,?,0,0,1)").bind(productId, locationId).run();
  const balance = await first<{ quantity: number; version: number }>("SELECT on_hand_qty AS quantity,version FROM inventory_balances WHERE product_id=? AND location_id=?", productId, locationId);
  const lineId = newId("count-line");
  await db.prepare(`INSERT OR IGNORE INTO inventory_count_session_lines
    (id,session_id,product_id,location_id,tracking_policy,expected_qty,expected_balance_version,unit_cost_cents,status,created_at,version)
    VALUES (?,?,?,?,?,?,?,?, 'uncounted',?,1)`)
    .bind(lineId, sessionId, productId, locationId, product.trackingPolicy, Number(balance?.quantity ?? 0), Number(balance?.version ?? 1), product.standardCostCents, now).run();
  const line = await first<{ id: string }>("SELECT id FROM inventory_count_session_lines WHERE session_id=? AND product_id=? AND location_id=?", sessionId, productId, locationId);
  await auditSession(actor, sessionId, "inventory_count_line_added", "An item was added to the count scope.", { lineId: line?.id, productId, locationId });
  return { message: "Item added to the count.", lineId: line?.id };
}

export async function saveCountLine(actor: ActorIdentity, payload: Record<string, unknown>) {
  await ensureDatabase();
  const sessionId = requiredText(payload.sessionId, "sessionId");
  const session = await requireMutableSession(sessionId, ["draft", "counting", "review", "awaiting_approval"]);
  const lineId = requiredText(payload.lineId, "lineId");
  const expectedLineVersion = Number(payload.version);
  if (!Number.isInteger(expectedLineVersion) || expectedLineVersion < 1) throw new CountSessionError("VALIDATION_ERROR", "A current line version is required.");
  const line = await first<{ productId: string; expectedQuantity: number; version: number; approvalId: string | null; status: string }>(
    "SELECT product_id AS productId,expected_qty AS expectedQuantity,version,approval_id AS approvalId,status FROM inventory_count_session_lines WHERE id=? AND session_id=?", lineId, sessionId);
  if (!line) throw new CountSessionError("NOT_FOUND", "Count line was not found.", 404);
  if (line.status === "posted") throw new CountSessionError("INVALID_STATE", "A posted count line is immutable.", 409, line.version);
  if (line.approvalId) throw new CountSessionError("APPROVAL_ALREADY_REQUESTED", "This line is locked to its approval request. Recount it in a new correction session if the quantity is wrong.", 409, line.version);
  if (line.version !== expectedLineVersion) throw new CountSessionError("VERSION_CONFLICT", "This count line changed. Refresh before saving it again.", 409, line.version);
  const requestedQuantity = Number(payload.countedQuantity);
  let countedQuantity: number;
  try {
    countedQuantity = (await validateBaseProductQuantity(line.productId, requestedQuantity, "countedQuantity", true)).baseQuantity;
  } catch (error) {
    if (error instanceof ProductQuantityError) throw new CountSessionError(error.code, error.message, error.status);
    throw error;
  }
  const varianceQuantity = roundQuantity(countedQuantity - Number(line.expectedQuantity));
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  const unitCostCents = payload.unitCostCents == null || payload.unitCostCents === "" ? null : Math.round(Number(payload.unitCostCents));
  if (unitCostCents != null && (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0)) throw new CountSessionError("VALIDATION_ERROR", "Unit cost must be a non-negative whole number of cents.");
  if (session.countType === "opening" && countedQuantity > 0 && unitCostCents == null) throw new CountSessionError("VALIDATION_ERROR", "Opening inventory requires a unit cost.");
  const status = varianceQuantity === 0 ? "counted" : reason ? "variance" : "needs_reason";
  const now = new Date().toISOString();
  const result = await getD1().prepare(`UPDATE inventory_count_session_lines SET counted_qty=?,variance_qty=?,reason=?,unit_cost_cents=COALESCE(?,unit_cost_cents),
    status=?,counted_by=?,counted_by_id=?,counted_at=?,last_error=NULL,version=version+1 WHERE id=? AND session_id=? AND version=?`)
    .bind(countedQuantity, varianceQuantity, reason || null, unitCostCents, status, actor.label, actor.id, now, lineId, sessionId, expectedLineVersion).run();
  if (!result.meta?.changes) throw new CountSessionError("VERSION_CONFLICT", "This count line changed before it could be saved.", 409);
  if (session.status === "draft") {
    await getD1().prepare("UPDATE inventory_count_sessions SET status='counting',started_at=COALESCE(started_at,?),version=version+1 WHERE id=? AND status='draft'").bind(now, sessionId).run();
  }
  return { message: varianceQuantity === 0 ? "Count saved." : `Count saved with a ${varianceQuantity > 0 ? "+" : ""}${varianceQuantity} variance.` };
}

export async function submitCountSession(actor: ActorIdentity, payload: Record<string, unknown>) {
  const sessionId = requiredText(payload.sessionId, "sessionId");
  const session = await requireMutableSession(sessionId, ["draft", "counting"]);
  const incomplete = await first<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_count_session_lines WHERE session_id=? AND counted_qty IS NULL", sessionId);
  if (Number(incomplete?.count ?? 0) > 0) throw new CountSessionError("COUNT_INCOMPLETE", `${incomplete?.count} item${incomplete?.count === 1 ? " is" : "s are"} still uncounted.`, 409);
  if (session.lineCount === 0) throw new CountSessionError("COUNT_EMPTY", "Add at least one item before submitting the count.", 409);
  const trackedVariance = await first<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_count_session_lines WHERE session_id=? AND tracking_policy<>'quantity' AND ABS(COALESCE(variance_qty,0))>0.000001", sessionId);
  if (Number(trackedVariance?.count ?? 0) > 0) throw new CountSessionError("TRACKING_RECONCILIATION_REQUIRED", `${trackedVariance?.count} lot- or serial-tracked variance${trackedVariance?.count === 1 ? " requires" : "s require"} identity reconciliation before this session can be submitted.`, 409);
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE inventory_count_sessions SET status='review',submitted_at=?,version=version+1 WHERE id=? AND status IN ('draft','counting')").bind(now, sessionId).run();
  await auditSession(actor, sessionId, "inventory_count_session_submitted", `${session.number} submitted for variance review.`);
  return { message: `${session.number} is ready for review.`, session: await sessionById(sessionId) };
}

export async function reopenCountSession(actor: ActorIdentity, payload: Record<string, unknown>) {
  const sessionId = requiredText(payload.sessionId, "sessionId");
  const session = await requireMutableSession(sessionId, ["review", "awaiting_approval"]);
  if (session.postedCount > 0) throw new CountSessionError("PARTIALLY_POSTED", "Posted count lines are immutable; resolve the remaining lines without reopening the session.", 409);
  await getD1().prepare("UPDATE inventory_count_sessions SET status='counting',submitted_at=NULL,version=version+1 WHERE id=?").bind(sessionId).run();
  await auditSession(actor, sessionId, "inventory_count_session_reopened", `${session.number} returned to counting.`);
  return { message: `${session.number} returned to counting.` };
}

export async function requestCountLineApproval(actor: ActorIdentity, payload: Record<string, unknown>) {
  const sessionId = requiredText(payload.sessionId, "sessionId");
  const session = await requireMutableSession(sessionId, ["review", "awaiting_approval"]);
  const lineId = requiredText(payload.lineId, "lineId");
  const line = await first<{ productId: string; locationId: string; expectedQuantity: number; countedQuantity: number | null; varianceQuantity: number; reason: string | null; approvalId: string | null }>(
    `SELECT product_id AS productId,location_id AS locationId,expected_qty AS expectedQuantity,counted_qty AS countedQuantity,
      variance_qty AS varianceQuantity,reason,approval_id AS approvalId FROM inventory_count_session_lines WHERE id=? AND session_id=?`, lineId, sessionId);
  if (!line || line.countedQuantity == null) throw new CountSessionError("NOT_FOUND", "A completed count line is required.", 404);
  if (line.approvalId) return { message: "This variance already has an approval request.", approvalId: line.approvalId };
  if (Math.abs(Number(line.varianceQuantity)) < 0.000001) throw new CountSessionError("NO_VARIANCE", "A matching count does not need approval.", 409);
  const result = await executeWorkflow({
    command: "requestApproval",
    entityId: line.productId,
    idempotencyKey: requiredText(payload.idempotencyKey, "idempotencyKey"),
    actor,
    payload: {
      entityType: "product",
      requestType: "inventory_count_variance",
      reason: line.reason || `Variance in ${session.number}`,
      metadata: {
        productId: line.productId,
        locationId: line.locationId,
        recordedQuantity: Number(line.expectedQuantity),
        countedQuantity: Number(line.countedQuantity),
        absoluteVariance: Math.abs(Number(line.varianceQuantity)),
        countSessionId: sessionId,
        countSessionLineId: lineId,
      },
    },
  });
  await getD1().prepare("UPDATE inventory_count_session_lines SET approval_id=?,version=version+1 WHERE id=? AND approval_id IS NULL").bind(result.recordId, lineId).run();
  await getD1().prepare("UPDATE inventory_count_sessions SET status='awaiting_approval',version=version+1 WHERE id=? AND status='review'").bind(sessionId).run();
  return { message: result.message, approvalId: result.recordId };
}

export async function approveCountLine(actor: ActorIdentity, payload: Record<string, unknown>) {
  const sessionId = requiredText(payload.sessionId, "sessionId");
  await requireMutableSession(sessionId, ["review", "awaiting_approval"]);
  const lineId = requiredText(payload.lineId, "lineId");
  const approval = await first<{ id: string; version: number; status: string }>(`SELECT a.id,a.version,a.status FROM inventory_count_session_lines l
    JOIN approvals a ON a.id=l.approval_id WHERE l.id=? AND l.session_id=?`, lineId, sessionId);
  if (!approval) throw new CountSessionError("NOT_FOUND", "Approval request was not found.", 404);
  if (approval.status !== "pending") return { message: `Approval is already ${approval.status}.` };
  const result = await executeWorkflow({ command: "approveApproval", entityId: approval.id, version: approval.version,
    idempotencyKey: requiredText(payload.idempotencyKey, "idempotencyKey"), actor,
    payload: { reason: requiredText(payload.reason ?? "Approved after inventory count review", "approval reason") } });
  return { message: result.message };
}

export async function postCountSession(actor: ActorIdentity, payload: Record<string, unknown>) {
  const sessionId = requiredText(payload.sessionId, "sessionId");
  const session = await requireMutableSession(sessionId, ["review", "awaiting_approval"]);
  if (session.countType === "opening" && actor.role !== "administrator") throw new CountSessionError("FORBIDDEN", "Only an administrator can post opening inventory.", 403);
  const lines = await all<{ id: string; productId: string; locationId: string; trackingPolicy: string; expectedQuantity: number; expectedBalanceVersion: number; countedQuantity: number | null; varianceQuantity: number | null; unitCostCents: number | null; reason: string | null; approvalId: string | null; status: string }>(
    `SELECT id,product_id AS productId,location_id AS locationId,tracking_policy AS trackingPolicy,expected_qty AS expectedQuantity,
      expected_balance_version AS expectedBalanceVersion,counted_qty AS countedQuantity,variance_qty AS varianceQuantity,
      unit_cost_cents AS unitCostCents,reason,approval_id AS approvalId,status
      FROM inventory_count_session_lines WHERE session_id=? AND status<>'posted' ORDER BY location_id,product_id`, sessionId);
  if (lines.some((line) => line.countedQuantity == null)) throw new CountSessionError("COUNT_INCOMPLETE", "Every item must be counted before posting.", 409);
  const missingReasons = lines.filter((line) => Math.abs(Number(line.varianceQuantity ?? 0)) > 0.000001 && !line.reason?.trim());
  if (missingReasons.length) throw new CountSessionError("REASONS_REQUIRED", `${missingReasons.length} variance${missingReasons.length === 1 ? " needs" : "s need"} a reason before posting.`, 409);
  const postingDate = validDate(payload.postingDate ?? session.effectiveDate, "postingDate");
  const posted: string[] = [];
  const blocked: Array<{ lineId: string; code: string; message: string }> = [];
  for (const line of lines) {
    if (line.trackingPolicy !== "quantity" && Math.abs(Number(line.varianceQuantity ?? 0)) > 0.000001) {
      blocked.push({ lineId: line.id, code: "TRACKING_RECONCILIATION_REQUIRED", message: "Lot/serial variance requires identity reconciliation." });
      continue;
    }
    const current = await first<{ version: number }>("SELECT version FROM inventory_balances WHERE product_id=? AND location_id=?", line.productId, line.locationId);
    if (!current || current.version !== Number(line.expectedBalanceVersion)) {
      const message = "Inventory changed after this line was prepared. Recount it against the current balance.";
      await getD1().prepare("UPDATE inventory_count_session_lines SET status='conflict',last_error=?,version=version+1 WHERE id=?").bind(message, line.id).run();
      blocked.push({ lineId: line.id, code: "VERSION_CONFLICT", message });
      continue;
    }
    try {
      const result = await executeInventoryCommand({
        command: session.countType === "opening" ? "postOpeningBalance" : "postInventoryAdjustment",
        entityId: line.productId,
        version: line.expectedBalanceVersion,
        idempotencyKey: `count-session-post:${line.id}`,
        payload: {
          locationId: line.locationId,
          countedQuantity: Number(line.countedQuantity),
          reason: line.reason || (session.countType === "opening" ? `Opening inventory from ${session.number}` : `Physical count confirmed in ${session.number}`),
          postingDate,
          unitCostCents: line.unitCostCents,
          approvalId: line.approvalId,
          actor: actor.label,
          actorId: actor.id,
          actorEmail: actor.email,
          countSessionId: sessionId,
          countSessionLineId: line.id,
        },
      });
      await getD1().prepare("UPDATE inventory_count_session_lines SET status='posted',posted_count_id=?,last_error=NULL,version=version+1 WHERE id=?")
        .bind(result.countId ?? null, line.id).run();
      posted.push(line.id);
    } catch (error) {
      const code = error instanceof DomainError ? error.code : "POST_FAILED";
      const message = error instanceof Error ? error.message : "Count line could not be posted.";
      await getD1().prepare("UPDATE inventory_count_session_lines SET status=?,last_error=?,version=version+1 WHERE id=?")
        .bind(code === "APPROVAL_REQUIRED" || code === "APPROVAL_NOT_READY" ? "needs_approval" : "conflict", message, line.id).run();
      blocked.push({ lineId: line.id, code, message });
    }
  }
  const remaining = await first<{ count: number; pending: number }>(`SELECT COUNT(*) AS count,
    COALESCE(SUM(CASE WHEN l.status='needs_approval' OR a.status='pending' THEN 1 ELSE 0 END),0) AS pending
    FROM inventory_count_session_lines l LEFT JOIN approvals a ON a.id=l.approval_id WHERE l.session_id=? AND l.status<>'posted'`, sessionId);
  const now = new Date().toISOString();
  const finished = Number(remaining?.count ?? 0) === 0;
  await getD1().prepare(`UPDATE inventory_count_sessions SET status=?,posted_at=?,version=version+1 WHERE id=?`)
    .bind(finished ? "posted" : Number(remaining?.pending ?? 0) > 0 ? "awaiting_approval" : "review", finished ? now : null, sessionId).run();
  await auditSession(actor, sessionId, finished ? "inventory_count_session_posted" : "inventory_count_session_partially_posted",
    finished ? `${session.number} posted in full.` : `${posted.length} line(s) posted and ${blocked.length} require attention.`, { posted, blocked });
  return { message: finished ? `${session.number} posted successfully.` : `${posted.length} line${posted.length === 1 ? "" : "s"} posted; ${blocked.length} require attention.`, postedCount: posted.length, blocked, finished };
}

export async function cancelCountSession(actor: ActorIdentity, payload: Record<string, unknown>) {
  const sessionId = requiredText(payload.sessionId, "sessionId");
  const session = await requireMutableSession(sessionId, ["draft", "counting", "review", "awaiting_approval"]);
  if (session.postedCount > 0) throw new CountSessionError("PARTIALLY_POSTED", "A partially posted session cannot be cancelled.", 409);
  await getD1().prepare("UPDATE inventory_count_sessions SET status='cancelled',version=version+1 WHERE id=?").bind(sessionId).run();
  await auditSession(actor, sessionId, "inventory_count_session_cancelled", `${session.number} cancelled.`, { reason: typeof payload.reason === "string" ? payload.reason.trim() : "" });
  return { message: `${session.number} cancelled.` };
}

export function asCountSessionError(error: unknown) {
  if (error instanceof CountSessionError) return error;
  if (error instanceof WorkflowError) return new CountSessionError(error.code, error.message, error.status, error.currentVersion);
  if (error instanceof DomainError) return new CountSessionError(error.code, error.message, error.status, error.currentVersion);
  return null;
}
