import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let inventoryDomain;
let advancedDomain;
let countSessions;
let catalogPricing;

const operator = { id: "audit-operator", email: "audit-operator@example.com", name: "Audit Operator", role: "operator", label: "Audit Operator <audit-operator@example.com>", localDevelopment: false };
const manager = { id: "audit-manager", email: "audit-manager@example.com", name: "Audit Manager", role: "manager", label: "Audit Manager <audit-manager@example.com>", localDevelopment: false };
const accountant = { id: "audit-accountant", email: "audit-accountant@example.com", name: "Audit Accountant", role: "accounting", label: "Audit Accountant <audit-accountant@example.com>", localDevelopment: false };
const administrator = { id: "audit-admin", email: "audit-admin@example.com", name: "Audit Admin", role: "administrator", label: "Audit Admin <audit-admin@example.com>", localDevelopment: false };

async function applyMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
}

function run(sql, ...values) { return db.prepare(sql).bind(...values).run(); }
function row(sql, ...values) { const found = db.sqlite.prepare(sql).get(...values); return found ? { ...found } : undefined; }
function rows(sql, ...values) { return db.sqlite.prepare(sql).all(...values).map((item) => ({ ...item })); }
function placeholders(sql) { return (sql.match(/\?/g) ?? []).length; }
function lastPreparedSql(fragment) { return db.preparedSql.filter((sql) => sql.includes(fragment)).at(-1); }
const rejectsWithCode = (code) => (error) => { assert.equal(error?.code, code, `expected ${code}, received ${error?.code}: ${error?.message}`); return true; };

async function insertProduct(id, sku, costCents, priceCents, extra = {}) {
  await run(`INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at,pricing_mode,suggested_selling_price_cents)
    VALUES (?,?,?,?,'test','test','test','quantity','stocked',?,?,0,'uom-each',?,'uom-each',1,1,'2026-09-01',?,?)`,
    id, sku, `${sku} product`, extra.category ?? "audit", costCents, priceCents, extra.purchaseUomId ?? "uom-each", extra.pricingMode ?? "manual", extra.suggestedPriceCents ?? priceCents);
  await run("INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES (?,?,?,?,1,'2026-09-01','Audit seed')", id, extra.method ?? "standard", costCents, costCents);
}

async function insertApprovedPurchaseOrder(id, lines, extra = {}) {
  const total = lines.reduce((sum, line) => sum + Math.round((line.uomQuantity ?? line.quantity) * (line.uomUnitCost ?? line.unitCost)), 0);
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,revision_number,version,created_at) VALUES (?,?,'vendor-audit','approved','not_billed','2026-09-10','CAD',1,?,?,1,1,'2026-09-01')", id, extra.number ?? id.toUpperCase(), total, total);
  await run("INSERT INTO purchase_order_revisions (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at) VALUES (?,?,1,'approved','{}','Seeded approved commitment','Audit seed','2026-09-01')", `revision-${id}-1`, id);
  for (const line of lines) {
    await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps,version) VALUES (?,?,?,?,0,?,?,?,?,?,0,0,0,1)",
      line.id, id, line.productId, line.quantity, line.unitCost, line.uomId ?? "uom-each", line.uomQuantity ?? line.quantity, line.uomUnitCost ?? line.unitCost, line.route ?? "stock");
  }
}

async function receive(purchaseOrderId, lineId, quantity, idempotencyKey) {
  // Receipts lock on the purchase-order line version.
  const line = row("SELECT version FROM purchase_order_lines WHERE id=?", lineId);
  return inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: purchaseOrderId, version: line.version, idempotencyKey, payload: { lineId, quantity, locationId: "loc-audit-a", postingDate: "2026-09-02", actor: "Audit Receiver" } });
}

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  env.BOOTSTRAP_DEMO_DATA = "false";
  inventoryDomain = await import("../lib/server/inventory-domain.ts");
  advancedDomain = await import("../lib/server/advanced-domain.ts");
  countSessions = await import("../lib/server/inventory-count-sessions.ts");
  catalogPricing = await import("../lib/server/catalog-pricing.ts");
  await (await import("../lib/server/inventory-db.ts")).ensureDatabase();

  await run("INSERT INTO warehouses (id,code,name,timezone,active,version) VALUES ('wh-audit','AUDIT','Audit Warehouse','America/Edmonton',1,1)");
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-audit-a','AUDIT-A','Audit aisle A','storage','usable','wh-audit',1,1),('loc-audit-b','AUDIT-B','Audit aisle B','storage','usable','wh-audit',1,1)");
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('vendor-audit','VEND-AUDIT','Audit Vendor','vendor','CAD',1,1,'2026-09-01')");
  await run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,currency,credit_limit_cents,credit_hold,active,version,created_at) VALUES ('customer-audit','CUST-AUDIT','Audit Customer','customer','1 Audit Way','Edmonton','AB','T5J 0N1','CA','CAD',0,0,1,1,'2026-09-01')");
  await insertProduct("prod-audit-a", "AUDIT-A", 100, 200);
  await insertProduct("prod-audit-b", "AUDIT-B", 150, 300, { method: "fifo" });
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-audit-a','loc-audit-a',10,0,1)");
});

after(() => db.close());

// ---------------------------------------------------------------------------------------------
// #4A / #1: conflicting count lines can be refreshed, and partially posted sessions stay usable.
// ---------------------------------------------------------------------------------------------
test("a count line that conflicts with newer stock is refreshed in place and the session posts", async () => {
  await run("INSERT INTO warehouses (id,code,name,timezone,active,version) VALUES ('wh-count','COUNT','Count Warehouse','America/Edmonton',1,1)");
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-count','COUNT-01','Count bay','storage','usable','wh-count',1,1)");
  await insertProduct("prod-count-a", "COUNT-A", 100, 200);
  await insertProduct("prod-count-b", "COUNT-B", 100, 200);
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-count-a','loc-count',10,0,1),('prod-count-b','loc-count',10,0,1)");

  const created = await countSessions.createCountSession(operator, { countType: "cycle", warehouseId: "wh-count", locationIds: ["loc-count"], effectiveDate: "2026-09-02", idempotencyKey: "audit-count-conflict" });
  const sessionId = created.session.id;
  let workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  assert.equal(workspace.lines.length, 2);
  for (const line of workspace.lines) {
    await countSessions.saveCountLine(operator, { sessionId, lineId: line.id, version: line.version, countedQuantity: Number(line.expectedQuantity) + 1, reason: "Cycle count" });
  }
  await countSessions.submitCountSession(operator, { sessionId });
  // Stock for B moves after the line was prepared (one unit shipped from the bay).
  await run("UPDATE inventory_balances SET on_hand_qty=9,version=version+1 WHERE product_id='prod-count-b' AND location_id='loc-count'");
  const firstPost = await countSessions.postCountSession(operator, { sessionId, postingDate: "2026-09-02" });
  assert.equal(firstPost.finished, false);
  assert.equal(firstPost.postedCount, 1);
  assert.equal(firstPost.blocked[0].code, "VERSION_CONFLICT");
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  const conflicted = workspace.lines.find((line) => line.productId === "prod-count-b");
  assert.equal(conflicted.status, "conflict");
  assert.equal(workspace.session.status, "review");

  const refreshed = await countSessions.refreshCountLine(operator, { sessionId, lineId: conflicted.id });
  assert.match(refreshed.message, /refreshed/i);
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  const refreshedLine = workspace.lines.find((line) => line.productId === "prod-count-b");
  assert.deepEqual({ expected: refreshedLine.expectedQuantity, balanceVersion: refreshedLine.expectedBalanceVersion, counted: refreshedLine.countedQuantity, variance: refreshedLine.varianceQuantity, status: refreshedLine.status, lastError: refreshedLine.lastError },
    { expected: 9, balanceVersion: 2, counted: 11, variance: 2, status: "variance", lastError: null });
  assert.equal(refreshedLine.version, conflicted.version + 1);

  const finalPost = await countSessions.postCountSession(operator, { sessionId, postingDate: "2026-09-02" });
  assert.equal(finalPost.finished, true);
  assert.equal(row("SELECT status FROM inventory_count_sessions WHERE id=?", sessionId).status, "posted");
  assert.equal(row("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-count-b' AND location_id='loc-count'").on_hand_qty, 11);
  assert.equal(row("SELECT action FROM audit_events WHERE entity_id=? AND action='inventory_count_line_refreshed'", sessionId).action, "inventory_count_line_refreshed");
});

test("partially posted sessions can be reopened for recount and cancelled without touching posted lines", async () => {
  const created = await countSessions.createCountSession(operator, { countType: "cycle", warehouseId: "wh-count", locationIds: ["loc-count"], effectiveDate: "2026-09-02", idempotencyKey: "audit-count-partial" });
  const sessionId = created.session.id;
  let workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  const lineA = workspace.lines.find((line) => line.productId === "prod-count-a");
  const lineB = workspace.lines.find((line) => line.productId === "prod-count-b");
  await countSessions.saveCountLine(operator, { sessionId, lineId: lineA.id, version: lineA.version, countedQuantity: Number(lineA.expectedQuantity) + 1, reason: "Found one" });
  await countSessions.saveCountLine(operator, { sessionId, lineId: lineB.id, version: lineB.version, countedQuantity: Number(lineB.expectedQuantity), reason: "" });
  await countSessions.submitCountSession(operator, { sessionId });
  await run("UPDATE inventory_balances SET on_hand_qty=13,version=version+1 WHERE product_id='prod-count-b' AND location_id='loc-count'");
  const post = await countSessions.postCountSession(operator, { sessionId, postingDate: "2026-09-02" });
  assert.deepEqual({ finished: post.finished, posted: post.postedCount, blocked: post.blocked.map((item) => item.code) }, { finished: false, posted: 1, blocked: ["VERSION_CONFLICT"] });
  const postedMovement = row("SELECT sm.id FROM inventory_counts ic JOIN stock_movements sm ON sm.source_document_id=ic.id WHERE ic.count_session_id=? AND ic.count_session_line_id=?", sessionId, lineA.id);
  assert.ok(postedMovement, "the posted line created a stock movement");

  // Reopen: the posted line stands; the conflicting line is re-baselined and back in counting.
  await countSessions.reopenCountSession(operator, { sessionId });
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  assert.equal(workspace.session.status, "counting");
  const reopenedA = workspace.lines.find((line) => line.id === lineA.id);
  const reopenedB = workspace.lines.find((line) => line.id === lineB.id);
  assert.equal(reopenedA.status, "posted");
  assert.deepEqual({ expected: reopenedB.expectedQuantity, counted: reopenedB.countedQuantity, variance: reopenedB.varianceQuantity, status: reopenedB.status, lastError: reopenedB.lastError },
    { expected: 13, counted: 11, variance: -2, status: "needs_reason", lastError: null });
  // The reopened line is editable again.
  await countSessions.saveCountLine(operator, { sessionId, lineId: reopenedB.id, version: reopenedB.version, countedQuantity: 13, reason: "" });
  assert.equal(row("SELECT status FROM inventory_count_session_lines WHERE id=?", lineB.id).status, "counted");

  // Cancel: remaining lines are cancelled, the session ends terminal, and the posted line is untouched.
  await countSessions.cancelCountSession(operator, { sessionId, reason: "Recount abandoned" });
  assert.equal(row("SELECT status FROM inventory_count_sessions WHERE id=?", sessionId).status, "cancelled");
  assert.deepEqual(rows("SELECT id,status FROM inventory_count_session_lines WHERE session_id=? ORDER BY product_id", sessionId), [{ id: lineA.id, status: "posted" }, { id: lineB.id, status: "cancelled" }]);
  assert.ok(row("SELECT id FROM stock_movements WHERE id=?", postedMovement.id), "posted stock movement stands after cancellation");
  assert.equal(row("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-count-a' AND location_id='loc-count'").on_hand_qty, 12);
  await assert.rejects(countSessions.saveCountLine(operator, { sessionId, lineId: lineB.id, version: 99, countedQuantity: 1 }), rejectsWithCode("INVALID_STATE"));
});

test("count session location scopes travel as one JSON parameter instead of one placeholder per location", async () => {
  const bulkIds = [];
  for (let index = 0; index < 120; index += 1) {
    const id = `loc-bulk-${String(index).padStart(3, "0")}`;
    bulkIds.push(id);
    await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES (?,?,?,'storage','usable','wh-count',1,1)", id, `BULK-${index}`, `Bulk bay ${index}`);
  }
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-count-a','loc-bulk-000',4,0,1)");
  db.preparedSql.length = 0;
  const created = await countSessions.createCountSession(operator, { countType: "cycle", warehouseId: "wh-count", locationIds: bulkIds, effectiveDate: "2026-09-02", idempotencyKey: "audit-count-bulk-scope" });
  assert.equal(created.session.lineCount, 1);
  const scopeCheck = lastPreparedSql("FROM locations WHERE active=1 AND warehouse_id=? AND id IN");
  const lineBuild = lastPreparedSql("INSERT OR IGNORE INTO inventory_count_session_lines");
  assert.match(scopeCheck, /json_each\(\?\)/);
  assert.match(lineBuild, /json_each\(\?\)/);
  assert.equal(placeholders(scopeCheck), 2);
  assert.equal(placeholders(lineBuild), 4);
  await assert.rejects(countSessions.createCountSession(operator, { countType: "cycle", warehouseId: "wh-count", locationIds: [...bulkIds, "loc-audit-a"], effectiveDate: "2026-09-02", idempotencyKey: "audit-count-bulk-foreign" }), rejectsWithCode("INVALID_LOCATION"));
});

// ---------------------------------------------------------------------------------------------
// #4B: a rejected variance approval releases the line for recount and re-request.
// ---------------------------------------------------------------------------------------------
test("a rejected variance approval releases the line for recount and a new approval request", async () => {
  await insertProduct("prod-count-c", "COUNT-C", 100, 200);
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-count-c','loc-count',20,0,1)");
  const created = await countSessions.createCountSession(operator, { countType: "correction", warehouseId: "wh-count", effectiveDate: "2026-09-02", idempotencyKey: "audit-count-rejected" });
  const sessionId = created.session.id;
  await countSessions.addCountLine(operator, { sessionId, productId: "prod-count-c", locationId: "loc-count" });
  let workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  let line = workspace.lines[0];
  await countSessions.saveCountLine(operator, { sessionId, lineId: line.id, version: line.version, countedQuantity: 30, reason: "Found a pallet" });
  await countSessions.submitCountSession(operator, { sessionId });
  const post = await countSessions.postCountSession(operator, { sessionId, postingDate: "2026-09-02" });
  assert.equal(post.blocked[0].code, "APPROVAL_REQUIRED");
  const requested = await countSessions.requestCountLineApproval(operator, { sessionId, lineId: line.id, idempotencyKey: "audit-count-rejected-request-1" });
  assert.equal(row("SELECT status FROM inventory_count_sessions WHERE id=?", sessionId).status, "awaiting_approval");
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  line = workspace.lines[0];
  // A pending request pins the line.
  await assert.rejects(countSessions.saveCountLine(operator, { sessionId, lineId: line.id, version: line.version, countedQuantity: 29, reason: "Recount" }), rejectsWithCode("APPROVAL_ALREADY_REQUESTED"));

  await advancedDomain.executeWorkflow({ command: "rejectApproval", entityId: requested.approvalId, version: 1, idempotencyKey: "audit-count-rejected-decision", actor: manager, payload: { reason: "Recount before I sign this" } });
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  line = workspace.lines[0];
  assert.equal(line.approvalStatus, "rejected");

  // The rejection releases the line: recount, which also settles the session back to review.
  await countSessions.saveCountLine(operator, { sessionId, lineId: line.id, version: line.version, countedQuantity: 27, reason: "Recounted with supervisor" });
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  line = workspace.lines[0];
  assert.deepEqual({ approvalId: line.approvalId, status: line.status, counted: line.countedQuantity, variance: line.varianceQuantity, session: workspace.session.status },
    { approvalId: null, status: "variance", counted: 27, variance: 7, session: "review" });

  const reRequested = await countSessions.requestCountLineApproval(operator, { sessionId, lineId: line.id, idempotencyKey: "audit-count-rejected-request-2" });
  assert.notEqual(reRequested.approvalId, requested.approvalId);
  assert.equal(row("SELECT status FROM inventory_count_sessions WHERE id=?", sessionId).status, "awaiting_approval");
  await countSessions.approveCountLine(manager, { sessionId, lineId: line.id, reason: "Recount verified", idempotencyKey: "audit-count-rejected-approve" });
  const finalPost = await countSessions.postCountSession(operator, { sessionId, postingDate: "2026-09-02" });
  assert.equal(finalPost.finished, true);
  assert.equal(row("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-count-c' AND location_id='loc-count'").on_hand_qty, 27);
});

test("refreshing a line pinned to a pending approval withdraws the request when the book quantity moved", async () => {
  await insertProduct("prod-count-d", "COUNT-D", 100, 200);
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-count-d','loc-count',20,0,1)");
  const created = await countSessions.createCountSession(operator, { countType: "correction", warehouseId: "wh-count", effectiveDate: "2026-09-02", idempotencyKey: "audit-count-withdraw" });
  const sessionId = created.session.id;
  await countSessions.addCountLine(operator, { sessionId, productId: "prod-count-d", locationId: "loc-count" });
  let workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  let line = workspace.lines[0];
  await countSessions.saveCountLine(operator, { sessionId, lineId: line.id, version: line.version, countedQuantity: 30, reason: "Found a pallet" });
  await countSessions.submitCountSession(operator, { sessionId });
  const requested = await countSessions.requestCountLineApproval(operator, { sessionId, lineId: line.id, idempotencyKey: "audit-count-withdraw-request" });
  await run("UPDATE inventory_balances SET on_hand_qty=25,version=version+1 WHERE product_id='prod-count-d' AND location_id='loc-count'");
  await countSessions.refreshCountLine(operator, { sessionId, lineId: line.id });
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  line = workspace.lines[0];
  assert.deepEqual({ approvalId: line.approvalId, expected: line.expectedQuantity, variance: line.varianceQuantity, status: line.status, session: workspace.session.status },
    { approvalId: null, expected: 25, variance: 5, status: "variance", session: "review" });
  assert.equal(row("SELECT status FROM approvals WHERE id=?", requested.approvalId).status, "canceled");
  const finalPost = await countSessions.postCountSession(operator, { sessionId, postingDate: "2026-09-02" });
  assert.equal(finalPost.finished, true);
});

// ---------------------------------------------------------------------------------------------
// #35: blind counts do not leak the book quantity through the API until submission.
// ---------------------------------------------------------------------------------------------
test("blind sessions hide expected quantities, variances, and variance states until submitted", async () => {
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-blind','BLIND-01','Blind bay','storage','usable','wh-count',1,1)");
  await insertProduct("prod-blind", "BLIND-A", 100, 200);
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-blind','loc-blind',8,0,1)");
  const created = await countSessions.createCountSession(operator, { countType: "cycle", warehouseId: "wh-count", locationIds: ["loc-blind"], blindCount: true, effectiveDate: "2026-09-02", idempotencyKey: "audit-count-blind" });
  const sessionId = created.session.id;
  let workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  assert.equal(workspace.lines.length, 1);
  assert.deepEqual({ expected: workspace.lines[0].expectedQuantity, variance: workspace.lines[0].varianceQuantity }, { expected: null, variance: null });
  const saved = await countSessions.saveCountLine(operator, { sessionId, lineId: workspace.lines[0].id, version: workspace.lines[0].version, countedQuantity: 6 });
  assert.equal(saved.message, "Count saved.");
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  assert.deepEqual({ expected: workspace.lines[0].expectedQuantity, variance: workspace.lines[0].varianceQuantity, status: workspace.lines[0].status, counted: workspace.lines[0].countedQuantity },
    { expected: null, variance: null, status: "counted", counted: 6 });
  assert.deepEqual({ varianceCount: workspace.session.varianceCount, varianceQuantity: workspace.session.varianceQuantity, varianceValueCents: workspace.session.varianceValueCents }, { varianceCount: 0, varianceQuantity: 0, varianceValueCents: 0 });
  assert.equal(workspace.sessions.find((session) => session.id === sessionId).varianceCount, 0);
  // The stored truth is intact; only the API view is concealed.
  assert.equal(row("SELECT status FROM inventory_count_session_lines WHERE session_id=?", sessionId).status, "needs_reason");

  await countSessions.submitCountSession(operator, { sessionId });
  workspace = await countSessions.getCountSessionWorkspace({ sessionId });
  assert.deepEqual({ expected: workspace.lines[0].expectedQuantity, variance: workspace.lines[0].varianceQuantity, status: workspace.lines[0].status, varianceCount: workspace.session.varianceCount },
    { expected: 8, variance: -2, status: "needs_reason", varianceCount: 1 });
});

// ---------------------------------------------------------------------------------------------
// #3: invoice-before-goods posts on hold; billing above the order is a clear hard stop.
// ---------------------------------------------------------------------------------------------
test("a vendor bill ahead of the receipt posts on hold and is released only once the goods arrive", async () => {
  await insertApprovedPurchaseOrder("po-audit-bill", [{ id: "pol-audit-bill", productId: "prod-audit-a", quantity: 10, unitCost: 100 }]);
  const held = await advancedDomain.executeWorkflow({ command: "createVendorBill", entityId: "po-audit-bill", version: 1, idempotencyKey: "audit-bill-before-receipt", actor: accountant, payload: {
    purchaseOrderId: "po-audit-bill", vendorInvoiceNumber: "AUDIT-INV-1", invoiceDate: "2026-09-02", dueDate: "2026-10-02", currency: "CAD", exchangeRateToBase: 1,
    lines: [{ purchaseOrderLineId: "pol-audit-bill", quantity: 4, unitCostCents: 100 }],
  } });
  assert.match(held.message, /posted on hold/);
  assert.equal(held.impact.matchStatus, "exception");
  const bill = row("SELECT id,status,match_status,hold_reason,version FROM vendor_bills WHERE id=?", held.recordId);
  assert.deepEqual({ status: bill.status, match: bill.match_status }, { status: "on_hold", match: "exception" });
  assert.deepEqual(JSON.parse(bill.hold_reason).map((exception) => exception.code), ["BILL_BEFORE_RECEIPT"]);
  assert.equal(row("SELECT match_status FROM vendor_bill_lines WHERE vendor_bill_id=?", bill.id).match_status, "exception");
  assert.equal(row("SELECT COUNT(*) AS count FROM approvals WHERE entity_id=? AND status='pending'", bill.id).count, 1);

  // Above the ordered quantity is rejected with a clear code and creates nothing.
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createVendorBill", entityId: "po-audit-bill", idempotencyKey: "audit-bill-above-ordered", actor: accountant, payload: {
    purchaseOrderId: "po-audit-bill", vendorInvoiceNumber: "AUDIT-INV-2", invoiceDate: "2026-09-02", dueDate: "2026-10-02",
    lines: [{ purchaseOrderLineId: "pol-audit-bill", quantity: 7, unitCostCents: 100 }],
  } }), (error) => error?.code === "BILLED_ABOVE_ORDERED" && error?.status === 409);
  assert.equal(row("SELECT COUNT(*) AS count FROM vendor_bills WHERE vendor_invoice_number='AUDIT-INV-2'").count, 0);

  // The hold is blocking until the receipt exists.
  await assert.rejects(advancedDomain.executeWorkflow({ command: "approveVendorBill", entityId: bill.id, version: bill.version, idempotencyKey: "audit-bill-approve-early", actor: manager, payload: { reason: "Pay it anyway" } }), rejectsWithCode("RECEIPT_REQUIRED"));
  await receive("po-audit-bill", "pol-audit-bill", 4, "audit-bill-receipt");
  await advancedDomain.executeWorkflow({ command: "approveVendorBill", entityId: bill.id, version: bill.version, idempotencyKey: "audit-bill-approve", actor: manager, payload: { reason: "Goods received" } });
  assert.deepEqual(row("SELECT status,match_status,hold_reason FROM vendor_bills WHERE id=?", bill.id), { status: "approved", match_status: "approved_variance", hold_reason: null });
  assert.equal(row("SELECT status FROM approvals WHERE entity_id=? AND request_type='vendor_bill_match_exception'", bill.id).status, "approved");

  // The fast-track variant records the same exception instead of failing the claim.
  const fastTracked = await advancedDomain.executeWorkflow({ command: "createApprovedVendorBill", entityId: "po-audit-bill", idempotencyKey: "audit-bill-fast-track", actor: manager, payload: {
    purchaseOrderId: "po-audit-bill", vendorInvoiceNumber: "AUDIT-INV-3", invoiceDate: "2026-09-02", dueDate: "2026-10-02", approvalReason: "Prepayment agreed with the vendor",
    lines: [{ purchaseOrderLineId: "pol-audit-bill", quantity: 2, unitCostCents: 100 }],
  } });
  assert.deepEqual(row("SELECT status,match_status FROM vendor_bills WHERE id=?", fastTracked.recordId), { status: "approved", match_status: "approved_variance" });
  assert.deepEqual(fastTracked.impact.exceptions.map((exception) => exception.code), ["BILL_BEFORE_RECEIPT"]);
});

// ---------------------------------------------------------------------------------------------
// #1 spillover + lower severity: landed cost uses json_each and refuses a second allocation.
// ---------------------------------------------------------------------------------------------
test("landed-cost allocation binds layer ids as JSON and refuses to allocate the same bill twice", async () => {
  await insertApprovedPurchaseOrder("po-audit-landed", [{ id: "pol-audit-landed", productId: "prod-audit-b", quantity: 10, unitCost: 150 }]);
  await receive("po-audit-landed", "pol-audit-landed", 3, "audit-landed-receipt-1");
  await receive("po-audit-landed", "pol-audit-landed", 2, "audit-landed-receipt-2");
  const layers = rows("SELECT cl.id FROM cost_layers cl JOIN stock_movements sm ON sm.id=cl.receipt_movement_id WHERE sm.purchase_order_line_id='pol-audit-landed' ORDER BY cl.received_qty DESC");
  assert.equal(layers.length, 2);
  for (const [billId, invoice] of [["bill-audit-landed", "AUDIT-LC-1"], ["bill-audit-landed-2", "AUDIT-LC-2"]]) {
    await run("INSERT INTO vendor_bills (id,number,vendor_invoice_number,vendor_id,purchase_order_id,status,match_status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,version,posted_at) VALUES (?,?,?,'vendor-audit','po-audit-landed','approved','matched','2026-09-02','2026-10-02',1000,0,1000,0,'CAD',1,1000,1,'2026-09-02T12:00:00Z')", billId, billId.toUpperCase(), invoice);
    await run("INSERT INTO document_charges (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at) VALUES (?,'vendor_bill',?,'freight','Inbound freight',1000,'add',0,0,NULL,0,0,'2026-09-02T12:00:00Z')", `charge-${billId}`, billId);
  }
  db.preparedSql.length = 0;
  const allocated = await advancedDomain.executeWorkflow({ command: "allocateLandedCost", idempotencyKey: "audit-landed-allocate", actor: accountant, payload: {
    sourceDocumentType: "vendor_bill", sourceDocumentId: "bill-audit-landed", amountCents: 1000, allocationBasis: "quantity", costLayerIds: layers.map((layer) => layer.id), postingDate: "2026-09-02",
  } });
  assert.match(allocated.message, /2 unconsumed cost layers/);
  assert.deepEqual(rows("SELECT landed_cost_cents FROM cost_layers WHERE id IN (?,?) ORDER BY received_qty DESC", layers[0].id, layers[1].id), [{ landed_cost_cents: 600 }, { landed_cost_cents: 400 }]);
  const layerLookup = lastPreparedSql("FROM cost_layers cl JOIN stock_movements sm ON sm.id=cl.receipt_movement_id LEFT JOIN");
  const claim = lastPreparedSql("NOT EXISTS (SELECT 1 FROM landed_cost_allocations WHERE source_document_type=? AND source_document_id=?)");
  assert.match(layerLookup, /json_each\(\?\)/);
  assert.match(claim, /json_each\(\?\)/);
  assert.equal(placeholders(layerLookup), 1);
  // Seven claim columns plus eight fixed predicates: the layer list never adds a placeholder.
  assert.equal(placeholders(claim), 15);

  await assert.rejects(advancedDomain.executeWorkflow({ command: "allocateLandedCost", idempotencyKey: "audit-landed-allocate-again", actor: accountant, payload: {
    sourceDocumentType: "vendor_bill", sourceDocumentId: "bill-audit-landed", amountCents: 500, allocationBasis: "quantity", costLayerIds: [layers[0].id], postingDate: "2026-09-02",
  } }), (error) => error?.code === "LANDED_COST_ALREADY_ALLOCATED" && error?.status === 409);

  // 120 layer ids still bind as a single parameter.
  const manyIds = Array.from({ length: 120 }, (_, index) => `layer-missing-${index}`);
  db.preparedSql.length = 0;
  await assert.rejects(advancedDomain.executeWorkflow({ command: "allocateLandedCost", idempotencyKey: "audit-landed-many", actor: accountant, payload: {
    sourceDocumentType: "vendor_bill", sourceDocumentId: "bill-audit-landed-2", amountCents: 1000, allocationBasis: "quantity", costLayerIds: manyIds, postingDate: "2026-09-02",
  } }), rejectsWithCode("NOT_FOUND"));
  assert.equal(placeholders(lastPreparedSql("FROM cost_layers cl JOIN stock_movements sm ON sm.id=cl.receipt_movement_id LEFT JOIN")), 1);
});

// ---------------------------------------------------------------------------------------------
// #16 / #36: rejected purchase orders can be edited and resubmitted; ad-hoc charges survive edits.
// ---------------------------------------------------------------------------------------------
test("a rejected purchase order can be edited as the next revision, keeps ad-hoc charges, and resubmits", async () => {
  const basePayload = { vendorId: "vendor-audit", expectedDate: "2026-09-20", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-10-20" };
  const draft = await advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "audit-rejected-po-create", actor: operator, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-audit-a", quantity: 2, unitCostCents: 100, taxable: false, taxRateBps: 0 }] } });
  const id = draft.recordId;
  await advancedDomain.executeWorkflow({ command: "submitPurchaseOrder", entityId: id, version: 1, idempotencyKey: "audit-rejected-po-submit", actor: operator, payload: { reason: "Quote accepted" } });
  await advancedDomain.executeWorkflow({ command: "rejectPurchaseOrder", entityId: id, version: 2, idempotencyKey: "audit-rejected-po-reject", actor: manager, payload: { reason: "Quantity too low for the job" } });
  assert.deepEqual(row("SELECT lifecycle_status,revision_number,version FROM purchase_orders WHERE id=?", id), { lifecycle_status: "rejected", revision_number: 1, version: 3 });

  // addDocumentCharge already accepts rejected orders; the charge must survive the line edit below.
  await advancedDomain.executeWorkflow({ command: "addDocumentCharge", entityId: id, version: 3, idempotencyKey: "audit-rejected-po-charge", actor: accountant, payload: { documentType: "purchase_order", chargeType: "customs", description: "Brokerage", amountCents: 250, direction: "add", taxable: false, refundable: false } });
  assert.deepEqual(row("SELECT total_cents,version FROM purchase_orders WHERE id=?", id), { total_cents: 450, version: 4 });

  const edited = await advancedDomain.executeWorkflow({ command: "updatePurchaseOrderDraft", entityId: id, version: 4, idempotencyKey: "audit-rejected-po-edit", actor: operator, payload: { ...basePayload, lines: [
    { kind: "item", productId: "prod-audit-a", quantity: 3, unitCostCents: 100, taxable: false, taxRateBps: 0 },
    { kind: "charge", chargeType: "freight", description: "Freight", amountCents: 500, taxable: false, taxRateBps: 0 },
  ] } });
  assert.match(edited.message, /revision 2/);
  assert.deepEqual(row("SELECT lifecycle_status,revision_number,total_cents,base_total_cents,version FROM purchase_orders WHERE id=?", id), { lifecycle_status: "draft", revision_number: 2, total_cents: 1050, base_total_cents: 1050, version: 5 });
  assert.deepEqual(rows("SELECT charge_type,amount_cents FROM document_charges WHERE document_type='purchase_order' AND document_id=? ORDER BY charge_type", id), [{ charge_type: "customs", amount_cents: 250 }, { charge_type: "freight", amount_cents: 500 }]);
  assert.deepEqual(rows("SELECT revision_number,lifecycle_status FROM purchase_order_revisions WHERE purchase_order_id=? ORDER BY revision_number", id), [{ revision_number: 1, lifecycle_status: "rejected" }, { revision_number: 2, lifecycle_status: "draft" }]);

  // A second edit of the (now draft) order updates revision 2 in place and keeps the customs charge.
  await advancedDomain.executeWorkflow({ command: "updatePurchaseOrderDraft", entityId: id, version: 5, idempotencyKey: "audit-rejected-po-edit-2", actor: operator, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-audit-a", quantity: 4, unitCostCents: 100, taxable: false, taxRateBps: 0 }] } });
  assert.deepEqual(row("SELECT revision_number,total_cents FROM purchase_orders WHERE id=?", id), { revision_number: 2, total_cents: 650 });
  assert.deepEqual(rows("SELECT charge_type FROM document_charges WHERE document_type='purchase_order' AND document_id=?", id), [{ charge_type: "customs" }]);
  assert.equal(row("SELECT COUNT(*) AS count FROM purchase_order_revisions WHERE purchase_order_id=?", id).count, 2);

  await advancedDomain.executeWorkflow({ command: "submitPurchaseOrder", entityId: id, version: 6, idempotencyKey: "audit-rejected-po-resubmit", actor: operator, payload: { reason: "Revised per reviewer" } });
  assert.deepEqual(row("SELECT lifecycle_status,revision_number FROM purchase_orders WHERE id=?", id), { lifecycle_status: "pending_approval", revision_number: 2 });
  assert.equal(row("SELECT lifecycle_status FROM purchase_order_revisions WHERE purchase_order_id=? AND revision_number=2", id).lifecycle_status, "pending_approval");
  assert.deepEqual(rows("SELECT status FROM approvals WHERE entity_type='purchase_order' AND entity_id=? ORDER BY requested_at,id", id).map((item) => item.status), ["rejected", "pending"]);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "updatePurchaseOrderDraft", entityId: id, version: 7, idempotencyKey: "audit-rejected-po-edit-pending", actor: operator, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-audit-a", quantity: 1, unitCostCents: 100 }] } }), rejectsWithCode("INVALID_STATE"));
});

test("sales-order draft edits keep charges the composer does not manage and recompute the total with them", async () => {
  const basePayload = { customerId: "customer-audit", requestedDate: "2026-09-20", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-10-20", shipToName: "Audit Site", shipToAddressLine1: "2 Audit Way", shipToCity: "Edmonton", shipToRegion: "AB", shipToPostalCode: "T5J 0N2", shipToCountry: "CA" };
  const draft = await advancedDomain.executeWorkflow({ command: "createSalesOrderDraft", entityId: "new", version: 0, idempotencyKey: "audit-so-charge-create", actor: operator, payload: { ...basePayload, lines: [
    { kind: "item", productId: "prod-audit-a", quantity: 1, unitPriceCents: 200, taxable: false, taxRateBps: 0 },
    { kind: "charge", chargeType: "freight", description: "Freight", amountCents: 300, taxable: false, taxRateBps: 0 },
  ] } });
  const id = draft.recordId;
  await advancedDomain.executeWorkflow({ command: "addDocumentCharge", entityId: id, version: 1, idempotencyKey: "audit-so-charge-add", actor: accountant, payload: { documentType: "sales_order", chargeType: "other", description: "Site delivery surcharge", amountCents: 75, direction: "add", taxable: false, refundable: false } });
  assert.equal(row("SELECT total_cents FROM sales_orders WHERE id=?", id).total_cents, 575);
  await advancedDomain.executeWorkflow({ command: "updateSalesOrderDraft", entityId: id, version: 2, idempotencyKey: "audit-so-charge-edit", actor: operator, payload: { ...basePayload, lines: [
    { kind: "item", productId: "prod-audit-a", quantity: 2, unitPriceCents: 200, taxable: false, taxRateBps: 0 },
    { kind: "charge", chargeType: "freight", description: "Freight", amountCents: 100, taxable: false, taxRateBps: 0 },
  ] } });
  assert.deepEqual(row("SELECT total_cents,base_total_cents FROM sales_orders WHERE id=?", id), { total_cents: 575, base_total_cents: 575 });
  assert.deepEqual(rows("SELECT charge_type,amount_cents FROM document_charges WHERE document_type='sales_order' AND document_id=? ORDER BY charge_type", id), [{ charge_type: "freight", amount_cents: 100 }, { charge_type: "other", amount_cents: 75 }]);
});

// ---------------------------------------------------------------------------------------------
// #19: user-authored margin rules beat the seeded catch-all; reprice only bumps changed prices.
// ---------------------------------------------------------------------------------------------
test("a global margin rule at the default priority beats the seeded catch-all and only changed prices bump versions", async () => {
  await insertProduct("prod-margin", "MARGIN-A", 1000, 2000, { category: "audit-margin", pricingMode: "automatic" });
  assert.equal((await catalogPricing.resolveMarginRule({ productId: "prod-margin", category: "audit-margin", costBasisCents: 1000 })).id, "margin-default-32");
  const rule = await advancedDomain.executeWorkflow({ command: "createMarginRule", idempotencyKey: "audit-margin-global", actor: administrator, payload: { code: "AUDIT-50", name: "Audit 50% global band", minimumCostCents: 0, maximumCostCents: null, targetMarginBps: 5000, minimumGrossProfitCents: 0, roundingIncrementCents: 100, priority: 0 } });
  assert.equal((await catalogPricing.resolveMarginRule({ productId: "prod-margin", category: "audit-margin", costBasisCents: 1000 })).id, rule.recordId);
  // The suggested price (1000 / 0.5 = 2000) already matches, so the product keeps its version.
  assert.deepEqual(row("SELECT selling_price_cents,applied_margin_rule_id,version FROM products WHERE id='prod-margin'"), { selling_price_cents: 2000, applied_margin_rule_id: rule.recordId, version: 1 });
  assert.equal(row("SELECT COUNT(*) AS count FROM catalog_price_history WHERE product_id='prod-margin'").count, 0);
  // The seed may still overlap; user rules in the same scope may not overlap each other.
  assert.equal(row("SELECT active FROM margin_rules WHERE id='margin-default-32'").active, 1);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createMarginRule", idempotencyKey: "audit-margin-overlap", actor: administrator, payload: { code: "AUDIT-40", name: "Overlapping band", minimumCostCents: 500, maximumCostCents: 5000, targetMarginBps: 4000, priority: 0 } }), rejectsWithCode("OVERLAPPING_MARGIN_RULE"));
  // A category rule that changes the price bumps the version and records history.
  const categoryRule = await advancedDomain.executeWorkflow({ command: "createMarginRule", idempotencyKey: "audit-margin-category", actor: administrator, payload: { code: "AUDIT-CAT-60", name: "Audit category 60%", category: "audit-margin", minimumCostCents: 0, maximumCostCents: null, targetMarginBps: 6000, roundingIncrementCents: 100, priority: 0 } });
  assert.deepEqual(row("SELECT selling_price_cents,applied_margin_rule_id,version FROM products WHERE id='prod-margin'"), { selling_price_cents: 2500, applied_margin_rule_id: categoryRule.recordId, version: 2 });
  assert.equal(row("SELECT COUNT(*) AS count FROM catalog_price_history WHERE product_id='prod-margin'").count, 1);
});

// ---------------------------------------------------------------------------------------------
// #23: amendments are entered in the ordered UOM and validated like every other entry point.
// ---------------------------------------------------------------------------------------------
test("purchase-order amendments convert from the ordered UOM, enforce precision, and restore on rejection", async () => {
  await run("INSERT INTO units_of_measure (id,code,name,dimension,precision,active) VALUES ('uom-audit-case','CASE6','Case of six','quantity',0,1)");
  await run("INSERT INTO uom_conversions (id,product_id,from_uom_id,to_uom_id,numerator,denominator,rounding_mode) VALUES ('uomconv-audit-case','prod-audit-a','uom-audit-case','uom-each',6,1,'nearest')");
  await insertApprovedPurchaseOrder("po-audit-amend", [{ id: "pol-audit-amend", productId: "prod-audit-a", quantity: 12, unitCost: 100, uomId: "uom-audit-case", uomQuantity: 2, uomUnitCost: 600 }]);
  await advancedDomain.executeWorkflow({ command: "amendPurchaseOrder", entityId: "po-audit-amend", version: 1, idempotencyKey: "audit-amend-cases", actor: operator, payload: { reason: "One more case", lines: [{ lineId: "pol-audit-amend", orderedQuantity: 3, unitCostCents: 660 }] } });
  assert.deepEqual(row("SELECT ordered_qty,unit_cost_cents,ordered_uom_qty,ordered_uom_unit_cost_cents FROM purchase_order_lines WHERE id='pol-audit-amend'"), { ordered_qty: 18, unit_cost_cents: 110, ordered_uom_qty: 3, ordered_uom_unit_cost_cents: 660 });
  assert.deepEqual(row("SELECT lifecycle_status,revision_number,total_cents FROM purchase_orders WHERE id='po-audit-amend'"), { lifecycle_status: "pending_approval", revision_number: 2, total_cents: 1980 });

  // Rejecting the amendment restores the prior base and entered-UOM quantities.
  await advancedDomain.executeWorkflow({ command: "rejectPurchaseOrder", entityId: "po-audit-amend", version: 2, idempotencyKey: "audit-amend-reject", actor: manager, payload: { reason: "Stay with two cases" } });
  assert.deepEqual(row("SELECT ordered_qty,unit_cost_cents,ordered_uom_qty,ordered_uom_unit_cost_cents FROM purchase_order_lines WHERE id='pol-audit-amend'"), { ordered_qty: 12, unit_cost_cents: 100, ordered_uom_qty: 2, ordered_uom_unit_cost_cents: 600 });
  assert.deepEqual(row("SELECT lifecycle_status,revision_number,total_cents FROM purchase_orders WHERE id='po-audit-amend'"), { lifecycle_status: "approved", revision_number: 1, total_cents: 1200 });

  // Fractional amendments of a whole-unit product are rejected instead of silently accepted.
  await insertApprovedPurchaseOrder("po-audit-amend-each", [{ id: "pol-audit-amend-each", productId: "prod-audit-a", quantity: 4, unitCost: 100 }]);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "amendPurchaseOrder", entityId: "po-audit-amend-each", version: 1, idempotencyKey: "audit-amend-fraction", actor: operator, payload: { reason: "Half a window", lines: [{ lineId: "pol-audit-amend-each", orderedQuantity: 2.5 }] } }), (error) => ["INVALID_QUANTITY_PRECISION", "DISCRETE_QUANTITY_REQUIRED"].includes(error?.code));
  assert.deepEqual(row("SELECT ordered_qty,lifecycle_status FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id WHERE pol.id='pol-audit-amend-each'"), { ordered_qty: 4, lifecycle_status: "approved" });
});

// ---------------------------------------------------------------------------------------------
// #25: yard is a storage-class location type.
// ---------------------------------------------------------------------------------------------
test("yard locations are accepted and can be edited while they hold stock", async () => {
  const created = await advancedDomain.executeWorkflow({ command: "createLocation", idempotencyKey: "audit-yard-create", actor: administrator, payload: { code: "AUDIT-YARD", name: "Outside yard", locationType: "yard", inventoryStatus: "usable", warehouseId: "wh-audit" } });
  const id = created.recordId;
  assert.equal(row("SELECT location_type FROM locations WHERE id=?", id).location_type, "yard");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-audit-b',?,5,0,1)", id);
  await advancedDomain.executeWorkflow({ command: "updateLocation", entityId: id, version: 1, idempotencyKey: "audit-yard-rename", actor: administrator, payload: { code: "AUDIT-YARD", name: "Outside yard east", locationType: "yard", inventoryStatus: "usable", warehouseId: "wh-audit" } });
  await advancedDomain.executeWorkflow({ command: "updateLocation", entityId: id, version: 2, idempotencyKey: "audit-yard-to-storage", actor: administrator, payload: { code: "AUDIT-YARD", name: "Outside yard east", locationType: "storage", inventoryStatus: "usable", warehouseId: "wh-audit" } });
  await assert.rejects(advancedDomain.executeWorkflow({ command: "updateLocation", entityId: id, version: 3, idempotencyKey: "audit-yard-to-receiving", actor: administrator, payload: { code: "AUDIT-YARD", name: "Outside yard east", locationType: "receiving", inventoryStatus: "usable", warehouseId: "wh-audit" } }), rejectsWithCode("LOCATION_HAS_STOCK"));
  await advancedDomain.executeWorkflow({ command: "updateLocation", entityId: id, version: 3, idempotencyKey: "audit-yard-back", actor: administrator, payload: { code: "AUDIT-YARD", name: "Outside yard", locationType: "yard", inventoryStatus: "usable", warehouseId: "wh-audit" } });
  assert.deepEqual(row("SELECT location_type,version FROM locations WHERE id=?", id), { location_type: "yard", version: 4 });
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createLocation", idempotencyKey: "audit-bogus-type", actor: administrator, payload: { code: "AUDIT-BOGUS", name: "Bogus", locationType: "field", inventoryStatus: "usable", warehouseId: "wh-audit" } }), rejectsWithCode("VALIDATION_ERROR"));
});

// ---------------------------------------------------------------------------------------------
// Lower severity: clear codes for same-location transfers; address defaults scoped to the row's partner.
// ---------------------------------------------------------------------------------------------
test("transferring inventory to its own location is a clear validation error", async () => {
  await assert.rejects(advancedDomain.executeWorkflow({ command: "transferInventory", entityId: "prod-audit-a", idempotencyKey: "audit-transfer-same", actor: operator, payload: { fromLocationId: "loc-audit-a", toLocationId: "loc-audit-a", quantity: 1, reason: "Oops", postingDate: "2026-09-02" } }), (error) => error?.code === "SAME_LOCATION" && error?.status === 400);
});

test("ship-to address defaults are scoped to the address's own partner", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('partner-audit-1','PA-1','Partner One','customer','CAD',1,1,'2026-09-01'),('partner-audit-2','PA-2','Partner Two','customer','CAD',1,1,'2026-09-01')");
  const address = { addressLine1: "1 Site Road", city: "Edmonton", region: "AB", postalCode: "T5J 0N9", country: "CA" };
  const first = await advancedDomain.executeWorkflow({ command: "createPartnerAddress", idempotencyKey: "audit-address-1", actor: operator, payload: { ...address, partnerId: "partner-audit-1", label: "Site 1", isDefault: true } });
  const other = await advancedDomain.executeWorkflow({ command: "createPartnerAddress", idempotencyKey: "audit-address-2", actor: operator, payload: { ...address, partnerId: "partner-audit-2", label: "Yard", isDefault: true } });
  await assert.rejects(advancedDomain.executeWorkflow({ command: "updatePartnerAddress", entityId: first.recordId, version: 1, idempotencyKey: "audit-address-move", actor: operator, payload: { ...address, partnerId: "partner-audit-2", label: "Site 1", isDefault: true } }), rejectsWithCode("VALIDATION_ERROR"));
  await advancedDomain.executeWorkflow({ command: "updatePartnerAddress", entityId: first.recordId, version: 1, idempotencyKey: "audit-address-rename", actor: operator, payload: { ...address, label: "Site 1 renamed", isDefault: true } });
  assert.deepEqual(row("SELECT partner_id,label,is_default FROM partner_addresses WHERE id=?", first.recordId), { partner_id: "partner-audit-1", label: "Site 1 renamed", is_default: 1 });
  assert.equal(row("SELECT is_default FROM partner_addresses WHERE id=?", other.recordId).is_default, 1);
  const second = await advancedDomain.executeWorkflow({ command: "createPartnerAddress", idempotencyKey: "audit-address-3", actor: operator, payload: { ...address, partnerId: "partner-audit-1", label: "Site 2", isDefault: true } });
  assert.deepEqual(rows("SELECT id,is_default FROM partner_addresses WHERE partner_id='partner-audit-1' ORDER BY label"), [{ id: first.recordId, is_default: 0 }, { id: second.recordId, is_default: 1 }]);
  await advancedDomain.executeWorkflow({ command: "updatePartnerAddress", entityId: second.recordId, version: 1, idempotencyKey: "audit-address-undefault", actor: operator, payload: { ...address, label: "Site 2", isDefault: false } });
  assert.equal(row("SELECT COUNT(*) AS count FROM partner_addresses WHERE partner_id='partner-audit-1' AND is_default=1").count, 0);
  assert.equal(row("SELECT is_default FROM partner_addresses WHERE id=?", other.recordId).is_default, 1);
});

test("a sales order is only 'invoiced' once every open unit is invoiced, not merely everything shipped so far", async () => {
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country) VALUES ('so-audit-billing','SO-AUDIT-BILL','customer-audit','confirmed','not_invoiced','2026-09-10','CAD',1,2000,2000,1,'2026-09-01','Audit Customer','1 Audit Way','Edmonton','AB','T5J 0N1','CA')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-audit-bill-1','so-audit-billing','prod-audit-a',5,0,200,'stock',0,0,0),('sol-audit-bill-2','so-audit-billing','prod-audit-b',5,0,200,'stock',0,0,0)");
  const ship = (lineId, productId, key) => run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,sales_order_line_id,posted_at,posted_by,idempotency_key) VALUES (?,'sales_shipment',?,-5,'loc-audit-a','usable','shipment',?,?,'2026-09-02T12:00:00Z','Audit Shipper',?)", key, productId, `shipment-${key}`, lineId, key);
  await ship("sol-audit-bill-1", "prod-audit-a", "audit-ship-1");
  await advancedDomain.executeWorkflow({ command: "createCustomerInvoice", entityId: "so-audit-billing", version: 1, idempotencyKey: "audit-invoice-1", actor: accountant, payload: { invoiceDate: "2026-09-02", dueDate: "2026-10-02" } });
  assert.equal(row("SELECT billing_status FROM sales_orders WHERE id='so-audit-billing'").billing_status, "partially_invoiced");
  await ship("sol-audit-bill-2", "prod-audit-b", "audit-ship-2");
  await advancedDomain.executeWorkflow({ command: "createCustomerInvoice", entityId: "so-audit-billing", version: 2, idempotencyKey: "audit-invoice-2", actor: accountant, payload: { invoiceDate: "2026-09-03", dueDate: "2026-10-03" } });
  assert.equal(row("SELECT billing_status FROM sales_orders WHERE id='so-audit-billing'").billing_status, "invoiced");
});

test("drop-ship delivery advances PO, SO, and invoice worklists without creating receipt or shipment work", async () => {
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-audit-drop','SO-AUDIT-DROP','customer-audit','confirmed','not_invoiced','2026-09-10','CAD',1,1800,1800,1,'2026-09-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-audit-drop','so-audit-drop','prod-audit-b',6,0,300,'drop_ship',0,0,0)");
  await insertApprovedPurchaseOrder("po-audit-drop", [{ id: "pol-audit-drop", productId: "prod-audit-b", quantity: 6, unitCost: 150, route: "drop_ship" }], { number: "PO-AUDIT-DROP" });
  await run("UPDATE purchase_order_lines SET source_sales_order_line_id='sol-audit-drop' WHERE id='pol-audit-drop'");
  await run("UPDATE sales_order_lines SET linked_purchase_order_line_id='pol-audit-drop' WHERE id='sol-audit-drop'");
  await run("INSERT INTO supply_allocations (id,purchase_order_line_id,sales_order_line_id,allocated_qty,received_qty,status,created_at,updated_at,version) VALUES ('allocation-audit-drop','pol-audit-drop','sol-audit-drop',6,0,'active','2026-09-01','2026-09-01',1)");

  await advancedDomain.executeWorkflow({ command: "postDropShipDelivery", entityId: "sol-audit-drop", version: 1, idempotencyKey: "audit-drop-delivery", actor: operator, payload: { quantity: 6, deliveryDate: "2026-09-02", externalReference: "POD-AUDIT-DROP" } });

  const purchasing = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: "PO-AUDIT-DROP" });
  const purchaseOrder = purchasing.purchaseOrders[0];
  assert.deepEqual({ fulfilled: purchaseOrder.supplierFulfilledQuantity, received: purchaseOrder.netReceivedQuantity, openReceive: purchaseOrder.openToReceiveQuantity, openDeliver: purchaseOrder.openToDeliverQuantity, open: purchaseOrder.openToFulfillQuantity, status: purchaseOrder.fulfillmentStatus },
    { fulfilled: 6, received: 0, openReceive: 0, openDeliver: 0, open: 0, status: "fully_fulfilled" });
  assert.deepEqual({ lineFulfilled: purchaseOrder.lines[0].supplierFulfilledQuantity, lineReceived: purchaseOrder.lines[0].netReceivedQuantity, lineOpen: purchaseOrder.lines[0].openToFulfillQuantity }, { lineFulfilled: 6, lineReceived: 0, lineOpen: 0 });

  const expectedReceipts = await inventoryDomain.getInventorySnapshot({ scope: "expected-receipts", status: "open", search: "PO-AUDIT-DROP" });
  assert.equal(expectedReceipts.purchaseOrders.length, 0);
  const sales = await inventoryDomain.getInventorySnapshot({ scope: "sales-orders", search: "SO-AUDIT-DROP" });
  const salesOrder = sales.salesOrders[0];
  assert.deepEqual({ fulfilled: salesOrder.fulfilledQuantity, shipped: salesOrder.shippedQuantity, openShip: salesOrder.openToShipQuantity, openDeliver: salesOrder.openToDeliverQuantity, open: salesOrder.openToFulfillQuantity, status: salesOrder.fulfillmentStatus },
    { fulfilled: 6, shipped: 0, openShip: 0, openDeliver: 0, open: 0, status: "fully_fulfilled" });
  assert.deepEqual({ lineFulfilled: salesOrder.lines[0].fulfilledQuantity, lineShipped: salesOrder.lines[0].shippedQuantity }, { lineFulfilled: 6, lineShipped: 0 });
  assert.deepEqual({ linkedNumber: salesOrder.lines[0].linkedPurchaseOrderNumber, linkedLifecycle: salesOrder.lines[0].linkedPurchaseOrderLifecycle }, { linkedNumber: "PO-AUDIT-DROP", linkedLifecycle: "approved" });
  const invoiceQueue = await inventoryDomain.getInventorySnapshot({ scope: "customer-invoices", search: "SO-AUDIT-DROP" });
  assert.equal(invoiceQueue.salesOrders[0].fulfilledQuantity, 6);
  assert.equal(invoiceQueue.salesOrders[0].invoicedQuantity, 0);
});

test("vendor bill register subtracts posted credits and exposes real outstanding and settled filters", async () => {
  await run("INSERT INTO vendor_bills (id,number,vendor_invoice_number,vendor_id,status,match_status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,version,posted_at) VALUES ('bill-audit-credit','VB-AUDIT-CREDIT','SUP-CREDIT','vendor-audit','approved','matched','2026-09-02','2026-10-02',1000,0,1000,0,'CAD',1,1000,1,'2026-09-02T12:00:00Z')");
  await run("INSERT INTO vendor_credits (id,number,vendor_id,vendor_bill_id,amount_cents,reason,status,posted_at,posted_by,version,currency,exchange_rate_to_base,base_amount_cents) VALUES ('credit-audit-bill','VC-AUDIT-BILL','vendor-audit','bill-audit-credit',1000,'Full supplier credit','posted','2026-09-03T12:00:00Z','Audit Accountant',1,'CAD',1,1000)");
  const settled = await inventoryDomain.getInventorySnapshot({ scope: "vendor-bills", status: "settled", search: "VB-AUDIT-CREDIT" });
  assert.equal(settled.bills.length, 1);
  assert.equal(settled.bills[0].outstandingCents, 0);
  const outstanding = await inventoryDomain.getInventorySnapshot({ scope: "vendor-bills", status: "outstanding", search: "VB-AUDIT-CREDIT" });
  assert.equal(outstanding.bills.length, 0);
});

test("early drop-ship bills use delivery language and PO billing tracks the committed quantity", async () => {
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-audit-early-drop','SO-AUDIT-EARLY-DROP','customer-audit','confirmed','not_invoiced','2026-09-10','CAD',1,1200,1200,1,'2026-09-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-audit-early-drop','so-audit-early-drop','prod-audit-b',4,0,300,'drop_ship',0,0,0)");
  await insertApprovedPurchaseOrder("po-audit-early-drop", [{ id: "pol-audit-early-drop", productId: "prod-audit-b", quantity: 4, unitCost: 150, route: "drop_ship" }]);
  await run("UPDATE purchase_order_lines SET source_sales_order_line_id='sol-audit-early-drop' WHERE id='pol-audit-early-drop'");
  await run("UPDATE sales_order_lines SET linked_purchase_order_line_id='pol-audit-early-drop' WHERE id='sol-audit-early-drop'");
  await run("INSERT INTO supply_allocations (id,purchase_order_line_id,sales_order_line_id,allocated_qty,received_qty,status,created_at,updated_at,version) VALUES ('allocation-audit-early-drop','pol-audit-early-drop','sol-audit-early-drop',4,0,'active','2026-09-01','2026-09-01',1)");

  const firstBill = await advancedDomain.executeWorkflow({ command: "createVendorBill", entityId: "po-audit-early-drop", version: 1, idempotencyKey: "audit-early-drop-bill-1", actor: accountant, payload: {
    purchaseOrderId: "po-audit-early-drop", vendorInvoiceNumber: "AUDIT-EARLY-DROP-1", invoiceDate: "2026-09-02", dueDate: "2026-10-02",
    lines: [{ purchaseOrderLineId: "pol-audit-early-drop", quantity: 2, unitCostCents: 150 }],
  } });
  assert.deepEqual(firstBill.impact.exceptions.map((exception) => exception.code), ["BILL_BEFORE_DELIVERY"]);
  assert.equal(row("SELECT billing_status FROM purchase_orders WHERE id='po-audit-early-drop'").billing_status, "partially_billed");

  const secondBill = await advancedDomain.executeWorkflow({ command: "createVendorBill", entityId: "po-audit-early-drop", version: 2, idempotencyKey: "audit-early-drop-bill-2", actor: accountant, payload: {
    purchaseOrderId: "po-audit-early-drop", vendorInvoiceNumber: "AUDIT-EARLY-DROP-2", invoiceDate: "2026-09-02", dueDate: "2026-10-02",
    lines: [{ purchaseOrderLineId: "pol-audit-early-drop", quantity: 2, unitCostCents: 150 }],
  } });
  assert.equal(row("SELECT billing_status FROM purchase_orders WHERE id='po-audit-early-drop'").billing_status, "fully_billed");

  const delivery = await advancedDomain.executeWorkflow({ command: "postDropShipDelivery", entityId: "sol-audit-early-drop", version: 1, idempotencyKey: "audit-early-drop-delivery", actor: operator, payload: { quantity: 4, deliveryDate: "2026-09-03", externalReference: "POD-EARLY-DROP" } });
  await assert.rejects(advancedDomain.executeWorkflow({ command: "reverseDropShipDelivery", entityId: delivery.recordId, version: 1, idempotencyKey: "audit-early-drop-reverse", actor: operator, payload: { quantity: 1, postingDate: "2026-09-03", reason: "Supplier corrected proof" } }), rejectsWithCode("BILLED_DELIVERY"));
  await advancedDomain.executeWorkflow({ command: "voidVendorBill", entityId: firstBill.recordId, version: 1, idempotencyKey: "audit-early-drop-void-1", actor: accountant, payload: { reason: "Vendor invoice was premature" } });
  assert.equal(row("SELECT billing_status FROM purchase_orders WHERE id='po-audit-early-drop'").billing_status, "partially_billed");
  await advancedDomain.executeWorkflow({ command: "voidVendorBill", entityId: secondBill.recordId, version: 1, idempotencyKey: "audit-early-drop-void-2", actor: accountant, payload: { reason: "Vendor invoice was premature" } });
  assert.equal(row("SELECT billing_status FROM purchase_orders WHERE id='po-audit-early-drop'").billing_status, "not_billed");
  await advancedDomain.executeWorkflow({ command: "reverseDropShipDelivery", entityId: delivery.recordId, version: 1, idempotencyKey: "audit-early-drop-reverse-after-void", actor: operator, payload: { quantity: 1, postingDate: "2026-09-03", reason: "Supplier corrected proof" } });
});

test("closing dedicated supply releases the unfulfilled allocation so customer demand can be canceled", async () => {
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-audit-close-drop','SO-AUDIT-CLOSE-DROP','customer-audit','confirmed','not_invoiced','2026-09-10','CAD',1,1200,1200,1,'2026-09-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-audit-close-drop','so-audit-close-drop','prod-audit-b',4,0,300,'drop_ship',0,0,0)");
  await insertApprovedPurchaseOrder("po-audit-close-drop", [{ id: "pol-audit-close-drop", productId: "prod-audit-b", quantity: 4, unitCost: 150, route: "drop_ship" }]);
  await run("UPDATE purchase_order_lines SET source_sales_order_line_id='sol-audit-close-drop' WHERE id='pol-audit-close-drop'");
  await run("UPDATE sales_order_lines SET linked_purchase_order_line_id='pol-audit-close-drop' WHERE id='sol-audit-close-drop'");
  await run("INSERT INTO supply_allocations (id,purchase_order_line_id,sales_order_line_id,allocated_qty,received_qty,status,created_at,updated_at,version) VALUES ('allocation-audit-close-drop','pol-audit-close-drop','sol-audit-close-drop',4,0,'active','2026-09-01','2026-09-01',1)");

  const delivery = await advancedDomain.executeWorkflow({ command: "postDropShipDelivery", entityId: "sol-audit-close-drop", version: 1, idempotencyKey: "audit-close-drop-delivery", actor: operator, payload: { quantity: 2, deliveryDate: "2026-09-02", externalReference: "POD-CLOSE-DROP" } });
  await inventoryDomain.executeInventoryCommand({ command: "closeRemainder", entityId: "po-audit-close-drop", version: 2, idempotencyKey: "audit-close-drop-remainder", payload: { lineId: "pol-audit-close-drop", quantity: 2, reason: "Vendor cannot supply balance", actor: "Audit Buyer" } });
  assert.deepEqual(row("SELECT allocated_qty,received_qty,status FROM supply_allocations WHERE id='allocation-audit-close-drop'"), { allocated_qty: 2, received_qty: 2, status: "active" });
  assert.equal(row("SELECT closed_qty FROM purchase_order_lines WHERE id='pol-audit-close-drop'").closed_qty, 2);

  await advancedDomain.executeWorkflow({ command: "cancelSalesOrder", entityId: "so-audit-close-drop", version: 3, idempotencyKey: "audit-close-drop-cancel-sale", actor: operator, payload: { reason: "Customer canceled unsupplied balance" } });
  assert.deepEqual(row("SELECT lifecycle_status FROM sales_orders WHERE id='so-audit-close-drop'"), { lifecycle_status: "canceled" });
  assert.deepEqual(row("SELECT canceled_qty FROM sales_order_lines WHERE id='sol-audit-close-drop'"), { canceled_qty: 2 });

  await advancedDomain.executeWorkflow({ command: "reverseDropShipDelivery", entityId: delivery.recordId, version: 1, idempotencyKey: "audit-close-drop-reverse", actor: operator, payload: { quantity: 1, postingDate: "2026-09-03", reason: "Delivery proof overstated" } });
  assert.deepEqual(row("SELECT canceled_qty FROM sales_order_lines WHERE id='sol-audit-close-drop'"), { canceled_qty: 3 });
  assert.deepEqual(row("SELECT allocated_qty,received_qty,status FROM supply_allocations WHERE id='allocation-audit-close-drop'"), { allocated_qty: 1, received_qty: 1, status: "active" });
  const corrections = await advancedDomain.getAdvancedSnapshot(operator, { scope: "sales", page: 1, pageSize: 100 });
  assert.equal(corrections.dropShipDeliveries.some((item) => item.id === delivery.recordId && item.netDeliveredQuantity === 1), true);
});

test("a partial immediate sale stays partially invoiced and a canceled order still accepts its customer return", async () => {
  await insertProduct("prod-audit-immediate", "AUDIT-IMMEDIATE", 125, 250);
  await insertApprovedPurchaseOrder("po-audit-immediate-stock", [{ id: "pol-audit-immediate-stock", productId: "prod-audit-immediate", quantity: 3, unitCost: 125 }]);
  await receive("po-audit-immediate-stock", "pol-audit-immediate-stock", 3, "audit-immediate-stock-receipt");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country) VALUES ('so-audit-immediate-flow','SO-AUDIT-IMMEDIATE-FLOW','customer-audit','confirmed','not_invoiced','2026-09-10','CAD',1,750,750,1,'2026-09-01','Audit Customer','1 Audit Way','Edmonton','AB','T5J 0N1','CA')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-audit-immediate-flow','so-audit-immediate-flow','prod-audit-immediate',3,0,250,'stock',0,0,0)");

  const sale = await inventoryDomain.executeInventoryCommand({ command: "postImmediateSale", entityId: "so-audit-immediate-flow", version: 1, idempotencyKey: "audit-immediate-flow-sale", payload: { lineId: "sol-audit-immediate-flow", quantity: 1, locationId: "loc-audit-a", postingDate: "2026-09-02", actor: "Audit Seller" } });
  assert.equal(row("SELECT billing_status FROM sales_orders WHERE id='so-audit-immediate-flow'").billing_status, "partially_invoiced");
  await advancedDomain.executeWorkflow({ command: "cancelSalesOrder", entityId: "so-audit-immediate-flow", version: 2, idempotencyKey: "audit-immediate-flow-cancel", actor: operator, payload: { reason: "Customer canceled the balance" } });
  assert.equal(row("SELECT canceled_qty FROM sales_order_lines WHERE id='sol-audit-immediate-flow'").canceled_qty, 2);

  await inventoryDomain.executeInventoryCommand({ command: "postCustomerReturn", entityId: "so-audit-immediate-flow", version: 3, idempotencyKey: "audit-immediate-flow-return", payload: { lineId: "sol-audit-immediate-flow", quantity: 1, locationId: "loc-audit-a", condition: "usable", postingDate: "2026-09-03", reason: "Customer returned item", actor: "Audit Receiver" } });
  assert.equal(row("SELECT COUNT(*) AS count FROM customer_returns WHERE sales_order_id='so-audit-immediate-flow'").count, 1);
  await advancedDomain.executeWorkflow({ command: "voidCustomerInvoice", entityId: sale.invoiceId, version: 1, idempotencyKey: "audit-immediate-flow-void", actor: accountant, payload: { reason: "Testing the physical correction boundary" } });
  const corrections = await advancedDomain.getAdvancedSnapshot(operator, { scope: "sales", page: 1, pageSize: 100 });
  assert.equal(corrections.shipments.some((item) => item.id === sale.shipmentId), false);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "reverseShipment", entityId: sale.shipmentId, version: 1, idempotencyKey: "audit-immediate-flow-double-correction", actor: operator, payload: { quantity: 1, postingDate: "2026-09-03", reason: "Duplicate correction" } }), rejectsWithCode("RETURNED_SHIPMENT"));
});

test("a canceled stock order keeps its uninvoiced shipment available for correction", async () => {
  await insertProduct("prod-audit-canceled-shipment", "AUDIT-CANCELED-SHIP", 140, 280);
  await insertApprovedPurchaseOrder("po-audit-canceled-shipment", [{ id: "pol-audit-canceled-shipment", productId: "prod-audit-canceled-shipment", quantity: 2, unitCost: 140 }]);
  await receive("po-audit-canceled-shipment", "pol-audit-canceled-shipment", 2, "audit-canceled-shipment-receipt");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country) VALUES ('so-audit-canceled-shipment','SO-AUDIT-CANCELED-SHIP','customer-audit','confirmed','not_invoiced','2026-09-10','CAD',1,560,560,1,'2026-09-01','Audit Customer','1 Audit Way','Edmonton','AB','T5J 0N1','CA')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-audit-canceled-shipment','so-audit-canceled-shipment','prod-audit-canceled-shipment',2,0,280,'stock',0,0,0)");
  await inventoryDomain.executeInventoryCommand({ command: "reserveSale", entityId: "so-audit-canceled-shipment", version: 1, idempotencyKey: "audit-canceled-shipment-reserve", payload: { lineId: "sol-audit-canceled-shipment", quantity: 1, locationId: "loc-audit-a", actor: "Audit Seller" } });
  await inventoryDomain.executeInventoryCommand({ command: "shipSale", entityId: "so-audit-canceled-shipment", version: 2, idempotencyKey: "audit-canceled-shipment-ship", payload: { lineId: "sol-audit-canceled-shipment", quantity: 1, carrier: "Audit Freight", trackingNumber: "AUDIT-CANCEL-1", postingDate: "2026-09-02", actor: "Audit Seller" } });
  await advancedDomain.executeWorkflow({ command: "cancelSalesOrder", entityId: "so-audit-canceled-shipment", version: 3, idempotencyKey: "audit-canceled-shipment-cancel", actor: operator, payload: { reason: "Customer canceled remaining unit" } });
  const shipment = row("SELECT id,version FROM shipments WHERE sales_order_id='so-audit-canceled-shipment'");
  const visibleBefore = await advancedDomain.getAdvancedSnapshot(operator, { scope: "sales", page: 1, pageSize: 100 });
  assert.equal(visibleBefore.shipments.some((item) => item.id === shipment.id && item.quantity === 1), true);
  await advancedDomain.executeWorkflow({ command: "reverseShipment", entityId: shipment.id, version: shipment.version, idempotencyKey: "audit-canceled-shipment-reverse", actor: operator, payload: { quantity: 1, postingDate: "2026-09-03", reason: "Shipment was posted in error" } });
  assert.deepEqual(row("SELECT canceled_qty FROM sales_order_lines WHERE id='sol-audit-canceled-shipment'"), { canceled_qty: 2 });
});

test("fully closing unreceived dedicated supply clears the link and dedicated quantity cannot be reopened blindly", async () => {
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-audit-close-special','SO-AUDIT-CLOSE-SPECIAL','customer-audit','confirmed','not_invoiced','2026-09-10','CAD',1,900,900,1,'2026-09-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-audit-close-special','so-audit-close-special','prod-audit-b',3,0,300,'special_order',0,0,0)");
  await insertApprovedPurchaseOrder("po-audit-close-special", [{ id: "pol-audit-close-special", productId: "prod-audit-b", quantity: 3, unitCost: 150, route: "special_order" }]);
  await run("UPDATE purchase_order_lines SET source_sales_order_line_id='sol-audit-close-special' WHERE id='pol-audit-close-special'");
  await run("UPDATE sales_order_lines SET linked_purchase_order_line_id='pol-audit-close-special' WHERE id='sol-audit-close-special'");
  await run("INSERT INTO supply_allocations (id,purchase_order_line_id,sales_order_line_id,allocated_qty,received_qty,status,created_at,updated_at,version) VALUES ('allocation-audit-close-special','pol-audit-close-special','sol-audit-close-special',3,0,'active','2026-09-01','2026-09-01',1)");
  await inventoryDomain.executeInventoryCommand({ command: "closeRemainder", entityId: "po-audit-close-special", version: 1, idempotencyKey: "audit-close-special-remainder", payload: { lineId: "pol-audit-close-special", quantity: 3, reason: "Vendor declined", actor: "Audit Buyer" } });
  assert.deepEqual(row("SELECT status FROM supply_allocations WHERE id='allocation-audit-close-special'"), { status: "released" });
  assert.deepEqual(row("SELECT linked_purchase_order_line_id FROM sales_order_lines WHERE id='sol-audit-close-special'"), { linked_purchase_order_line_id: null });
  await assert.rejects(inventoryDomain.executeInventoryCommand({ command: "reopenRemainder", entityId: "po-audit-close-special", version: 2, idempotencyKey: "audit-reopen-special-remainder", payload: { lineId: "pol-audit-close-special", quantity: 1, expectedDate: "2026-09-20", reason: "Vendor changed its mind", actor: "Audit Buyer" } }), rejectsWithCode("FULFILLMENT_ROUTE_BLOCKED"));
});
