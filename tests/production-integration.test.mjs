import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";
import { calculateSalesAvailability } from "../lib/domain/sales-availability.ts";

const db = new D1SqliteDatabase();
let inventoryDb;
let inventoryDomain;
let advancedDomain;
let outboxModule;
let auth;
let exportsModule;
let reportsModule;
let countSessions;

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

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  env.BOOTSTRAP_DEMO_DATA = "false";
  inventoryDb = await import("../lib/server/inventory-db.ts");
  inventoryDomain = await import("../lib/server/inventory-domain.ts");
  advancedDomain = await import("../lib/server/advanced-domain.ts");
  outboxModule = await import("../lib/server/outbox.ts");
  auth = await import("../lib/server/auth.ts");
  exportsModule = await import("../lib/server/exports.ts");
  reportsModule = await import("../lib/server/reports.ts");
  countSessions = await import("../lib/server/inventory-count-sessions.ts");
});

after(() => db.close());

test("a clean migration chain boots the production database contract", async () => {
  await inventoryDb.ensureDatabase();
  const columns = db.sqlite.prepare("PRAGMA table_info(purchase_order_lines)").all().map((row) => row.name);
  assert.ok(columns.includes("source_sales_order_line_id"));
  const index = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_purchase_order_lines_source_sales_line'").get();
  assert.equal(index.name, "idx_purchase_order_lines_source_sales_line");
  const trigger = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='stock_movements_immutable_update'").get();
  assert.equal(trigger.name, "stock_movements_immutable_update");
  const balanceFks = db.sqlite.prepare("PRAGMA foreign_key_list(inventory_balances)").all().map((row) => row.table).sort();
  assert.deepEqual(balanceFks, ["locations", "products"]);
  const productColumns = db.sqlite.prepare("PRAGMA table_info(products)").all().map((row) => row.name);
  assert.ok(productColumns.includes("last_unit_cost_cents"));
  assert.ok(productColumns.includes("suggested_selling_price_cents"));
  assert.ok(productColumns.includes("pricing_mode"));
  assert.equal(db.sqlite.prepare("SELECT target_margin_bps FROM margin_rules WHERE id='margin-default-32'").get().target_margin_bps, 3200);
  assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_cost_history'").get());
  assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_price_history'").get());
  await assert.rejects(run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('missing-product','missing-location',1,0,1)"), /FOREIGN KEY constraint failed|CROSS_TENANT_REFERENCE/);
});

test("the pricing migration backfills the latest approved PO without overwriting today's catalog price", async () => {
  const legacy = new D1SqliteDatabase();
  try {
    const directory = new URL("../drizzle/", import.meta.url);
    const files = (await readdir(directory)).filter((name) => /^00(?:0\d|1\d|2[0-2]).*\.sql$/.test(name)).sort();
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) legacy.exec(statement);
    }
    const legacyRun = (sql, ...values) => legacy.prepare(sql).bind(...values).run();
    const legacyUomId = legacy.sqlite.prepare("SELECT id FROM units_of_measure WHERE code='EA'").get().id;
    await legacyRun("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('legacy-vendor','LEG-V','Legacy Vendor','vendor','USD',1,1,'2026-01-01')");
    await legacyRun("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('legacy-product','LEG-1','Legacy Product','Legacy','Test','Test','Test','quantity','stocked',500,999,0,?,?,?,1,1,'2026-01-01')", legacyUomId, legacyUomId, legacyUomId);
    await legacyRun("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,revision_number,created_at) VALUES ('legacy-po','PO-LEGACY','legacy-vendor','approved','not_billed','2026-02-01','USD',1.25,2000,1600,1,2,'2026-02-01T12:00:00Z')");
    await legacyRun("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,discount_cents,fulfillment_route,version) VALUES ('legacy-line-a','legacy-po','legacy-product',1,0,800,100,'stock',1),('legacy-line-b','legacy-po','legacy-product',1,0,800,100,'stock',1)");
    const pricingSql = await readFile(new URL("0023_clear_northstar.sql", directory), "utf8");
    for (const statement of pricingSql.split("--> statement-breakpoint")) if (statement.trim()) legacy.exec(statement);

    assert.deepEqual({ ...legacy.sqlite.prepare("SELECT last_unit_cost_cents,last_unit_cost_source_po_id,suggested_selling_price_cents,selling_price_cents,pricing_mode,manual_price_reason FROM products WHERE id='legacy-product'").get() }, {
      last_unit_cost_cents: 875,
      last_unit_cost_source_po_id: "legacy-po",
      suggested_selling_price_cents: 1300,
      selling_price_cents: 999,
      pricing_mode: "manual",
      manual_price_reason: "Existing catalog price preserved during automatic-pricing rollout",
    });
    assert.deepEqual({ ...legacy.sqlite.prepare("SELECT source_purchase_order_line_id,purchase_order_revision,last_unit_cost_cents,source_currency,exchange_rate_to_base FROM product_cost_history WHERE product_id='legacy-product'").get() }, {
      source_purchase_order_line_id: null,
      purchase_order_revision: 2,
      last_unit_cost_cents: 875,
      source_currency: "USD",
      exchange_rate_to_base: 1.25,
    });
  } finally { legacy.close(); }
});

test("sales availability treats this order's reservation as committed coverage", () => {
  assert.deepEqual(calculateSalesAvailability(1, 1, 0, 0), {
    required: 1,
    reserved: 1,
    uncovered: 0,
    availableNow: 0,
    incomingBeforeDate: 0,
    shortage: 0,
  });
  assert.deepEqual(calculateSalesAvailability(4, 1, 1, 1), {
    required: 4,
    reserved: 1,
    uncovered: 3,
    availableNow: 1,
    incomingBeforeDate: 1,
    shortage: 1,
  });
});

test("the transactional outbox signs delivery and retains failures for retry", async () => {
  const originalFetch = globalThis.fetch;
  env.OUTBOX_WEBHOOK_URL = "https://integrations.example.test/paneflow";
  env.OUTBOX_WEBHOOK_SECRET = "test-secret";
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('outbox-success','inventory.test','product','prod-a','{\"quantity\":2}','pending',0,'2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')");
  let delivered;
  try {
    globalThis.fetch = async (input, init) => { delivered = { input: String(input), init }; return new Response("ok", { status: 200 }); };
    const success = await outboxModule.processOutboxBatch({ limit: 10 });
    assert.deepEqual(success, { configured: true, claimed: 1, processed: 1, failed: 0 });
    assert.equal(delivered.input, env.OUTBOX_WEBHOOK_URL);
    assert.equal(delivered.init.headers["x-paneflow-event-id"], "outbox-success");
    assert.match(delivered.init.headers["x-paneflow-signature"], /^sha256=[0-9a-f]{64}$/);
    assert.equal(JSON.parse(delivered.init.body).payload.quantity, 2);
    assert.deepEqual({ ...db.sqlite.prepare("SELECT status,attempts,locked_at,last_error FROM outbox_events WHERE id='outbox-success'").get() }, { status: "processed", attempts: 1, locked_at: null, last_error: null });

    await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('outbox-failure','inventory.test','product','prod-a','{}','pending',0,'2026-08-01T00:00:00.000Z','2026-08-01T00:00:01.000Z')");
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    const failure = await outboxModule.processOutboxBatch({ limit: 10 });
    assert.deepEqual(failure, { configured: true, claimed: 1, processed: 0, failed: 1 });
    const failed = db.sqlite.prepare("SELECT status,attempts,available_at,last_error FROM outbox_events WHERE id='outbox-failure'").get();
    assert.equal(failed.status, "failed");
    assert.equal(failed.attempts, 1);
    assert.match(failed.last_error, /HTTP 503/);
    assert.ok(failed.available_at > new Date().toISOString());
  } finally {
    globalThis.fetch = originalFetch;
    delete env.OUTBOX_WEBHOOK_URL;
    delete env.OUTBOX_WEBHOOK_SECRET;
  }

  const deletedKeys = [];
  let storageAttempts = 0;
  env.FILES = { delete: async (key) => { storageAttempts += 1; if (storageAttempts === 1) throw new Error("R2 temporarily unavailable"); deletedKeys.push(key); } };
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('outbox-attachment-delete','attachment.delete_requested','sales_order','so-storage','{\"attachmentId\":\"attachment-storage\",\"objectKey\":\"sales_order/so-storage/attachment-storage/proof.pdf\"}','pending',0,'2026-08-01T00:00:00.000Z','2026-08-01T00:00:02.000Z')");
  const localFailure = await outboxModule.processOutboxBatch({ limit: 10 });
  assert.deepEqual(localFailure, { configured: false, claimed: 1, processed: 0, failed: 1 });
  await run("UPDATE outbox_events SET available_at='2026-08-01T00:00:00.000Z' WHERE id='outbox-attachment-delete'");
  const localRetry = await outboxModule.processOutboxBatch({ limit: 10 });
  assert.deepEqual(localRetry, { configured: false, claimed: 1, processed: 1, failed: 0 });
  assert.deepEqual(deletedKeys, ["sales_order/so-storage/attachment-storage/proof.pdf"]);
  delete env.FILES;
});

test("production snapshots execute with bounded pagination on the migrated schema", async () => {
  const actor = { id: "viewer", email: "viewer@example.com", name: "Viewer", role: "viewer", label: "Viewer <viewer@example.com>", localDevelopment: false };
  const core = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 5 });
  const advanced = await advancedDomain.getAdvancedSnapshot(actor, { page: 1, pageSize: 5 });
  // countBalances is the cycle-count worklist total: that view pages over countable balances
  // rather than over the catalog, so it needs a total of its own.
  assert.deepEqual({ page: core.pagination.page, pageSize: core.pagination.pageSize, filteredTotal: core.pagination.filteredTotal }, { page: 1, pageSize: 5, filteredTotal: null });
  assert.ok(Object.values(core.pagination.totals).every((total) => Number.isSafeInteger(total) && total >= 0));
  assert.deepEqual(advanced.pagination, { page: 1, pageSize: 5 });
});

test("worklist search reaches records beyond the first database page", async () => {
  for (let index = 0; index < 60; index += 1) {
    const suffix = String(index).padStart(4, "0");
    await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `prod-scale-${suffix}`, `SCALE-${suffix}`, `Scale product ${suffix}`, "test", "test", "test", "test", "quantity", "stocked", 100, 200, 0, "uom-each", "uom-each", "uom-each", 1, 1, "2026-08-01");
  }
  const snapshot = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 5, scope: "products", search: "SCALE-0059", sort: "name" });
  assert.equal(snapshot.pagination.filteredTotal, 1);
  assert.deepEqual(snapshot.products.map((product) => product.sku), ["SCALE-0059"]);
});

test("purchase-order worklists expose completed and closed-short filters", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('vendor-completion-filter','VEND-COMPLETE','Completion Filter Vendor','vendor','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-completion-filter','SKU-COMPLETE','Completion Filter Product','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  for (const [id, number] of [["po-filter-fully", "PO-FILTER-FULLY"], ["po-filter-short", "PO-FILTER-SHORT"], ["po-filter-open", "PO-FILTER-OPEN"]]) {
    await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES (?,?,?,'approved','not_billed','2026-08-15','CAD',1,1000,1000,1,'2026-08-01')", id, number, "vendor-completion-filter");
  }
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route) VALUES ('pol-filter-fully','po-filter-fully','prod-completion-filter',10,0,100,'stock')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route) VALUES ('pol-filter-short','po-filter-short','prod-completion-filter',10,4,100,'stock')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route) VALUES ('pol-filter-open','po-filter-open','prod-completion-filter',10,0,100,'stock')");
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,inventory_status,source_document_type,source_document_id,purchase_order_line_id,posted_at,posted_by,idempotency_key) VALUES ('movement-filter-fully','purchase_receipt','prod-completion-filter',10,'usable','receipt','receipt-filter-fully','pol-filter-fully','2026-08-16T12:00:00Z','Tester','filter-fully')");
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,inventory_status,source_document_type,source_document_id,purchase_order_line_id,posted_at,posted_by,idempotency_key) VALUES ('movement-filter-short','purchase_receipt','prod-completion-filter',6,'usable','receipt','receipt-filter-short','pol-filter-short','2026-08-16T12:00:00Z','Tester','filter-short')");
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,inventory_status,source_document_type,source_document_id,purchase_order_line_id,posted_at,posted_by,idempotency_key) VALUES ('movement-filter-open','purchase_receipt','prod-completion-filter',6,'usable','receipt','receipt-filter-open','pol-filter-open','2026-08-16T12:00:00Z','Tester','filter-open')");

  const load = (status) => inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "purchase-orders", search: "PO-FILTER-", status });
  const fullyReceived = await load("fully_received");
  const closedShort = await load("closed_short");
  const closed = await load("closed");

  assert.deepEqual(fullyReceived.purchaseOrders.map((order) => [order.number, order.fulfillmentStatus]), [["PO-FILTER-FULLY", "fully_received"]]);
  assert.equal(fullyReceived.pagination.filteredTotal, 1);
  assert.deepEqual(closedShort.purchaseOrders.map((order) => [order.number, order.fulfillmentStatus]), [["PO-FILTER-SHORT", "closed_short"]]);
  assert.equal(closedShort.pagination.filteredTotal, 1);
  assert.deepEqual(closed.purchaseOrders.map((order) => order.number).sort(), ["PO-FILTER-FULLY", "PO-FILTER-SHORT"]);
  assert.equal(closed.pagination.filteredTotal, 2);
});

test("worklist column sorts apply to the full server-side result set", async () => {
  const ascending = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "purchase-orders", search: "PO-FILTER-", sort: "number:asc" });
  const descending = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "purchase-orders", search: "PO-FILTER-", sort: "number:desc" });
  assert.deepEqual(ascending.purchaseOrders.map((order) => order.number), ["PO-FILTER-FULLY", "PO-FILTER-OPEN", "PO-FILTER-SHORT"]);
  assert.deepEqual(descending.purchaseOrders.map((order) => order.number), ["PO-FILTER-SHORT", "PO-FILTER-OPEN", "PO-FILTER-FULLY"]);

  // Every clickable header family gets prepared by SQLite here, even when this compact
  // migration fixture has no rows for a particular operational register yet.
  const sortMatrix = {
    "purchase-orders": ["exception", "number", "vendor", "status", "expected", "ordered", "received", "closed", "open", "billing", "total"],
    "sales-orders": ["exception", "number", "customer", "requested", "availability", "fulfillment", "billing", "total"],
    "customer-invoices": ["number", "customer", "ordered", "shipped", "invoiced", "availableToInvoice", "billing"],
    stock: ["product", "location", "onHand", "usable", "reserved", "available", "incoming", "demand", "projected", "exception"],
    products: ["product", "configuration", "policy", "units", "standardCost", "lastUnitCost", "sellingPrice", "pricingMode", "margin", "reorderPoint", "maxStockLevel"],
    movements: ["posted", "movement", "document", "order", "product", "quantity", "from", "to", "actor"],
    counts: ["product", "location", "recorded", "reserved", "available"],
    partners: ["partner", "type", "contact", "address", "terms", "credit"],
    "vendor-bills": ["number", "vendorInvoice", "vendor", "purchaseOrder", "invoiced", "due", "authorized", "billed", "variance", "tax", "total", "outstanding", "match", "settlement"],
  };
  for (const [scope, columns] of Object.entries(sortMatrix)) {
    for (const column of columns) {
      const sort = `${column}:asc`;
      await assert.doesNotReject(inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 10, scope, sort }), `${scope} accepts ${sort}`);
    }
  }
});

test("billable PO lines default from net receipts, prior bills, and the latest revised price", async () => {
  await run("UPDATE purchase_order_lines SET unit_cost_cents=175,version=version+1 WHERE id='pol-filter-short'");
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,inventory_status,source_document_type,source_document_id,purchase_order_line_id,posted_at,posted_by,idempotency_key) VALUES ('movement-filter-return','vendor_return','prod-completion-filter',-2,'usable','vendor_return','return-filter-short','pol-filter-short','2026-08-17T12:00:00Z','Tester','filter-return')");
  await run("INSERT INTO vendor_bills (id,number,vendor_invoice_number,vendor_id,purchase_order_id,status,match_status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,version,posted_at) VALUES ('bill-filter-short','VB-FILTER-SHORT','FILTER-001','vendor-completion-filter','po-filter-short','approved','matched','2026-08-18','2026-09-17',100,0,100,0,'CAD',1,100,1,'2026-08-18T12:00:00Z')");
  await run("INSERT INTO vendor_bill_lines (id,vendor_bill_id,purchase_order_line_id,product_id,quantity,unit_cost_cents,line_total_cents,match_status,match_details_json) VALUES ('bill-line-filter-short','bill-filter-short','pol-filter-short','prod-completion-filter',1,100,100,'matched','{}')");

  const result = await inventoryDomain.searchInventoryReferences("purchaseOrderLines", "", 50, "billable", "po-filter-short");
  assert.equal(result.items.length, 1);
  assert.deepEqual({
    ordered: result.items[0].orderedQuantity,
    closed: result.items[0].closedQuantity,
    netReceived: result.items[0].netReceivedQuantity,
    previouslyBilled: result.items[0].billedQuantity,
    billable: result.items[0].billableQuantity,
    revisedUnitCost: result.items[0].unitCostCents,
  }, { ordered: 10, closed: 4, netReceived: 4, previouslyBilled: 1, billable: 3, revisedUnitCost: 175 });
});

test("document numbers are sequential, unique, and never reused", async () => {
  const numbers = [];
  for (let index = 0; index < 250; index += 1) numbers.push(await inventoryDb.nextDocumentNumber("SHP"));
  assert.equal(new Set(numbers).size, numbers.length);
  assert.ok(numbers.every((number) => /^SHP-\d{6}$/.test(number)));
  assert.deepEqual(numbers.slice(0, 3), ["SHP-000001", "SHP-000002", "SHP-000003"]);
  assert.equal(numbers.at(-1), "SHP-000250");

  // Concurrent reservations must not collide, and separate prefixes count independently.
  const concurrent = await Promise.all(Array.from({ length: 40 }, () => inventoryDb.nextDocumentNumber("SHP")));
  assert.equal(new Set(concurrent).size, concurrent.length);
  assert.equal(await inventoryDb.nextDocumentNumber("INV"), "INV-000001");
});

test("imported supplier quotes retain external references while PaneFlow generates the PO number", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('vendor-ply-import','PLY-TEST','Ply Gem Test','vendor','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('product-ply-import','PLY-3030','Ply Gem 3030 Casement','Window','Vinyl','760 x 760 mm','White','quantity','stocked',10000,15000,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  const actor = { id: "ply-import-operator", email: "ply-import@example.com", name: "Ply Import Operator", role: "operator", label: "Ply Import Operator <ply-import@example.com>", localDevelopment: false };
  const payload = {
    vendorId: "vendor-ply-import", expectedDate: "2026-09-09", currency: "CAD", exchangeRateToBase: 1,
    supplierQuoteNumber: "993389", supplierReference: "UNKNOWN-UNTIL-PANEFLOW", sourceDocumentHash: "a".repeat(64),
    projectReference: "Source quote 993389 · UNKNOWN-UNTIL-PANEFLOW",
    lines: [{ kind: "item", productId: "product-ply-import", quantity: 2, unitCostCents: 10000, taxable: true, taxCode: "GST", taxRateBps: 500, fulfillmentRoute: "stock" }],
  };
  const created = await advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", idempotencyKey: "ply-import-first", actor, payload });
  assert.match(created.number, /^PO-\d{6}$/);
  assert.notEqual(created.number, payload.supplierReference);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT number,supplier_quote_number,supplier_reference,source_document_hash,lifecycle_status FROM purchase_orders WHERE id=?").get(created.recordId) }, {
    number: created.number, supplier_quote_number: "993389", supplier_reference: "UNKNOWN-UNTIL-PANEFLOW", source_document_hash: "a".repeat(64), lifecycle_status: "draft",
  });
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", idempotencyKey: "ply-import-duplicate-quote", actor, payload: { ...payload, sourceDocumentHash: "b".repeat(64) } }), (error) => error?.code === "DUPLICATE_SUPPLIER_QUOTE");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", idempotencyKey: "ply-import-duplicate-file", actor, payload: { ...payload, supplierQuoteNumber: "993390", sourceDocumentHash: "a".repeat(64) } }), (error) => error?.code === "DUPLICATE_SUPPLIER_QUOTE");
  const found = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 10, scope: "purchase-orders", search: "UNKNOWN-UNTIL-PANEFLOW" });
  assert.deepEqual(found.purchaseOrders.map((order) => order.id), [created.recordId]);
});

test("host headers cannot enable local auth and email mappings cannot transfer roles", async () => {
  await assert.rejects(
    auth.resolveActor(new Request("https://attacker.local/api", { headers: { host: "localhost" } })),
    /Authenticated user headers are required/,
  );
  env.ALLOW_LOCAL_DEV_AUTH = "true";
  assert.equal((await auth.resolveActor(new Request("http://localhost/api"))).role, "administrator");
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  await run("INSERT INTO app_users (user_id,email,full_name,role,active,created_at,updated_at) VALUES ('operator-a','shared@example.com','Operator A','operator',1,'2026-08-01','2026-08-01')");
  const headers = { "oai-authenticated-user-id": "operator-b", "oai-authenticated-user-email": "shared@example.com" };
  await assert.rejects(auth.resolveActor(new Request("https://app.example/api", { headers })), /already mapped to another identity/);

  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const defaultRoleVersion = db.sqlite.prepare("SELECT version FROM system_settings WHERE key='security.defaultRole'").get().version;
  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "security.defaultRole", version: defaultRoleVersion, idempotencyKey: "set-default-operator-role", actor: administrator, payload: { key: "security.defaultRole", value: "operator", reason: "Verify controlled self-registration" } });
  const newHeaders = { "oai-authenticated-user-id": "default-role-user", "oai-authenticated-user-email": "new.operator@example.com", "oai-authenticated-user-name": "New Operator" };
  const registered = await auth.resolveActor(new Request("https://app.example/api", { headers: newHeaders }));
  assert.equal(registered.role, "operator");
  assert.deepEqual({ ...db.sqlite.prepare("SELECT role,active FROM app_users WHERE user_id='default-role-user'").get() }, { role: "operator", active: 1 });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_id='default-role-user' AND action='authenticated_user_registered'").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id='default-role-user' AND event_type='security.authenticated_user_registered'").get().count, 1);
  const restoreVersion = db.sqlite.prepare("SELECT version FROM system_settings WHERE key='security.defaultRole'").get().version;
  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "security.defaultRole", version: restoreVersion, idempotencyKey: "restore-default-viewer-role", actor: administrator, payload: { key: "security.defaultRole", value: "viewer", reason: "Restore secure test default" } });
});

test("posting dates enforce the caller's locked period and quoted idempotency keys stay bound", async () => {
  await run("INSERT INTO warehouses (id,code,name,timezone,active,version) VALUES ('wh-test','TEST','Test warehouse','UTC',1,1)");
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-a','A','A','storage','usable','wh-test',1,1)");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-a','SKU-A','Product A','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-a','loc-a',10,0,1)");
  await run("INSERT INTO period_locks (id,module,locked_through,reason,active,version,created_by,created_at) VALUES ('lock-july','inventory','2026-07-31','Month close',1,1,'tester','2026-08-01')");
  const baseCommand = { command: "inventoryAdjustment", entityId: "prod-a", version: 1, idempotencyKey: "quoted-'key", payload: { locationId: "loc-a", countedQuantity: 10, reason: "Cycle count", actor: "Tester" } };
  await assert.rejects(inventoryDomain.executeInventoryCommand({ ...baseCommand, payload: { ...baseCommand.payload, postingDate: "2026-07-15" } }), /locked through 2026-07-31/);
  const result = await inventoryDomain.executeInventoryCommand({ ...baseCommand, payload: { ...baseCommand.payload, postingDate: "2026-08-01" } });
  assert.match(result.message, /posted with no variance/);
  assert.ok(db.preparedSql.every((sql) => !sql.includes("quoted-'key")));
});

test("location lookup reaches bins beyond the snapshot reference cap", async () => {
  for (let index = 0; index < 260; index += 1) {
    const suffix = String(index).padStart(4, "0");
    await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES (?,?,?,?,?,?,1,1)", `loc-scale-${suffix}`, `BIN-${suffix}`, `Scale bin ${suffix}`, "storage", "usable", "wh-test");
  }
  const result = await inventoryDomain.searchInventoryReferences("locations", "BIN-0259", 10, "usable");
  assert.deepEqual(result.items.map((item) => item.id), ["loc-scale-0259"]);
});

test("product detail history is complete even when global movement page one is unrelated", async () => {
  for (let index = 0; index < 55; index += 1) {
    const suffix = String(index).padStart(4, "0");
    await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,posted_at,posted_by,idempotency_key) VALUES (?,?,?,?,?,'usable','scale_test',?,'2026-08-09T12:00:00Z','Scale test',?)", `movement-scale-${suffix}`, "opening_balance", `prod-scale-${suffix}`, 1, "loc-a", `scale-${suffix}`, `movement-scale-${suffix}`);
  }
  for (let index = 0; index < 3; index += 1) {
    await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,posted_at,posted_by,idempotency_key) VALUES (?,?,?,?,?,'usable','detail_test',?,'2026-08-01T12:00:00Z','Detail test',?)", `movement-detail-${index}`, "opening_balance", "prod-a", 1, "loc-a", `detail-${index}`, `movement-detail-${index}`);
  }
  const global = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "movements", sort: "newest" });
  assert.equal(global.movements.length, 50);
  assert.equal(global.movements.some((movement) => movement.productId === "prod-a"), false);

  const firstPage = await inventoryDomain.getProductOperationalDetail("prod-a", 1, 2);
  const secondPage = await inventoryDomain.getProductOperationalDetail("prod-a", 2, 2);
  assert.deepEqual(firstPage.pagination, { page: 1, pageSize: 2, total: 3 });
  assert.equal(firstPage.movements.length, 2);
  assert.deepEqual(secondPage.pagination, { page: 2, pageSize: 2, total: 3 });
  assert.equal(secondPage.movements.length, 1);
});

test("receipts reject unknown locations before creating physical or financial records", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('vendor-receipt','VEND-R','Receipt Vendor','vendor','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('po-location','PO-LOCATION','vendor-receipt','approved','not_billed','2026-08-10','CAD',1,1000,1000,1,'2026-08-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route) VALUES ('pol-location','po-location','prod-a',2,0,100,'stock')");
  await assert.rejects(
    inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-location", version: 1, idempotencyKey: "invalid-location-receipt", payload: { lineId: "pol-location", quantity: 1, locationId: "loc-does-not-exist", postingDate: "2026-08-01", actor: "Tester" } }),
    (error) => error?.code === "INVALID_LOCATION",
  );
  await assert.rejects(
    inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-location", version: 1, idempotencyKey: "missing-location-receipt", payload: { lineId: "pol-location", quantity: 1, postingDate: "2026-08-01", actor: "Tester" } }),
    (error) => error?.code === "VALIDATION_ERROR" && /warehouseId is required/.test(error.message),
  );
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM receipts WHERE purchase_order_id='po-location'").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_value_entries WHERE reference_id='po-location'").get().count, 0);
});

test("batch receiving posts one document and independent PO lines do not conflict", async () => {
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-b','SKU-B','Product B','test','test','test','test','quantity','stocked',150,300,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('po-batch','PO-BATCH','vendor-receipt','approved','not_billed','2026-08-10','CAD',1,2500,2500,1,'2026-08-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route,version) VALUES ('pol-batch-a','po-batch','prod-a',10,0,100,'stock',1),('pol-batch-b','po-batch','prod-b',10,0,150,'stock',1)");
  const batch = await inventoryDomain.executeInventoryCommand({ command: "postReceiptBatch", entityId: "po-batch", version: 1, idempotencyKey: "batch-receipt", payload: { postingDate: "2026-08-01", actor: "Tester", lines: [
    { lineId: "pol-batch-a", lineVersion: 1, quantity: 2, locationId: "loc-a" },
    { lineId: "pol-batch-b", lineVersion: 1, quantity: 3, locationId: "loc-a" },
  ] } });
  assert.match(batch.message, /2 lines and 5 units as one receipt/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM receipts WHERE purchase_order_id='po-batch'").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM receipt_lines rl JOIN receipts r ON r.id=rl.receipt_id WHERE r.purchase_order_id='po-batch'").get().count, 2);
  assert.deepEqual(db.sqlite.prepare("SELECT id,version FROM purchase_order_lines WHERE purchase_order_id='po-batch' ORDER BY id").all().map((row) => ({ ...row })), [{ id: "pol-batch-a", version: 2 }, { id: "pol-batch-b", version: 2 }]);

  await inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-batch", version: 2, idempotencyKey: "line-receipt-a", payload: { lineId: "pol-batch-a", quantity: 1, locationId: "loc-a", postingDate: "2026-08-01", actor: "Receiver A" } });
  await inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-batch", version: 2, idempotencyKey: "line-receipt-b", payload: { lineId: "pol-batch-b", quantity: 1, locationId: "loc-a", postingDate: "2026-08-01", actor: "Receiver B" } });
  assert.deepEqual(db.sqlite.prepare("SELECT id,version FROM purchase_order_lines WHERE purchase_order_id='po-batch' ORDER BY id").all().map((row) => ({ ...row })), [{ id: "pol-batch-a", version: 3 }, { id: "pol-batch-b", version: 3 }]);
  assert.equal(db.sqlite.prepare("SELECT version FROM purchase_orders WHERE id='po-batch'").get().version, 4);
});

test("purchasing UOM conversions post base stock and discrete inventory rejects fractions", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const createdUnit = await advancedDomain.executeWorkflow({ command: "createUnitOfMeasure", idempotencyKey: "create-case-uom", actor: administrator, payload: { code: "CASE", name: "Case of twelve", dimension: "quantity", precision: 0 } });
  await advancedDomain.executeWorkflow({ command: "createUomConversion", idempotencyKey: "create-case-conversion", actor: administrator, payload: { productId: "prod-b", fromUomId: createdUnit.recordId, toUomId: "uom-each", numerator: 12, denominator: 1, roundingMode: "nearest" } });
  await run("UPDATE products SET purchase_uom_id=? WHERE id='prod-b'", createdUnit.recordId);
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('po-uom','PO-UOM','vendor-receipt','approved','not_billed','2026-08-10','CAD',1,2400,2400,1,'2026-08-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route,version,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents) VALUES ('pol-uom','po-uom','prod-b',24,0,100,'stock',1,?,2,1200)", createdUnit.recordId);
  await inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-uom", version: 1, idempotencyKey: "receive-two-cases", payload: { lineId: "pol-uom", quantity: 2, uomId: createdUnit.recordId, locationId: "loc-a", postingDate: "2026-08-01", actor: "Tester" } });
  assert.equal(db.sqlite.prepare("SELECT quantity FROM receipt_lines WHERE purchase_order_line_id='pol-uom'").get().quantity, 24);
  assert.equal(db.sqlite.prepare("SELECT ordered_uom_qty FROM purchase_order_lines WHERE id='pol-uom'").get().ordered_uom_qty, 2);

  const receipt = db.sqlite.prepare("SELECT id,version FROM receipts WHERE purchase_order_id='po-uom'").get();
  const beforeCorrection = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: "PO-UOM", page: 1, pageSize: 10 });
  assert.equal(beforeCorrection.purchaseOrders[0].lines[0].latestReceiptReversibleQuantity, 24);
  await inventoryDomain.executeInventoryCommand({ command: "reverseReceipt", entityId: receipt.id, version: receipt.version, idempotencyKey: "reverse-one-case-and-close", payload: { lineId: "pol-uom", quantity: 1, uomId: createdUnit.recordId, disposition: "close", reason: "One case was entered in error", postingDate: "2026-08-01", actor: "Tester" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,version FROM receipts WHERE id=?").get(receipt.id) }, { status: "partially_reversed", version: 2 });
  assert.equal(db.sqlite.prepare("SELECT closed_qty FROM purchase_order_lines WHERE id='pol-uom'").get().closed_qty, 12);
  const afterFirstCorrection = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: "PO-UOM", page: 1, pageSize: 10 });
  assert.equal(afterFirstCorrection.purchaseOrders[0].lines[0].latestReceiptReversibleQuantity, 12);
  await inventoryDomain.executeInventoryCommand({ command: "reverseReceipt", entityId: receipt.id, version: 2, idempotencyKey: "reverse-final-case-and-reopen", payload: { lineId: "pol-uom", quantity: 1, uomId: createdUnit.recordId, disposition: "reopen", reason: "Final case was not actually received", postingDate: "2026-08-01", actor: "Tester" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,version FROM receipts WHERE id=?").get(receipt.id) }, { status: "reversed", version: 3 });
  assert.equal(db.sqlite.prepare("SELECT closed_qty FROM purchase_order_lines WHERE id='pol-uom'").get().closed_qty, 12);
  const correctedSnapshot = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: "PO-UOM", page: 1, pageSize: 10 });
  assert.deepEqual({ gross: correctedSnapshot.purchaseOrders[0].lines[0].grossReceivedQuantity, returned: correctedSnapshot.purchaseOrders[0].lines[0].returnedQuantity, net: correctedSnapshot.purchaseOrders[0].lines[0].netReceivedQuantity }, { gross: 24, returned: 24, net: 0 });

  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-fraction-target','FRACTION','Fraction target','storage','usable','wh-test',1,1)");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "transferInventory", entityId: "prod-a", idempotencyKey: "reject-quarter-unit", actor: administrator, payload: { fromLocationId: "loc-a", toLocationId: "loc-fraction-target", quantity: 0.25, reason: "Must reject fractions", postingDate: "2026-08-01" } }), (error) => ["INVALID_QUANTITY_PRECISION", "DISCRETE_QUANTITY_REQUIRED"].includes(error?.code));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM command_log WHERE idempotency_key='reject-quarter-unit'").get().count, 0);
});

test("tracked receipt, shipment, return, and correction controls have searchable durable identities", async () => {
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-tracked-return','TRACK-RET','Tracked returns','returns','quarantine','wh-test',1,1)");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-lot','LOT-SKU','Lot product','test','test','test','test','lot','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01'),('prod-serial','SER-SKU','Serial product','test','test','test','test','serial','stocked',300,500,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('po-lot','PO-LOT','vendor-receipt','approved','not_billed','2026-08-10','CAD',1,500,500,1,'2026-08-01'),('po-serial','PO-SERIAL','vendor-receipt','approved','not_billed','2026-08-10','CAD',1,300,300,1,'2026-08-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route,version) VALUES ('pol-lot','po-lot','prod-lot',5,0,100,'stock',1),('pol-serial','po-serial','prod-serial',1,0,300,'stock',1)");
  await inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-lot", version: 1, idempotencyKey: "receive-lot-ui", payload: { lineId: "pol-lot", quantity: 5, lotNumber: "LOT-2026-001", locationId: "loc-a", postingDate: "2026-08-01", actor: "Tester" } });
  await inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-serial", version: 1, idempotencyKey: "receive-serial-ui", payload: { lineId: "pol-serial", quantity: 1, serialNumber: "SER-2026-001", locationId: "loc-a", postingDate: "2026-08-01", actor: "Tester" } });
  const purchaseSnapshot = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: "PO-LOT", page: 1, pageSize: 10 });
  assert.equal(purchaseSnapshot.purchaseOrders[0].lines[0].trackingPolicy, "lot");
  const lotLookup = await inventoryDomain.searchInventoryReferences("inventoryLots", "LOT-2026", 10, "on_hand", undefined, 1, undefined, undefined, undefined, 0, "prod-lot", undefined, "loc-a");
  assert.deepEqual(lotLookup.items.map((item) => ({ id: item.id, available: item.availableQuantity })), [{ id: lotLookup.items[0].id, available: 5 }]);

  await run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,currency,active,version,created_at) VALUES ('customer-tracked','CUST-T','Tracked Customer','customer','1 Trace Way','Edmonton','AB','T5J 0N3','CA','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country) VALUES ('so-lot','SO-LOT','customer-tracked','confirmed','not_invoiced','2026-08-10','CAD',1,400,400,1,'2026-08-01','Tracked Customer','1 Trace Way','Edmonton','AB','T5J 0N3','CA')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route) VALUES ('sol-lot','so-lot','prod-lot',2,0,200,'stock')");
  await inventoryDomain.executeInventoryCommand({ command: "reserveSale", entityId: "so-lot", version: 1, idempotencyKey: "reserve-lot-ui", payload: { lineId: "sol-lot", quantity: 2, actor: "Tester" } });
  const salesSnapshot = await inventoryDomain.getInventorySnapshot({ scope: "fulfillment", search: "SO-LOT", status: "reserved", page: 1, pageSize: 10 });
  assert.deepEqual({ policy: salesSnapshot.salesOrders[0].lines[0].trackingPolicy, location: salesSnapshot.salesOrders[0].lines[0].reservationLocationId }, { policy: "lot", location: "loc-a" });
  await inventoryDomain.executeInventoryCommand({ command: "shipSale", entityId: "so-lot", version: 2, idempotencyKey: "ship-lot-ui", payload: { lineId: "sol-lot", quantity: 2, lotId: lotLookup.items[0].id, carrier: "Trace Freight", trackingNumber: "TRACE-1", postingDate: "2026-08-01", actor: "Tester" } });
  const shippedLotLookup = await inventoryDomain.searchInventoryReferences("inventoryLots", "LOT-2026", 10, "shipped", undefined, 1, undefined, undefined, undefined, 0, "prod-lot", "sol-lot");
  assert.equal(shippedLotLookup.items[0].availableQuantity, 2);
  await inventoryDomain.executeInventoryCommand({ command: "customerReturn", entityId: "so-lot", version: 3, idempotencyKey: "return-lot-ui", payload: { lineId: "sol-lot", quantity: 1, lotId: lotLookup.items[0].id, condition: "quarantine", locationId: "loc-tracked-return", reason: "Traceable return", postingDate: "2026-08-01", actor: "Tester" } });
  assert.equal((await inventoryDomain.searchInventoryReferences("inventoryLots", "LOT-2026", 10, "shipped", undefined, 1, undefined, undefined, undefined, 0, "prod-lot", "sol-lot")).items[0].availableQuantity, 1);
  await inventoryDomain.executeInventoryCommand({ command: "vendorReturn", entityId: "po-lot", version: 2, idempotencyKey: "repair-lot-ui", payload: { lineId: "pol-lot", quantity: 1, lotId: lotLookup.items[0].id, locationId: "loc-a", disposition: "repair", reason: "Vendor repair required", postingDate: "2026-08-01", actor: "Tester" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT disposition,quantity FROM vendor_returns WHERE purchase_order_id='po-lot'").get() }, { disposition: "repair", quantity: 1 });
  assert.equal(db.sqlite.prepare("SELECT closed_qty FROM purchase_order_lines WHERE id='pol-lot'").get().closed_qty, 0);

  const serialReceipt = db.sqlite.prepare("SELECT id,version FROM receipts WHERE purchase_order_id='po-serial'").get();
  await inventoryDomain.executeInventoryCommand({ command: "reverseReceipt", entityId: serialReceipt.id, version: serialReceipt.version, idempotencyKey: "reverse-serial-by-po-line", payload: { lineId: "pol-serial", quantity: 1, disposition: "reopen", reason: "Serial was entered in error", postingDate: "2026-08-01", actor: "Tester" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT lifecycle_status,location_id FROM inventory_units WHERE serial_number='SER-2026-001'").get() }, { lifecycle_status: "receipt_reversed", location_id: "loc-a" });
});

test("draft sales orders can replace lines and pricing before confirmation", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,currency,active,version,created_at) VALUES ('customer-draft','CUST-D','Draft Customer','customer','10 Draft Way','Edmonton','AB','T5J 0N3','CA','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-draft','SO-DRAFT','customer-draft','draft','not_invoiced','2026-08-10','CAD',1,200,200,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-draft-old','so-draft','prod-a',1,0,200,'stock',0,1,0)");
  const actor = { id: "operator", email: "operator@example.com", name: "Operator", role: "operator", label: "Operator <operator@example.com>", localDevelopment: false };
  const createCommand = { command: "createSalesOrderDraft", entityId: "new", version: 0, idempotencyKey: "create-addressed-draft", actor, payload: { customerId: "customer-draft", requestedDate: "2026-08-20", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-09-19", shipToName: "Created Job Site", shipToAddressLine1: "21 Site Road", shipToCity: "Edmonton", shipToRegion: "AB", shipToPostalCode: "T5J 0N8", shipToCountry: "CA", lines: [{ kind: "item", productId: "prod-a", quantity: 1, unitPriceCents: 250, taxable: true, taxRateBps: 500 }] } };
  const created = await advancedDomain.executeWorkflow(createCommand);
  assert.deepEqual(await advancedDomain.executeWorkflow(createCommand), created);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sales_orders WHERE id=?").get(created.recordId).count, 1);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT ship_to_name,ship_to_address_line_1,ship_to_postal_code FROM sales_orders WHERE id=?").get(created.recordId) }, { ship_to_name: "Created Job Site", ship_to_address_line_1: "21 Site Road", ship_to_postal_code: "T5J 0N8" });
  const result = await advancedDomain.executeWorkflow({ command: "updateSalesOrderDraft", entityId: "so-draft", version: 1, idempotencyKey: "edit-so-draft", actor, payload: { customerId: "customer-draft", requestedDate: "2026-08-20", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-09-19", shipToName: "Draft Job Site", shipToAddressLine1: "20 Site Road", shipToCity: "Edmonton", shipToRegion: "AB", shipToPostalCode: "T5J 0N4", shipToCountry: "CA", lines: [
    { kind: "item", productId: "prod-a", quantity: 2, unitPriceCents: 250, taxable: true, taxRateBps: 500 },
    { kind: "item", productId: "prod-b", quantity: 1, unitPriceCents: 300, taxable: false, taxRateBps: 0 },
  ] } });
  assert.match(result.message, /draft updated with 2 item lines/);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT requested_date,total_cents,version FROM sales_orders WHERE id='so-draft'").get() }, { requested_date: "2026-08-20", total_cents: 825, version: 2 });
  assert.deepEqual(db.sqlite.prepare("SELECT product_id,ordered_qty,unit_price_cents,tax_code FROM sales_order_lines WHERE sales_order_id='so-draft' ORDER BY product_id").all().map((row) => ({ ...row })), [
    { product_id: "prod-a", ordered_qty: 2, unit_price_cents: 250, tax_code: "GST" },
    { product_id: "prod-b", ordered_qty: 1, unit_price_cents: 300, tax_code: "EXEMPT" },
  ]);
  await run("UPDATE sales_orders SET lifecycle_status='confirmed',version=3 WHERE id='so-draft'");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "updateSalesOrderDraft", entityId: "so-draft", version: 3, idempotencyKey: "edit-confirmed-so", actor, payload: { customerId: "customer-draft", requestedDate: "2026-08-20", lines: [{ productId: "prod-a", quantity: 1, unitPriceCents: 250 }] } }), /Only draft sales orders can be edited/);
});

test("purchase draft edits retain line discounts, tax, and charges after reload", async () => {
  const actor = { id: "operator", email: "operator@example.com", name: "Operator", role: "operator", label: "Operator <operator@example.com>", localDevelopment: false };
  const created = await advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "create-priced-po-draft", actor, payload: {
    vendorId: "vendor-receipt", expectedDate: "2026-08-22", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-09-21",
    lines: [
      { kind: "item", productId: "prod-a", quantity: 2, unitCostCents: 1000, discountCents: 100, taxable: true, taxCode: "GST", taxRateBps: 500 },
      { kind: "charge", chargeType: "freight", description: "Freight", amountCents: 500, taxable: true, taxCode: "GST", taxRateBps: 500 },
      { kind: "charge", chargeType: "returnable_deposit", description: "Deposit", amountCents: 200, taxable: false, refundable: true },
    ],
  } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT total_cents,version FROM purchase_orders WHERE id=?").get(created.recordId) }, { total_cents: 2720, version: 1 });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT discount_cents,taxable,tax_code,tax_rate_bps FROM purchase_order_lines WHERE purchase_order_id=?").get(created.recordId) }, { discount_cents: 100, taxable: 1, tax_code: "GST", tax_rate_bps: 500 });

  await advancedDomain.executeWorkflow({ command: "updatePurchaseOrderDraft", entityId: created.recordId, version: 1, idempotencyKey: "update-priced-po-draft", actor, payload: {
    vendorId: "vendor-receipt", expectedDate: "2026-08-25", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 15", dueDate: "2026-09-09",
    lines: [
      { kind: "item", productId: "prod-a", quantity: 3, unitCostCents: 1000, discountCents: 150, taxable: true, taxCode: "GST", taxRateBps: 500 },
      { kind: "charge", chargeType: "fee", description: "Handling", amountCents: 300, taxable: true, taxCode: "GST", taxRateBps: 500 },
    ],
  } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT total_cents,payment_terms,version FROM purchase_orders WHERE id=?").get(created.recordId) }, { total_cents: 3308, payment_terms: "Net 15", version: 2 });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT discount_cents,taxable,tax_code,tax_rate_bps FROM purchase_order_lines WHERE purchase_order_id=?").get(created.recordId) }, { discount_cents: 150, taxable: 1, tax_code: "GST", tax_rate_bps: 500 });
  assert.deepEqual(db.sqlite.prepare("SELECT charge_type,amount_cents,tax_amount_cents FROM document_charges WHERE document_type='purchase_order' AND document_id=?").all(created.recordId).map((row) => ({ ...row })), [{ charge_type: "fee", amount_cents: 300, tax_amount_cents: 15 }]);

  const snapshot = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: created.number, page: 1, pageSize: 10 });
  assert.equal(snapshot.purchaseOrders[0].lines[0].discountCents, 150);
  assert.equal(snapshot.purchaseOrders[0].lines[0].taxable, 1);
  assert.equal(snapshot.purchaseOrders[0].lines[0].taxCode, "GST");
  assert.equal(snapshot.purchaseOrders[0].lines[0].taxRateBps, 500);
});

test("dedicated supply allocations are quantity based, editable by their owner, and claimed atomically", async () => {
  const actor = { id: "operator", email: "operator@example.com", name: "Operator", role: "operator", label: "Operator <operator@example.com>", localDevelopment: false };
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-supply-link','SO-SUPPLY-LINK','customer-draft','draft','not_invoiced','2026-08-25','CAD',1,600,600,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-supply-link','so-supply-link','prod-a',4,0,200,'special_order',0,0,0),('sol-supply-duplicate','so-supply-link','prod-a',1,0,200,'special_order',0,0,0),('sol-supply-atomic','so-supply-link','prod-a',1,0,200,'special_order',0,0,0)");
  const basePayload = { vendorId: "vendor-receipt", expectedDate: "2026-08-30", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-09-29" };
  const linked = await advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "create-linked-supply-po", actor, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 3, unitCostCents: 100, taxable: false, taxRateBps: 0, fulfillmentRoute: "special_order", supplyAllocations: [{ salesOrderLineId: "sol-supply-link", quantity: 2 }] }] } });
  const originalLine = db.sqlite.prepare("SELECT id FROM purchase_order_lines WHERE purchase_order_id=?").get(linked.recordId).id;
  assert.equal(db.sqlite.prepare("SELECT linked_purchase_order_line_id FROM sales_order_lines WHERE id='sol-supply-link'").get().linked_purchase_order_line_id, originalLine);
  assert.equal(db.sqlite.prepare("SELECT allocated_qty FROM supply_allocations WHERE purchase_order_line_id=?").get(originalLine).allocated_qty, 2);
  assert.equal((await inventoryDomain.searchInventoryReferences("salesOrderLines", "SO-SUPPLY-LINK", 20, "special_order")).items.find((item) => item.id === "sol-supply-link").availableToAllocateQuantity, 2);
  assert.equal((await inventoryDomain.searchInventoryReferences("salesOrderLines", "SO-SUPPLY-LINK", 20, "special_order", linked.recordId)).items.some((item) => item.id === "sol-supply-link"), true);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "updateSalesOrderDraft", entityId: "so-supply-link", version: 1, idempotencyKey: "reject-demand-replacement-with-supply", actor, payload: {} }), (error) => error?.code === "SUPPLY_COMMITMENT_EXISTS");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "cancelSalesOrder", entityId: "so-supply-link", version: 1, idempotencyKey: "reject-demand-cancel-with-supply", actor, payload: { reason: "Customer changed scope" } }), (error) => error?.code === "SUPPLY_COMMITMENT_EXISTS");

  const shared = await advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "share-supply-demand", actor, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 2, unitCostCents: 100, fulfillmentRoute: "special_order", supplyAllocations: [{ salesOrderLineId: "sol-supply-link", quantity: 1 }] }] } });
  const sharedLine = db.sqlite.prepare("SELECT id FROM purchase_order_lines WHERE purchase_order_id=?").get(shared.recordId).id;
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM supply_allocations WHERE sales_order_line_id='sol-supply-link' AND status='active'").get().count, 2);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "reject-over-allocation", actor, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 2, unitCostCents: 100, fulfillmentRoute: "special_order", supplyAllocations: [{ salesOrderLineId: "sol-supply-link", quantity: 2 }] }] } }), (error) => error?.code === "OVER_ALLOCATION");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "reject-duplicate-supply-link", actor, payload: { ...basePayload, lines: [
    { kind: "item", productId: "prod-a", quantity: 2, unitCostCents: 100, fulfillmentRoute: "special_order", supplyAllocations: [{ salesOrderLineId: "sol-supply-duplicate", quantity: 1 }, { salesOrderLineId: "sol-supply-duplicate", quantity: 1 }] },
  ] } }), (error) => error?.code === "DUPLICATE_SUPPLY_ALLOCATION");

  await advancedDomain.executeWorkflow({ command: "updatePurchaseOrderDraft", entityId: linked.recordId, version: 1, idempotencyKey: "retain-owned-supply-link", actor, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 4, unitCostCents: 110, fulfillmentRoute: "special_order", supplyAllocations: [{ salesOrderLineId: "sol-supply-link", quantity: 3 }] }] } });
  const replacementLine = db.sqlite.prepare("SELECT id FROM purchase_order_lines WHERE purchase_order_id=?").get(linked.recordId).id;
  assert.notEqual(replacementLine, originalLine);
  assert.equal(db.sqlite.prepare("SELECT linked_purchase_order_line_id FROM sales_order_lines WHERE id='sol-supply-link'").get().linked_purchase_order_line_id, replacementLine);

  const concurrentPayload = { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 1, unitCostCents: 100, fulfillmentRoute: "special_order", sourceSalesOrderLineId: "sol-supply-atomic" }] };
  const attempts = await Promise.allSettled([
    advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "atomic-supply-link-a", actor, payload: concurrentPayload }),
    advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "atomic-supply-link-b", actor, payload: concurrentPayload }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected" && ["CREATE_CONFLICT", "OVER_ALLOCATION"].includes(attempt.reason?.code)).length, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM supply_allocations WHERE sales_order_line_id='sol-supply-atomic' AND status='active'").get().count, 1);

  await advancedDomain.executeWorkflow({ command: "cancelPurchaseOrder", entityId: linked.recordId, version: 2, idempotencyKey: "cancel-linked-supply-po", actor, payload: { reason: "Customer demand was revised before commitment" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT lifecycle_status,version FROM purchase_orders WHERE id=?").get(linked.recordId) }, { lifecycle_status: "canceled", version: 3 });
  assert.equal(db.sqlite.prepare("SELECT linked_purchase_order_line_id FROM sales_order_lines WHERE id='sol-supply-link'").get().linked_purchase_order_line_id, sharedLine);
  assert.equal(db.sqlite.prepare("SELECT status FROM supply_allocations WHERE purchase_order_line_id=?").get(replacementLine).status, "released");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "cancelPurchaseOrder", entityId: "po-batch", version: 4, idempotencyKey: "reject-cancel-po-with-receipt-history", actor, payload: { reason: "Cannot erase receipt history" } }), (error) => error?.code === "RECEIPT_HISTORY_EXISTS");
});

test("usable receipts auto-reserve allocated sales demand and reversal unwinds its own allocation", async () => {
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-auto-allocation','SKU-AUTO','Auto allocation product','test','test','test','test','quantity','special_order',125,250,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-auto-early','SO-AUTO-1','customer-draft','confirmed','not_invoiced','2026-08-20','CAD',1,500,500,1,'2026-08-01'),('so-auto-late','SO-AUTO-2','customer-draft','confirmed','not_invoiced','2026-08-21','CAD',1,750,750,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-auto-early','so-auto-early','prod-auto-allocation',2,0,250,'special_order',0,0,0),('sol-auto-late','so-auto-late','prod-auto-allocation',3,0,250,'special_order',0,0,0)");
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('po-auto-allocation','PO-AUTO','vendor-receipt','approved','not_billed','2026-08-15','CAD',1,750,750,1,'2026-08-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route,source_sales_order_line_id,version) VALUES ('pol-auto-allocation','po-auto-allocation','prod-auto-allocation',6,0,125,'special_order','sol-auto-early',1)");
  await run("INSERT INTO supply_allocations (id,purchase_order_line_id,sales_order_line_id,allocated_qty,received_qty,status,created_at,updated_at,version) VALUES ('allocation-auto-early','pol-auto-allocation','sol-auto-early',2,0,'active','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z',1),('allocation-auto-late','pol-auto-allocation','sol-auto-late',3,0,'active','2026-08-01T00:00:01Z','2026-08-01T00:00:01Z',1)");

  const receipt = await inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-auto-allocation", version: 1, idempotencyKey: "auto-allocated-receipt", payload: { lineId: "pol-auto-allocation", quantity: 4, damagedQuantity: 1, locationId: "loc-a", quarantineLocationId: "loc-tracked-return", postingDate: "2026-08-01", actor: "Receiver" } });
  assert.deepEqual({ reserved: receipt.impact.reservedDelta, available: receipt.impact.availableDelta }, { reserved: 3, available: 0 });
  assert.deepEqual(db.sqlite.prepare("SELECT id,received_qty FROM supply_allocations WHERE purchase_order_line_id='pol-auto-allocation' ORDER BY id").all().map((row) => ({ ...row })), [{ id: "allocation-auto-early", received_qty: 2 }, { id: "allocation-auto-late", received_qty: 2 }]);
  assert.equal(db.sqlite.prepare("SELECT COALESCE(SUM(quantity),0) AS quantity FROM reservations WHERE product_id='prod-auto-allocation' AND status='active'").get().quantity, 3);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-auto-allocation' AND location_id='loc-a'").get() }, { on_hand_qty: 3, reserved_qty: 3 });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM supply_allocation_receipts sar JOIN stock_movements sm ON sm.id=sar.receipt_movement_id WHERE sm.purchase_order_line_id='pol-auto-allocation'").get().count, 3);
  assert.equal(db.sqlite.prepare("SELECT COALESCE(SUM(sar.quantity),0) AS quantity FROM supply_allocation_receipts sar JOIN stock_movements sm ON sm.id=sar.receipt_movement_id WHERE sm.inventory_status='quarantine' AND sm.purchase_order_line_id='pol-auto-allocation'").get().quantity, 1);

  const postedReceipt = db.sqlite.prepare("SELECT id,version FROM receipts WHERE purchase_order_id='po-auto-allocation'").get();
  const reversed = await inventoryDomain.executeInventoryCommand({ command: "reverseReceipt", entityId: postedReceipt.id, version: postedReceipt.version, idempotencyKey: "reverse-auto-allocated-receipt", payload: { lineId: "pol-auto-allocation", quantity: 1, disposition: "reopen", reason: "One usable piece was entered in error", postingDate: "2026-08-01", actor: "Receiver" } });
  assert.equal(reversed.impact.reservedDelta, -1);
  assert.equal(db.sqlite.prepare("SELECT COALESCE(SUM(received_qty),0) AS quantity FROM supply_allocations WHERE purchase_order_line_id='pol-auto-allocation'").get().quantity, 3);
  assert.equal(db.sqlite.prepare("SELECT COALESCE(SUM(quantity),0) AS quantity FROM reservations WHERE product_id='prod-auto-allocation' AND status='active'").get().quantity, 2);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-auto-allocation' AND location_id='loc-a'").get() }, { on_hand_qty: 2, reserved_qty: 2 });
  assert.equal(db.sqlite.prepare("SELECT COALESCE(SUM(reversed_qty),0) AS quantity FROM supply_allocation_receipts").get().quantity, 1);
});

test("customer contract prices override catalog defaults in server product search", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const list = await advancedDomain.executeWorkflow({ command: "createPriceList", idempotencyKey: "create-contract-list", actor: administrator, payload: { code: "CONTRACT-A", name: "Contract A", currency: "CAD", priority: 10 } });
  const assignment = await advancedDomain.executeWorkflow({ command: "assignPriceList", idempotencyKey: "assign-contract-list", actor: administrator, payload: { priceListId: list.recordId, partnerId: "customer-draft", priority: 10 } });
  const entry = await advancedDomain.executeWorkflow({ command: "createPriceListEntry", idempotencyKey: "create-contract-entry", actor: administrator, payload: { priceListId: list.recordId, productId: "prod-a", uomId: "uom-each", minimumQuantity: 1, unitPriceCents: 123 } });
  const result = await inventoryDomain.searchInventoryReferences("products", "SKU-A", 20, "sales", "customer-draft", 2);
  const product = result.items.find((item) => item.id === "prod-a");
  assert.equal(product.effectiveUnitAmountCents, 123);
  assert.equal(product.priceSource, "Contract CONTRACT-A");

  await advancedDomain.executeWorkflow({ command: "updatePriceListAssignment", entityId: assignment.recordId, version: 1, idempotencyKey: "update-contract-assignment", actor: administrator, payload: { priceListId: list.recordId, partnerId: "customer-draft", priority: 20, validFrom: "2026-01-01" } });
  await advancedDomain.executeWorkflow({ command: "updatePriceListEntry", entityId: entry.recordId, version: 1, idempotencyKey: "update-contract-entry", actor: administrator, payload: { priceListId: list.recordId, productId: "prod-a", uomId: "uom-each", minimumQuantity: 1, unitPriceCents: 125 } });
  assert.equal((await inventoryDomain.searchInventoryReferences("priceListAssignments", "Draft", 20)).items[0].priority, 20);
  assert.equal((await inventoryDomain.searchInventoryReferences("priceListEntries", "SKU-A", 20)).items[0].unitPriceCents, 125);

  await advancedDomain.executeWorkflow({ command: "deactivatePriceListAssignment", entityId: assignment.recordId, version: 2, idempotencyKey: "deactivate-contract-assignment", actor: administrator, payload: { reason: "Contract ended" } });
  await advancedDomain.executeWorkflow({ command: "deactivatePriceListEntry", entityId: entry.recordId, version: 2, idempotencyKey: "deactivate-contract-entry", actor: administrator, payload: { reason: "Price retired" } });
  assert.equal((await inventoryDomain.searchInventoryReferences("priceListAssignments", "Draft", 20)).items.length, 0);
  assert.equal((await inventoryDomain.searchInventoryReferences("priceListEntries", "SKU-A", 20)).items.length, 0);
  const reactivated = await advancedDomain.executeWorkflow({ command: "assignPriceList", idempotencyKey: "reactivate-contract-list", actor: administrator, payload: { priceListId: list.recordId, partnerId: "customer-draft", priority: 30 } });
  assert.equal(reactivated.recordId, assignment.recordId);
  assert.equal(db.sqlite.prepare("SELECT active,version,priority FROM price_list_assignments WHERE id=?").get(assignment.recordId).version, 4);
});

test("product creation requires an explicit UOM instead of silently choosing one", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createProduct", idempotencyKey: "product-without-uom", actor: administrator, payload: { sku: "NO-UOM", name: "No UOM", category: "test", material: "test", dimensions: "test", finish: "test", trackingPolicy: "quantity", inventoryPolicy: "stocked", standardCostCents: 0, sellingPriceCents: 0 } }), (error) => error?.code === "UOM_REQUIRED");
});

test("stocked products persist valid min-max replenishment levels", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const payload = { sku: "MIN-MAX", name: "Min-max product", category: "test", material: "test", dimensions: "test", finish: "test", trackingPolicy: "quantity", inventoryPolicy: "stocked", standardCostCents: 100, sellingPriceCents: 200, reorderPoint: 5, baseUomId: "uom-each", purchaseUomId: "uom-each", salesUomId: "uom-each" };
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createProduct", idempotencyKey: "invalid-min-max-product", actor: administrator, payload: { ...payload, maxStockLevel: 4 } }), (error) => error?.code === "VALIDATION_ERROR");
  const created = await advancedDomain.executeWorkflow({ command: "createProduct", idempotencyKey: "valid-min-max-product", actor: administrator, payload: { ...payload, maxStockLevel: 12 } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT reorder_point,max_stock_level FROM products WHERE id=?").get(created.recordId) }, { reorder_point: 5, max_stock_level: 12 });
});

test("typed system policies change future transaction defaults with version control", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const version = (key) => db.sqlite.prepare("SELECT version FROM system_settings WHERE key=?").get(key).version;

  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "matching.tolerances", version: version("matching.tolerances"), idempotencyKey: "typed-matching-policy", actor: administrator, payload: { key: "matching.tolerances", value: { quantity: 1, unitPriceCents: 125, totalCents: 250, allowedChargeKinds: ["freight", "fee"] }, reason: "Exercise typed policy editing" } });
  assert.deepEqual(JSON.parse(db.sqlite.prepare("SELECT value_json FROM system_settings WHERE key='matching.tolerances'").get().value_json), { quantity: 1, unitPriceCents: 125, totalCents: 250, allowedChargeKinds: ["freight", "fee"] });
  await assert.rejects(advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "matching.tolerances", version: version("matching.tolerances") - 1, idempotencyKey: "stale-matching-policy", actor: administrator, payload: { key: "matching.tolerances", value: { quantity: 0, unitPriceCents: 0, totalCents: 0, allowedChargeKinds: [] }, reason: "Stale edit" } }), (error) => error?.code === "VERSION_CONFLICT");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "inventory.countApprovalThreshold", version: version("inventory.countApprovalThreshold"), idempotencyKey: "quoted-object-policy", actor: administrator, payload: { key: "inventory.countApprovalThreshold", value: "{\"absoluteQuantity\":5,\"absoluteValueCents\":100000}", reason: "Reject quoted object" } }), (error) => error?.code === "VALIDATION_ERROR");

  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "valuation.defaultMethod", version: version("valuation.defaultMethod"), idempotencyKey: "average-default-policy", actor: administrator, payload: { key: "valuation.defaultMethod", value: "average", reason: "New products use average" } });
  const product = await advancedDomain.executeWorkflow({ command: "createProduct", idempotencyKey: "product-average-default", actor: administrator, payload: { sku: "AVG-DEFAULT", name: "Average default product", category: "test", material: "test", dimensions: "test", finish: "test", trackingPolicy: "quantity", inventoryPolicy: "stocked", standardCostCents: 375, sellingPriceCents: 500, baseUomId: "uom-each", purchaseUomId: "uom-each", salesUomId: "uom-each" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT method,standard_cost_cents,average_cost_cents FROM valuation_policies WHERE product_id=?").get(product.recordId) }, { method: "average", standard_cost_cents: 375, average_cost_cents: 375 });

  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "tax.defaultRateBps", version: version("tax.defaultRateBps"), idempotencyKey: "tax-default-policy", actor: administrator, payload: { key: "tax.defaultRateBps", value: 725, reason: "Regional tax default" } });
  assert.equal((await inventoryDomain.getInventorySnapshot({ scope: "home", page: 1, pageSize: 5 })).configuration.taxDefaultRateBps, 725);
  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "tax.defaultRateBps", version: version("tax.defaultRateBps"), idempotencyKey: "restore-tax-default", actor: administrator, payload: { key: "tax.defaultRateBps", value: 500, reason: "Restore test default" } });
  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "valuation.defaultMethod", version: version("valuation.defaultMethod"), idempotencyKey: "restore-valuation-default", actor: administrator, payload: { key: "valuation.defaultMethod", value: "fifo", reason: "Restore test default" } });
  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "matching.tolerances", version: version("matching.tolerances"), idempotencyKey: "restore-matching-policy", actor: administrator, payload: { key: "matching.tolerances", value: { quantity: 0, unitPriceCents: 2500, totalCents: 5000, allowedChargeKinds: ["freight", "fuel_surcharge", "environmental_fee"] }, reason: "Restore test default" } });
});

test("the fee charge offered by the UI posts to an open financial document", async () => {
  const accountant = { id: "accountant", email: "accountant@example.com", name: "Accountant", role: "accounting", label: "Accountant <accountant@example.com>", localDevelopment: false };
  await run("INSERT INTO customer_invoices (id,number,customer_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,version,posted_at,posted_by) VALUES ('invoice-fee-action','INV-FEE-ACTION','customer-draft','posted','2026-08-10','2026-09-09',1000,0,1000,0,'CAD',1,1000,1,'2026-08-10T12:00:00Z','Tester')");
  await advancedDomain.executeWorkflow({ command: "addDocumentCharge", entityId: "invoice-fee-action", version: 1, idempotencyKey: "post-ui-fee-charge", actor: accountant, payload: { documentType: "customer_invoice", chargeType: "fee", description: "Delivery appointment fee", amountCents: 125, direction: "add", taxable: false, refundable: false } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT total_cents,base_total_cents,version FROM customer_invoices WHERE id='invoice-fee-action'").get() }, { total_cents: 1125, base_total_cents: 1125, version: 2 });
  assert.equal(db.sqlite.prepare("SELECT charge_type FROM document_charges WHERE document_id='invoice-fee-action'").get().charge_type, "fee");

  await run("INSERT INTO customer_invoices (id,number,customer_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,version,posted_at,posted_by) VALUES ('invoice-charge-settlement','INV-CHARGE-SETTLEMENT','customer-draft','partially_paid','2026-08-10','2026-09-09',1000,0,1000,400,'CAD',1,1000,1,'2026-08-10T12:00:00Z','Tester')");
  await advancedDomain.executeWorkflow({ command: "addDocumentCharge", entityId: "invoice-charge-settlement", version: 1, idempotencyKey: "discount-to-exact-settlement", actor: accountant, payload: { documentType: "customer_invoice", chargeType: "discount", description: "Approved settlement discount", amountCents: 600, direction: "subtract", taxable: false, refundable: false } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT subtotal_cents,total_cents,paid_cents,status,version FROM customer_invoices WHERE id='invoice-charge-settlement'").get() }, { subtotal_cents: 400, total_cents: 400, paid_cents: 400, status: "paid", version: 2 });
});

test("unplanned vendor-bill charges create a real match hold and approval", async () => {
  const accountant = { id: "accountant", email: "accountant@example.com", name: "Accountant", role: "accounting", label: "Accountant <accountant@example.com>", localDevelopment: false };
  const manager = { id: "manager", email: "manager@example.com", name: "Manager", role: "manager", label: "Manager <manager@example.com>", localDevelopment: false };
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('vendor-charge-hold','VEND-HOLD','Charge Hold Vendor','vendor','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO vendor_bills (id,number,vendor_invoice_number,vendor_id,status,match_status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,version,posted_at) VALUES ('bill-charge-hold','VB-HOLD','HOLD-001','vendor-charge-hold','approved','matched','2026-08-10','2026-09-09',1000,0,1000,0,'CAD',1,1000,1,'2026-08-10T12:00:00Z')");

  await advancedDomain.executeWorkflow({ command: "addDocumentCharge", entityId: "bill-charge-hold", version: 1, idempotencyKey: "unplanned-bill-fee", actor: accountant, payload: { documentType: "vendor_bill", chargeType: "fee", description: "Unplanned appointment fee", amountCents: 125, direction: "add", taxable: false, refundable: false } });
  const held = db.sqlite.prepare("SELECT status,match_status,hold_reason,total_cents,version FROM vendor_bills WHERE id='bill-charge-hold'").get();
  assert.deepEqual({ status: held.status, match_status: held.match_status, total_cents: held.total_cents, version: held.version }, { status: "on_hold", match_status: "exception", total_cents: 1125, version: 2 });
  assert.equal(JSON.parse(held.hold_reason).at(-1).code, "UNEXPECTED_CHARGE");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM approvals WHERE entity_id='bill-charge-hold' AND status='pending'").get().count, 1);

  await advancedDomain.executeWorkflow({ command: "approveVendorBill", entityId: "bill-charge-hold", version: 2, idempotencyKey: "approve-unplanned-bill-fee", actor: manager, payload: { reason: "Appointment charge verified" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,match_status,hold_reason,version FROM vendor_bills WHERE id='bill-charge-hold'").get() }, { status: "approved", match_status: "approved_variance", hold_reason: null, version: 3 });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM approvals WHERE entity_id='bill-charge-hold' AND status='approved'").get().count, 1);
});

test("order drafts reject missing or inconsistent exchange rates as validation errors", async () => {
  const actor = { id: "operator", email: "operator@example.com", name: "Operator", role: "operator", label: "Operator <operator@example.com>", localDevelopment: false };
  const payload = { customerId: "customer-draft", requestedDate: "2026-08-20", paymentTerms: "Net 30", shipToName: "Exchange Site", shipToAddressLine1: "9 Rate Road", shipToCity: "Edmonton", shipToRegion: "AB", shipToPostalCode: "T5J 0N9", shipToCountry: "CA", lines: [{ kind: "item", productId: "prod-a", quantity: 1, unitPriceCents: 250 }] };
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createSalesOrderDraft", idempotencyKey: "foreign-order-without-rate", actor, payload: { ...payload, currency: "USD" } }), (error) => error instanceof advancedDomain.WorkflowError && error.code === "EXCHANGE_RATE_REQUIRED" && error.status === 400);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createSalesOrderDraft", idempotencyKey: "cad-order-wrong-rate", actor, payload: { ...payload, currency: "CAD", exchangeRateToBase: 2 } }), (error) => error instanceof advancedDomain.WorkflowError && error.code === "EXCHANGE_RATE_MISMATCH" && error.status === 400);
});

test("returnable refunds preserve the deposit charged at issue time", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const operator = { id: "operator", email: "operator@example.com", name: "Operator", role: "operator", label: "Operator <operator@example.com>", localDevelopment: false };
  const accountant = { id: "accountant", email: "accountant@example.com", name: "Accountant", role: "accounting", label: "Accountant <accountant@example.com>", localDevelopment: false };
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('customer-returnable','CUST-RET','Returnable Customer','customer','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO returnable_asset_types (id,code,name,asset_class,unit_deposit_cents,active,version) VALUES ('asset-test-deposit','TESTDEP','Test deposit asset','rack',100,1,1)");

  const issue = await advancedDomain.executeWorkflow({ command: "issueReturnable", idempotencyKey: "issue-immutable-deposit", actor: operator, payload: { partnerId: "customer-returnable", assetTypeId: "asset-test-deposit", quantity: 2, direction: "customer_holds", reason: "Issue two test racks", postingDate: "2026-08-10", paymentMethod: "credit_card", paymentReference: "TERM-RET-200" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT direction,document_type,amount_cents,currency,method,reference FROM payments WHERE document_type='returnable_deposit_collection' AND document_id=?").get(issue.recordId) }, { direction: "inbound", document_type: "returnable_deposit_collection", amount_cents: 200, currency: "CAD", method: "credit_card", reference: "TERM-RET-200" });
  await advancedDomain.executeWorkflow({ command: "updateReturnableAssetType", entityId: "asset-test-deposit", version: 1, idempotencyKey: "raise-future-deposit", actor: administrator, payload: { code: "TESTDEP", name: "Test deposit asset", assetClass: "rack", unitDepositCents: 500 } });
  await advancedDomain.executeWorkflow({ command: "returnReturnable", entityId: issue.recordId, version: 1, idempotencyKey: "return-one-old-deposit", actor: operator, payload: { quantity: 1, reason: "One rack returned", postingDate: "2026-08-11" } });

  const snapshot = await advancedDomain.getAdvancedSnapshot(administrator, { page: 1, pageSize: 100 });
  const obligation = snapshot.returnableObligations.find((row) => row.id === issue.recordId);
  assert.equal(obligation.refundableDepositCents, 100);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "refundReturnableDeposit", entityId: issue.recordId, version: 2, idempotencyKey: "over-refund-old-deposit", actor: accountant, payload: { amountCents: 500, reason: "Must not use the new asset price", postingDate: "2026-08-12" } }), (error) => error?.code === "INVALID_AMOUNT");
  await advancedDomain.executeWorkflow({ command: "refundReturnableDeposit", entityId: issue.recordId, version: 2, idempotencyKey: "refund-old-deposit", actor: accountant, payload: { amountCents: 100, reason: "Refund original deposit", postingDate: "2026-08-12" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT amount_cents,currency,exchange_rate_to_base,base_amount_cents FROM payments WHERE document_type='returnable_deposit_refund' AND document_id=?").get(issue.recordId) }, { amount_cents: 100, currency: "CAD", exchange_rate_to_base: 1, base_amount_cents: 100 });
});

test("catalog and contract pricing honor the order currency", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const list = await advancedDomain.executeWorkflow({ command: "createPriceList", idempotencyKey: "create-usd-contract-list", actor: administrator, payload: { code: "CONTRACT-USD", name: "USD Contract", currency: "USD", priority: 100 } });
  await advancedDomain.executeWorkflow({ command: "assignPriceList", idempotencyKey: "assign-usd-contract-list", actor: administrator, payload: { priceListId: list.recordId, partnerId: "customer-draft", priority: 100 } });
  await advancedDomain.executeWorkflow({ command: "createPriceListEntry", idempotencyKey: "create-usd-contract-entry", actor: administrator, payload: { priceListId: list.recordId, productId: "prod-a", uomId: "uom-each", minimumQuantity: 1, unitPriceCents: 77 } });

  const usdSales = await inventoryDomain.searchInventoryReferences("products", "SKU-A", 20, "sales", "customer-draft", 2, undefined, "USD", 1.25);
  assert.equal(usdSales.items.find((item) => item.id === "prod-a").effectiveUnitAmountCents, 77);
  assert.equal(usdSales.items.find((item) => item.id === "prod-a").effectiveCurrency, "USD");
  const usdPurchasing = await inventoryDomain.searchInventoryReferences("products", "SKU-A", 20, "vendor", undefined, 1, undefined, "USD", 1.25);
  assert.equal(usdPurchasing.items.find((item) => item.id === "prod-a").effectiveUnitAmountCents, 80);
  assert.equal(usdPurchasing.items.find((item) => item.id === "prod-a").priceSource, "Catalog standard cost fallback");
  await assert.rejects(inventoryDomain.searchInventoryReferences("products", "SKU-A", 20, "vendor", undefined, 1, undefined, "EUR", 0), (error) => error?.code === "EXCHANGE_RATE_REQUIRED");
});

test("sales-order confirmation enforces address, credit hold, and credit limit", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,currency,credit_limit_cents,credit_hold,active,version,created_at) VALUES ('customer-credit','CUST-CR','Credit Customer','customer','30 Credit Way','Edmonton','AB','T5J 0N6','CA','CAD',1000,1,1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country,version,created_at) VALUES ('so-credit','SO-CREDIT','customer-credit','draft','not_invoiced','2026-08-20','CAD',1,800,800,'Credit Site','31 Credit Way','Edmonton','AB','T5J 0N7','CA',1,'2026-08-01')");
  const actor = { id: "operator", email: "operator@example.com", name: "Operator", role: "operator", label: "Operator <operator@example.com>", localDevelopment: false };
  const command = { command: "confirmSalesOrder", entityId: "so-credit", version: 1, idempotencyKey: "confirm-credit", actor, payload: { reason: "Customer approved" } };
  await assert.rejects(advancedDomain.executeWorkflow(command), (error) => error?.code === "CREDIT_HOLD");
  await run("UPDATE business_partners SET credit_hold=0,credit_limit_cents=500 WHERE id='customer-credit'");
  await assert.rejects(advancedDomain.executeWorkflow({ ...command, idempotencyKey: "confirm-credit-limit" }), (error) => error?.code === "CREDIT_LIMIT_EXCEEDED");
  await run("UPDATE business_partners SET credit_limit_cents=1000 WHERE id='customer-credit'");
  const result = await advancedDomain.executeWorkflow({ ...command, idempotencyKey: "confirm-credit-approved" });
  assert.match(result.message, /confirmed/);
  assert.equal(db.sqlite.prepare("SELECT lifecycle_status FROM sales_orders WHERE id='so-credit'").get().lifecycle_status, "confirmed");

  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country,version,created_at) VALUES ('so-credit-foreign','SO-CREDIT-FOREIGN','customer-credit','draft','not_invoiced','2026-08-20','USD',1.25,1000,800,'Credit Site','31 Credit Way','Edmonton','AB','T5J 0N7','CA',1,'2026-08-01')");
  await assert.rejects(advancedDomain.executeWorkflow({ ...command, entityId: "so-credit-foreign", idempotencyKey: "confirm-credit-currency" }), (error) => error?.code === "CREDIT_CURRENCY_MISMATCH");
});

test("authorized authors can atomically fast-track orders and vendor bills", async () => {
  const manager = { id: "fast-track-manager", email: "fast-track@example.com", name: "Fast Track Manager", role: "manager", label: "Fast Track Manager <fast-track@example.com>", localDevelopment: false };
  const operator = { id: "fast-track-operator", email: "fast-track-operator@example.com", name: "Fast Track Operator", role: "operator", label: "Fast Track Operator <fast-track-operator@example.com>", localDevelopment: false };
  const orderLine = { kind: "item", productId: "prod-a", quantity: 2, unitCostCents: 100, taxable: false, taxRateBps: 0 };

  assert.equal(advancedDomain.workflowCapability("createApprovedPurchaseOrder"), "approve");
  assert.equal(advancedDomain.workflowCapability("createConfirmedSalesOrder"), "approve");
  assert.equal(advancedDomain.workflowCapability("createApprovedVendorBill"), "approve");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createApprovedPurchaseOrder", idempotencyKey: "fast-track-denied", actor: operator, payload: { approvalReason: "Not authorized" } }), (error) => error?.code === "FAST_TRACK_FORBIDDEN" && error?.status === 403);

  const purchaseOrder = await advancedDomain.executeWorkflow({
    command: "createApprovedPurchaseOrder", idempotencyKey: "fast-track-po", actor: manager,
    payload: { vendorId: "vendor-receipt", expectedDate: "2026-09-15", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-10-15", approvalReason: "Within my purchasing signing authority", lines: [orderLine] },
  });
  assert.match(purchaseOrder.message, /created and approved by its author/);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT lifecycle_status,version FROM purchase_orders WHERE id=?").get(purchaseOrder.recordId) }, { lifecycle_status: "approved", version: 1 });
  assert.equal(db.sqlite.prepare("SELECT lifecycle_status FROM purchase_order_revisions WHERE purchase_order_id=?").get(purchaseOrder.recordId).lifecycle_status, "approved");
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,requested_by,decided_by,decision_reason FROM approvals WHERE entity_id=?").get(purchaseOrder.recordId) }, { status: "approved", requested_by: manager.label, decided_by: manager.label, decision_reason: "Within my purchasing signing authority" });
  assert.equal(db.sqlite.prepare("SELECT event_type FROM outbox_events WHERE aggregate_id=?").get(purchaseOrder.recordId).event_type, "purchase_order.approved");

  await run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,currency,credit_limit_cents,credit_hold,active,version,created_at) VALUES ('customer-fast-track','CUST-FAST','Fast Track Customer','customer','1 Authority Way','Edmonton','AB','T5J 0N1','CA','CAD',10000,1,1,1,'2026-08-01')");
  const salesPayload = { customerId: "customer-fast-track", requestedDate: "2026-09-20", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-10-20", shipToName: "Fast Track Site", shipToAddressLine1: "2 Authority Way", shipToCity: "Edmonton", shipToRegion: "AB", shipToPostalCode: "T5J 0N2", shipToCountry: "CA", approvalReason: "Customer commitment signed", lines: [{ kind: "item", productId: "prod-a", quantity: 1, unitPriceCents: 200, taxable: false, taxRateBps: 0 }] };
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createConfirmedSalesOrder", idempotencyKey: "fast-track-so-held", actor: manager, payload: salesPayload }), (error) => error?.code === "CREDIT_HOLD");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sales_orders WHERE customer_id='customer-fast-track'").get().count, 0);
  await run("UPDATE business_partners SET credit_hold=0 WHERE id='customer-fast-track'");
  const salesOrder = await advancedDomain.executeWorkflow({ command: "createConfirmedSalesOrder", idempotencyKey: "fast-track-so", actor: manager, payload: salesPayload });
  assert.match(salesOrder.message, /created and confirmed by its author/);
  assert.equal(db.sqlite.prepare("SELECT lifecycle_status FROM sales_orders WHERE id=?").get(salesOrder.recordId).lifecycle_status, "confirmed");
  assert.equal(db.sqlite.prepare("SELECT action FROM audit_events WHERE entity_id=?").get(salesOrder.recordId).action, "sales_order_fast_track_confirmed");

  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('po-fast-bill','PO-FAST-BILL','vendor-receipt','approved','not_billed','2026-08-24','CAD',1,200,200,1,'2026-08-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route,version) VALUES ('pol-fast-bill','po-fast-bill','prod-a',2,0,100,'stock',1)");
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,purchase_order_line_id,posted_at,posted_by,idempotency_key) VALUES ('movement-fast-bill','purchase_receipt','prod-a',2,'loc-a','usable','purchase_order','po-fast-bill','pol-fast-bill','2026-08-24T12:00:00Z','Receiver','movement-fast-bill')");
  const vendorBill = await advancedDomain.executeWorkflow({
    command: "createApprovedVendorBill", entityId: "po-fast-bill", version: 1, idempotencyKey: "fast-track-vendor-bill", actor: manager,
    payload: { purchaseOrderId: "po-fast-bill", vendorInvoiceNumber: "FAST-BILL-001", invoiceDate: "2026-08-24", dueDate: "2026-09-23", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", approvalReason: "I authorize the supplier variance", lines: [{ purchaseOrderLineId: "pol-fast-bill", quantity: 2, unitCostCents: 5000 }] },
  });
  assert.match(vendorBill.message, /approved by its author/);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,match_status,approved_by,hold_reason FROM vendor_bills WHERE id=?").get(vendorBill.recordId) }, { status: "approved", match_status: "approved_variance", approved_by: manager.label, hold_reason: null });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,request_type,decided_by FROM approvals WHERE entity_id=?").get(vendorBill.recordId) }, { status: "approved", request_type: "vendor_bill_match_exception", decided_by: manager.label });
  const purchaseJourney = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: "PO-FAST-BILL", page: 1, pageSize: 10 });
  const connectedBills = JSON.parse(purchaseJourney.purchaseOrders[0].vendorBillsJson);
  assert.equal(connectedBills.length, 1);
  assert.deepEqual({ id: connectedBills[0].id, externalReference: connectedBills[0].externalReference, amountCents: connectedBills[0].amountCents }, { id: vendorBill.recordId, externalReference: "FAST-BILL-001", amountCents: 10000 });
});

test("approved PO cost drives the margin matrix while manual prices and contract prices remain controlled", async () => {
  const administrator = { id: "pricing-admin", email: "pricing-admin@example.com", name: "Pricing Administrator", role: "administrator", label: "Pricing Administrator <pricing-admin@example.com>", localDevelopment: false };
  const operator = { id: "pricing-operator", email: "pricing-operator@example.com", name: "Pricing Operator", role: "operator", label: "Pricing Operator <pricing-operator@example.com>", localDevelopment: false };
  const manager = { id: "pricing-manager", email: "pricing-manager@example.com", name: "Pricing Manager", role: "manager", label: "Pricing Manager <pricing-manager@example.com>", localDevelopment: false };

  const rule = await advancedDomain.executeWorkflow({ command: "createMarginRule", idempotencyKey: "create-prod-a-margin-rule", actor: administrator, payload: {
    code: "PROD-A-35", name: "Product A 35% gross margin", productId: "prod-a", minimumCostCents: 0, maximumCostCents: null,
    targetMarginBps: 3500, minimumGrossProfitCents: 0, roundingIncrementCents: 1, priority: 100,
  } });
  const beforeModeChange = db.sqlite.prepare("SELECT version FROM products WHERE id='prod-a'").get().version;
  await advancedDomain.executeWorkflow({ command: "updateProductPricing", entityId: "prod-a", version: beforeModeChange, idempotencyKey: "enable-prod-a-auto-pricing", actor: administrator, payload: { pricingMode: "automatic", sellingPriceCents: 0, reason: "Use the approved distributor margin matrix" } });

  const draft = await advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "create-last-cost-po", actor: operator, payload: {
    vendorId: "vendor-receipt", expectedDate: "2026-09-25", currency: "USD", exchangeRateToBase: 1.25, paymentTerms: "Net 30", dueDate: "2026-10-25",
    lines: [{ kind: "item", productId: "prod-a", quantity: 2, unitCostCents: 800, discountCents: 200, taxable: false, taxRateBps: 0 }],
  } });
  assert.equal(db.sqlite.prepare("SELECT last_unit_cost_cents FROM products WHERE id='prod-a'").get().last_unit_cost_cents, 100);
  await advancedDomain.executeWorkflow({ command: "submitPurchaseOrder", entityId: draft.recordId, version: 1, idempotencyKey: "submit-last-cost-po", actor: operator, payload: { reason: "Supplier quote accepted" } });
  assert.equal(db.sqlite.prepare("SELECT last_unit_cost_cents FROM products WHERE id='prod-a'").get().last_unit_cost_cents, 100);
  await advancedDomain.executeWorkflow({ command: "approvePurchaseOrder", entityId: draft.recordId, version: 2, idempotencyKey: "approve-last-cost-po", actor: manager, payload: { reason: "Approved purchasing commitment" } });

  const approvedPrice = db.sqlite.prepare("SELECT last_unit_cost_cents,last_unit_cost_source_po_id,last_unit_cost_vendor_id,suggested_selling_price_cents,selling_price_cents,pricing_mode,applied_margin_rule_id FROM products WHERE id='prod-a'").get();
  assert.deepEqual({ ...approvedPrice }, {
    last_unit_cost_cents: 875,
    last_unit_cost_source_po_id: draft.recordId,
    last_unit_cost_vendor_id: "vendor-receipt",
    suggested_selling_price_cents: 1347,
    selling_price_cents: 1347,
    pricing_mode: "automatic",
    applied_margin_rule_id: rule.recordId,
  });
  const costHistory = db.sqlite.prepare("SELECT purchase_order_revision,vendor_id,last_unit_cost_cents,source_currency,exchange_rate_to_base FROM product_cost_history WHERE source_purchase_order_id=?").get(draft.recordId);
  assert.deepEqual({ ...costHistory }, { purchase_order_revision: 1, vendor_id: "vendor-receipt", last_unit_cost_cents: 875, source_currency: "USD", exchange_rate_to_base: 1.25 });

  const purchasing = await inventoryDomain.searchInventoryReferences("products", "SKU-A", 20, "vendor", "vendor-receipt", 1, undefined, "CAD", 1);
  const purchaseProduct = purchasing.items.find((item) => item.id === "prod-a");
  assert.equal(purchaseProduct.effectiveUnitAmountCents, 875);
  assert.match(purchaseProduct.priceSource, /Last unit cost/);
  const contracted = await inventoryDomain.searchInventoryReferences("products", "SKU-A", 20, "sales", "customer-draft", 2, undefined, "USD", 1.25);
  assert.equal(contracted.items.find((item) => item.id === "prod-a").effectiveUnitAmountCents, 77);

  const beforeOverride = db.sqlite.prepare("SELECT version FROM products WHERE id='prod-a'").get().version;
  await advancedDomain.executeWorkflow({ command: "updateProductPricing", entityId: "prod-a", version: beforeOverride, idempotencyKey: "manual-prod-a-price", actor: administrator, payload: { pricingMode: "manual", sellingPriceCents: 1200, reason: "Distributor market exception" } });
  const poVersion = db.sqlite.prepare("SELECT version FROM purchase_orders WHERE id=?").get(draft.recordId).version;
  await advancedDomain.executeWorkflow({ command: "cancelPurchaseOrder", entityId: draft.recordId, version: poVersion, idempotencyKey: "cancel-last-cost-po", actor: manager, payload: { reason: "Supplier withdrew the quote before receipt" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT last_unit_cost_cents,suggested_selling_price_cents,selling_price_cents,pricing_mode,manual_price_reason FROM products WHERE id='prod-a'").get() }, {
    last_unit_cost_cents: 100,
    suggested_selling_price_cents: 154,
    selling_price_cents: 1200,
    pricing_mode: "manual",
    manual_price_reason: "Distributor market exception",
  });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM catalog_price_history WHERE product_id='prod-a' AND source_purchase_order_id=?").get(draft.recordId).count, 1);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT event_type,cost_basis_cents FROM catalog_price_history WHERE product_id='prod-a' AND event_type='purchase_order_cost_restored' ORDER BY created_at DESC LIMIT 1").get() }, { event_type: "purchase_order_cost_restored", cost_basis_cents: 100 });
});

test("receivables reports preserve document currency and reconstruct historical postings in base CAD", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,credit_limit_cents,credit_hold,active,version,created_at) VALUES ('customer-report','CUST-RPT','Report Customer','customer','USD',20000,0,1,1,'2026-01-01')");
  await run("INSERT INTO customer_invoices (id,number,customer_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,posted_at,posted_by,version) VALUES ('invoice-report','INV-REPORT','customer-report','partially_paid','2026-01-01','2026-01-15',10000,0,10000,3000,'USD',1.25,12500,'2026-01-01T12:00:00Z','Tester',1)");
  await run("INSERT INTO payments (id,number,direction,partner_id,document_type,document_id,amount_cents,payment_date,method,reference,posted_at,posted_by,currency,exchange_rate_to_base,base_amount_cents) VALUES ('payment-report','PAY-REPORT','inbound','customer-report','customer_invoice','invoice-report',3000,'2026-02-10','ach','February receipt','2026-02-10T12:00:00Z','Tester','USD',1.25,3750)");
  await run("INSERT INTO customer_credits (id,number,customer_id,customer_invoice_id,amount_cents,reason,status,posted_at,posted_by,version,currency,exchange_rate_to_base,base_amount_cents) VALUES ('credit-report','CR-REPORT','customer-report','invoice-report',1000,'March allowance','posted','2026-03-10T12:00:00Z','Tester',1,'USD',1.25,1250)");

  const january = await reportsModule.arAging("2026-01-31");
  const januaryCustomer = january.rows.find((row) => row.customerId === "customer-report");
  assert.equal(januaryCustomer.documentCurrency, "USD");
  assert.equal(januaryCustomer.documentOutstandingCents, 10000);
  assert.equal(januaryCustomer.totalBaseCents, 12500);
  assert.equal(januaryCustomer.days1To30BaseCents, 12500);

  const february = await reportsModule.customerStatement("customer-report", "2026-02-28");
  assert.deepEqual({
    currency: february.rows[0].currency,
    paidCents: february.rows[0].paidCents,
    creditedCents: february.rows[0].creditedCents,
    outstandingCents: february.rows[0].outstandingCents,
    outstandingBaseCents: february.rows[0].outstandingBaseCents,
  }, { currency: "USD", paidCents: 3000, creditedCents: 0, outstandingCents: 7000, outstandingBaseCents: 8750 });

  const march = await reportsModule.customerStatement("customer-report", "2026-03-31");
  assert.equal(march.rows[0].creditedCents, 1000);
  assert.equal(march.totals.outstandingBaseCents, 7500);
});

test("financial settlements persist the selected business date and cannot predate their document", async () => {
  const accountant = { id: "accountant", email: "accountant@example.com", name: "Accountant", role: "accounting", label: "Accountant <accountant@example.com>", localDevelopment: false };
  await assert.rejects(advancedDomain.executeWorkflow({ command: "recordPayment", entityId: "invoice-report", version: 1, idempotencyKey: "payment-before-invoice", actor: accountant, payload: { documentType: "customer_invoice", amountCents: 100, paymentDate: "2025-12-31", method: "bank_transfer", reference: "EARLY" } }), (error) => error?.code === "VALIDATION_ERROR" && /before the document invoice date/.test(error.message));
  await assert.rejects(advancedDomain.executeWorkflow({ command: "recordPayment", entityId: "invoice-report", version: 1, idempotencyKey: "payment-wrong-exchange", actor: accountant, payload: { documentType: "customer_invoice", amountCents: 100, paymentDate: "2026-04-09", method: "bank_transfer", reference: "WRONG-RATE", exchangeRateToBase: 1.5 } }), (error) => error?.code === "EXCHANGE_RATE_MISMATCH");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createCustomerCredit", entityId: "invoice-report", version: 1, idempotencyKey: "credit-wrong-exchange", actor: accountant, payload: { amountCents: 100, reason: "Wrong rate", currency: "USD", exchangeRateToBase: 1.5, postingDate: "2026-04-09" } }), (error) => error?.code === "EXCHANGE_RATE_MISMATCH");

  const payment = await advancedDomain.executeWorkflow({ command: "recordPayment", entityId: "invoice-report", version: 1, idempotencyKey: "dated-customer-payment", actor: accountant, payload: { documentType: "customer_invoice", amountCents: 500, paymentDate: "2026-04-10", method: "bank_transfer", reference: "BANK-APR-10" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT payment_date,amount_cents FROM payments WHERE id=?").get(payment.recordId) }, { payment_date: "2026-04-10", amount_cents: 500 });

  const credit = await advancedDomain.executeWorkflow({ command: "createCustomerCredit", entityId: "invoice-report", version: 2, idempotencyKey: "dated-customer-credit", actor: accountant, payload: { amountCents: 500, reason: "April allowance", currency: "USD", exchangeRateToBase: 1.25, postingDate: "2026-04-11" } });
  assert.match(db.sqlite.prepare("SELECT posted_at FROM customer_credits WHERE id=?").get(credit.recordId).posted_at, /^2026-04-11T/);
});

test("period locks validate modules, protect original document dates, and unlock with concurrency control", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const accountant = { id: "accountant", email: "accountant@example.com", name: "Accountant", role: "accounting", label: "Accountant <accountant@example.com>", localDevelopment: false };
  await assert.rejects(advancedDomain.executeWorkflow({ command: "lockPeriod", idempotencyKey: "invalid-lock-module", actor: administrator, payload: { module: "warehouse-ish", lockedThrough: "2026-01-31", reason: "Invalid test" } }), (error) => error?.code === "VALIDATION_ERROR");

  const lock = await advancedDomain.executeWorkflow({ command: "lockPeriod", idempotencyKey: "lock-accounting-january", actor: administrator, payload: { module: "accounting", lockedThrough: "2026-01-31", reason: "January close" } });
  await assert.rejects(advancedDomain.executeWorkflow({ command: "addDocumentCharge", entityId: "invoice-report", version: 3, idempotencyKey: "charge-locked-original-period", actor: accountant, payload: { documentType: "customer_invoice", chargeType: "fee", description: "Late correction", amountCents: 100, direction: "add", taxable: false, refundable: false, postingDate: "2026-08-10" } }), /accounting is locked through 2026-01-31/);

  await advancedDomain.executeWorkflow({ command: "unlockPeriod", entityId: lock.recordId, version: 1, idempotencyKey: "unlock-accounting-january", actor: administrator, payload: { reason: "Correction window approved" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT active,version FROM period_locks WHERE id=?").get(lock.recordId) }, { active: 0, version: 2 });
  await assert.rejects(advancedDomain.executeWorkflow({ command: "unlockPeriod", entityId: lock.recordId, version: 1, idempotencyKey: "stale-unlock-accounting-january", actor: administrator, payload: { reason: "Stale repeat" } }), (error) => ["INVALID_STATE", "VERSION_CONFLICT"].includes(error?.code));

  const purchasingLock = await advancedDomain.executeWorkflow({ command: "lockPeriod", idempotencyKey: "lock-purchasing-august", actor: administrator, payload: { module: "purchasing", lockedThrough: "2026-08-01", reason: "Purchasing close" } });
  const poVersion = db.sqlite.prepare("SELECT version FROM purchase_orders WHERE id='po-batch'").get().version;
  await assert.rejects(inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "po-batch", version: poVersion, idempotencyKey: "receipt-in-locked-purchasing-period", payload: { lineId: "pol-batch-a", quantity: 1, locationId: "loc-a", postingDate: "2026-08-01", actor: "Tester" } }), /purchasing is locked through 2026-08-01/);
  await advancedDomain.executeWorkflow({ command: "unlockPeriod", entityId: purchasingLock.recordId, version: 1, idempotencyKey: "unlock-purchasing-august", actor: administrator, payload: { reason: "Purchasing reopened" } });
});

test("one shipment consumes reservations split across locations", async () => {
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-b','B','B','storage','usable','wh-test',1,1)");
  await run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,currency,active,version,created_at) VALUES ('customer-a','CUST-A','Customer A','customer','100 Customer Ave','Edmonton','AB','T5J 0N5','CA','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-split','SO-SPLIT','customer-a','confirmed','not_invoiced','2026-08-10','CAD',1,1000,1000,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-split','so-split','prod-a',5,0,200,'stock',0,1,0)");
  await run("UPDATE inventory_balances SET on_hand_qty=3,reserved_qty=3,version=version+1 WHERE product_id='prod-a' AND location_id='loc-a'");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-a','loc-b',3,3,1)");
  await run("INSERT INTO reservations (id,sales_order_line_id,product_id,location_id,quantity,status,created_at) VALUES ('res-a','sol-split','prod-a','loc-a',3,'active','2026-08-01T00:00:00Z'),('res-b','sol-split','prod-a','loc-b',3,'active','2026-08-01T00:00:01Z')");
  await run("INSERT OR IGNORE INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES ('prod-a','fifo',100,100,1,'2026-08-01','tester')");
  await run("INSERT INTO cost_layers (id,product_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) VALUES ('layer-a','prod-a',6,6,100,0,'2026-08-01','open')");
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const salesLock = await advancedDomain.executeWorkflow({ command: "lockPeriod", idempotencyKey: "lock-sales-august", actor: administrator, payload: { module: "sales", lockedThrough: "2026-08-01", reason: "Sales close" } });
  await assert.rejects(inventoryDomain.executeInventoryCommand({ command: "shipSale", entityId: "so-split", version: 1, idempotencyKey: "ship-in-locked-sales-period", payload: { lineId: "sol-split", quantity: 5, carrier: "Prairie Freight", serviceLevel: "LTL", billOfLadingNumber: "BOL-LOCKED", postingDate: "2026-08-01", actor: "Tester" } }), /sales is locked through 2026-08-01/);
  await advancedDomain.executeWorkflow({ command: "unlockPeriod", entityId: salesLock.recordId, version: 1, idempotencyKey: "unlock-sales-august", actor: administrator, payload: { reason: "Sales reopened" } });
  await inventoryDomain.executeInventoryCommand({ command: "shipSale", entityId: "so-split", version: 1, idempotencyKey: "ship-split", payload: { lineId: "sol-split", quantity: 5, carrier: "Prairie Freight", serviceLevel: "LTL", billOfLadingNumber: "BOL-1001", postingDate: "2026-08-01", actor: "Tester" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT carrier,service_level,bill_of_lading_number,ship_to_postal_code FROM shipments WHERE sales_order_id='so-split'").get() }, { carrier: "Prairie Freight", service_level: "LTL", bill_of_lading_number: "BOL-1001", ship_to_postal_code: "T5J 0N5" });
  const lines = db.sqlite.prepare("SELECT sl.location_id,sl.quantity FROM shipment_lines sl JOIN shipments sh ON sh.id=sl.shipment_id WHERE sh.sales_order_id='so-split' ORDER BY sl.location_id").all().map((row) => ({ ...row }));
  assert.deepEqual(lines, [{ location_id: "loc-a", quantity: 3 }, { location_id: "loc-b", quantity: 2 }]);
  const balances = db.sqlite.prepare("SELECT location_id,on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-a' ORDER BY location_id").all().map((row) => ({ ...row }));
  assert.deepEqual(balances, [{ location_id: "loc-a", on_hand_qty: 0, reserved_qty: 0 }, { location_id: "loc-b", on_hand_qty: 1, reserved_qty: 1 }]);
  const invoiceable = await inventoryDomain.searchInventoryReferences("salesOrders", "SO-SPLIT", 10, undefined, "customer-a");
  assert.equal(invoiceable.items[0].invoiceableCents, 1000);

  const correctionSnapshot = await advancedDomain.getAdvancedSnapshot(undefined, { page: 1, pageSize: 100 });
  assert.deepEqual(correctionSnapshot.shipments.filter((row) => row.salesOrderId === "so-split").map((row) => row.quantity).sort((a, b) => a - b), [2, 3]);

  const shipment = db.sqlite.prepare("SELECT id,version FROM shipments WHERE sales_order_id='so-split'").get();
  const shipmentLines = db.sqlite.prepare("SELECT id,quantity FROM shipment_lines WHERE shipment_id=? ORDER BY id").all(shipment.id);
  const operator = { id: "operator", email: "operator@example.com", name: "Operator", role: "operator", label: "Operator <operator@example.com>", localDevelopment: false };
  await advancedDomain.executeWorkflow({ command: "reverseShipment", entityId: shipment.id, version: shipment.version, idempotencyKey: "reverse-first-split-shipment-line", actor: operator, payload: { lineId: shipmentLines[0].id, quantity: shipmentLines[0].quantity, postingDate: "2026-08-02", reason: "First pallet returned" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,version FROM shipments WHERE id=?").get(shipment.id) }, { status: "partially_reversed", version: 2 });
  await advancedDomain.executeWorkflow({ command: "reverseShipment", entityId: shipment.id, version: 2, idempotencyKey: "reverse-second-split-shipment-line", actor: operator, payload: { lineId: shipmentLines[1].id, quantity: shipmentLines[1].quantity, postingDate: "2026-08-02", reason: "Second pallet returned" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,version FROM shipments WHERE id=?").get(shipment.id) }, { status: "reversed", version: 3 });
});

test("immediate sale ships free stock and posts the customer invoice atomically without a reservation", async () => {
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-immediate','SKU-IMMEDIATE','Immediate sale product','test','test','test','test','quantity','stocked',400,1000,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-immediate','loc-a',3,0,1)");
  await run("INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES ('prod-immediate','fifo',400,400,1,'2026-08-01','Tester')");
  await run("INSERT INTO cost_layers (id,product_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) VALUES ('layer-immediate','prod-immediate',3,3,400,0,'2026-08-01','open')");
  await run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,payment_terms,currency,active,version,created_at) VALUES ('customer-immediate','CUST-IMMEDIATE','Immediate Customer','customer','12 Counter Way','Edmonton','AB','T5J 0N3','CA','Net 30','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,payment_terms,due_date,total_cents,version,created_at,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country) VALUES ('so-immediate','SO-IMMEDIATE','customer-immediate','confirmed','not_invoiced','2026-08-24','CAD',1,2205,'Net 30','2026-09-23',2205,1,'2026-08-24','Immediate Customer','12 Counter Way','Edmonton','AB','T5J 0N3','CA')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps) VALUES ('sol-immediate','so-immediate','prod-immediate',2,0,1000,'stock',100,1,'GST',500)");
  await run("INSERT INTO document_charges (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at) VALUES ('charge-immediate','sales_order','so-immediate','delivery','Counter delivery',200,'add',1,0,'GST',500,10,'2026-08-24')");

  const command = { command: "postImmediateSale", entityId: "so-immediate", version: 1, idempotencyKey: "post-immediate-sale", payload: { lineId: "sol-immediate", quantity: 2, postingDate: "2026-08-24", carrier: "Customer pickup", trackingNumber: "PICKUP-42", actor: "Tester", actorId: "tester", actorEmail: "tester@example.com" } };
  const result = await inventoryDomain.executeInventoryCommand(command);
  assert.match(result.message, new RegExp(`${result.shipmentNumber} posted and ${result.invoiceNumber} is ready`));
  assert.ok(result.shipmentId);
  assert.ok(result.invoiceId);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-immediate' AND location_id='loc-a'").get() }, { on_hand_qty: 1, reserved_qty: 0 });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservations WHERE sales_order_line_id='sol-immediate'").get().count, 0);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT carrier,service_level,tracking_number,status FROM shipments WHERE id=?").get(result.shipmentId) }, { carrier: "Customer pickup", service_level: "Immediate sale", tracking_number: "PICKUP-42", status: "posted" });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,payment_terms FROM customer_invoices WHERE id=?").get(result.invoiceId) }, { status: "posted", invoice_date: "2026-08-24", due_date: "2026-09-23", subtotal_cents: 2100, tax_cents: 105, total_cents: 2205, payment_terms: "Net 30" });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT quantity,unit_price_cents,line_total_cents FROM customer_invoice_lines WHERE customer_invoice_id=?").get(result.invoiceId) }, { quantity: 2, unit_price_cents: 1000, line_total_cents: 1900 });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT quantity,value_cents FROM inventory_value_entries WHERE reference_id=?").get(result.shipmentId) }, { quantity: -2, value_cents: -800 });
  assert.equal(db.sqlite.prepare("SELECT remaining_qty FROM cost_layers WHERE id='layer-immediate'").get().remaining_qty, 1);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT billing_status,version FROM sales_orders WHERE id='so-immediate'").get() }, { billing_status: "invoiced", version: 2 });
  assert.deepEqual(db.sqlite.prepare("SELECT event_type FROM outbox_events WHERE aggregate_id IN (?,?) ORDER BY event_type").all(result.shipmentId, result.invoiceId).map((row) => row.event_type), ["customer_invoice.posted", "inventory.shipment_posted"]);
  const salesJourney = await inventoryDomain.getInventorySnapshot({ scope: "sales-orders", search: "SO-IMMEDIATE", page: 1, pageSize: 10 });
  const connectedInvoices = JSON.parse(salesJourney.salesOrders[0].customerInvoicesJson);
  const connectedShipments = JSON.parse(salesJourney.salesOrders[0].shipmentsJson);
  assert.deepEqual({ number: connectedInvoices[0].number, amountCents: connectedInvoices[0].amountCents }, { number: result.invoiceNumber, amountCents: 2205 });
  assert.deepEqual({ number: connectedShipments[0].number, trackingNumber: connectedShipments[0].trackingNumber }, { number: result.shipmentNumber, trackingNumber: "PICKUP-42" });

  const repeated = await inventoryDomain.executeInventoryCommand(command);
  assert.equal(repeated.invoiceId, result.invoiceId);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM shipments WHERE sales_order_id='so-immediate'").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM customer_invoices WHERE sales_order_id='so-immediate'").get().count, 1);

  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country) VALUES ('so-immediate-short','SO-IMMEDIATE-SHORT','customer-immediate','confirmed','not_invoiced','2026-08-24','CAD',1,2000,2000,1,'2026-08-24','Immediate Customer','12 Counter Way','Edmonton','AB','T5J 0N3','CA')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-immediate-short','so-immediate-short','prod-immediate',2,0,1000,'stock',0,0,0)");
  await assert.rejects(inventoryDomain.executeInventoryCommand({ command: "postImmediateSale", entityId: "so-immediate-short", version: 1, idempotencyKey: "post-immediate-sale-short", payload: { lineId: "sol-immediate-short", quantity: 2, postingDate: "2026-08-24", actor: "Tester" } }), (error) => error?.code === "INSUFFICIENT_AVAILABILITY");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM shipments WHERE sales_order_id='so-immediate-short'").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM customer_invoices WHERE sales_order_id='so-immediate-short'").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-immediate' AND location_id='loc-a'").get().on_hand_qty, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM command_log WHERE idempotency_key='post-immediate-sale-short'").get().count, 0);
});

test("counter sale creates its hidden order, shipment, invoice, and full payment in one posting", async () => {
  await run("INSERT OR IGNORE INTO warehouses (id,code,name,timezone,active,version) VALUES ('wh-test','TEST','Test warehouse','UTC',1,1)");
  await run("INSERT OR IGNORE INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-a','A','A','storage','usable','wh-test',1,1)");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-counter','SKU-COUNTER','Counter sale product','test','test','test','test','quantity','stocked',400,1000,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-counter','loc-a',5,0,1)");
  await run("INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES ('prod-counter','fifo',400,400,1,'2026-08-01','Tester')");
  await run("INSERT INTO cost_layers (id,product_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) VALUES ('layer-counter','prod-counter',5,5,400,0,'2026-08-01','open')");
  await run("INSERT INTO business_partners (id,code,name,partner_type,payment_terms,currency,credit_limit_cents,credit_hold,active,version,created_at) VALUES ('customer-counter-account','CUST-COUNTER','Counter Account Customer','customer','Net 30','CAD',100000,0,1,1,'2026-08-01')");

  const command = { command: "postCounterSale", entityId: "counter-sale-request-1", version: 1, idempotencyKey: "post-counter-sale", payload: {
    customerId: "customer-walk-in", postingDate: "2026-08-25", settlement: "pay_now", currency: "CAD", exchangeRateToBase: 1,
    paymentMethod: "cash", paymentReference: "TILL-0042", actor: "Tester", actorId: "tester", actorEmail: "tester@example.com",
    lines: [
      { kind: "item", productId: "prod-counter", quantity: 1, uomId: "uom-each", unitPriceCents: 1000, discountCents: 0, taxable: true, taxCode: "GST", taxRateBps: 500, fulfillmentRoute: "stock", locationId: "loc-a" },
      { kind: "item", productId: "prod-counter", quantity: 2, uomId: "uom-each", unitPriceCents: 1000, discountCents: 200, taxable: true, taxCode: "GST", taxRateBps: 500, fulfillmentRoute: "stock", locationId: "loc-a" },
    ],
  } };
  const result = await inventoryDomain.executeInventoryCommand(command);
  assert.ok(result.salesOrderId);
  assert.ok(result.shipmentId);
  assert.ok(result.invoiceId);
  assert.ok(result.paymentId);
  assert.match(result.message, new RegExp(`${result.invoiceNumber} paid.*${result.salesOrderNumber}`));
  assert.deepEqual({ ...db.sqlite.prepare("SELECT code,name,payment_terms FROM business_partners WHERE id='customer-walk-in'").get() }, { code: "WALK-IN", name: "Walk-in Customer", payment_terms: "Due on receipt" });
  assert.equal(db.sqlite.prepare("SELECT customer_id FROM sales_orders WHERE id=?").get(result.salesOrderId).customer_id, "customer-walk-in");
  assert.deepEqual({ ...db.sqlite.prepare("SELECT lifecycle_status,billing_status,total_cents,version FROM sales_orders WHERE id=?").get(result.salesOrderId) }, { lifecycle_status: "confirmed", billing_status: "invoiced", total_cents: 2940, version: 1 });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sales_order_lines WHERE sales_order_id=?").get(result.salesOrderId).count, 2);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,paid_cents,subtotal_cents,tax_cents,total_cents,payment_terms FROM customer_invoices WHERE id=?").get(result.invoiceId) }, { status: "paid", paid_cents: 2940, subtotal_cents: 2800, tax_cents: 140, total_cents: 2940, payment_terms: "Due on receipt" });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT direction,amount_cents,method,reference FROM payments WHERE id=?").get(result.paymentId) }, { direction: "inbound", amount_cents: 2940, method: "cash", reference: "TILL-0042" });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-counter' AND location_id='loc-a'").get() }, { on_hand_qty: 2, reserved_qty: 0 });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT COUNT(*) AS lines,COALESCE(SUM(quantity),0) AS quantity FROM shipment_lines WHERE shipment_id=?").get(result.shipmentId) }, { lines: 2, quantity: 3 });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT COALESCE(SUM(quantity),0) AS quantity,COALESCE(SUM(value_cents),0) AS value FROM inventory_value_entries WHERE reference_id=?").get(result.shipmentId) }, { quantity: -3, value: -1200 });
  assert.equal(db.sqlite.prepare("SELECT remaining_qty FROM cost_layers WHERE id='layer-counter'").get().remaining_qty, 2);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservations WHERE sales_order_line_id IN (SELECT id FROM sales_order_lines WHERE sales_order_id=?)").get(result.salesOrderId).count, 0);

  const readyToInvoice = await inventoryDomain.getInventorySnapshot({ scope: "customer-invoices", search: result.salesOrderNumber, page: 1, pageSize: 10 });
  assert.deepEqual(readyToInvoice.salesOrders, [], "a fully invoiced counter sale must not remain in the readiness queue");
  assert.equal(readyToInvoice.pagination.filteredTotal, 0);
  const accountant = { id: "accountant", email: "accountant@example.com", name: "Accountant", role: "accounting", label: "Accountant <accountant@example.com>", localDevelopment: false };
  const postedInvoices = await advancedDomain.getAdvancedSnapshot(accountant, { scope: "customer-billing", page: 1, pageSize: 100 });
  assert.equal(postedInvoices.customerInvoices.find((invoice) => invoice.id === result.invoiceId)?.status, "paid", "paid counter-sale invoices remain in the posted register");

  const repeated = await inventoryDomain.executeInventoryCommand(command);
  assert.equal(repeated.invoiceId, result.invoiceId);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM customer_invoices WHERE sales_order_id=?").get(result.salesOrderId).count, 1);

  const accountSale = await inventoryDomain.executeInventoryCommand({ ...command, entityId: "counter-sale-request-account", idempotencyKey: "post-counter-sale-account", payload: {
    ...command.payload, customerId: "customer-counter-account", settlement: "on_account", paymentMethod: undefined, paymentReference: undefined, paymentTerms: "Net 30", dueDate: "2026-09-24",
    lines: [{ ...command.payload.lines[0], quantity: 1 }],
  } });
  assert.equal(accountSale.paymentId, undefined);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT status,paid_cents,payment_terms,due_date FROM customer_invoices WHERE id=?").get(accountSale.invoiceId) }, { status: "posted", paid_cents: 0, payment_terms: "Net 30", due_date: "2026-09-24" });
  assert.equal(db.sqlite.prepare("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-counter' AND location_id='loc-a'").get().on_hand_qty, 1);

  await assert.rejects(inventoryDomain.executeInventoryCommand({ ...command, entityId: "counter-sale-request-walk-in-account", idempotencyKey: "post-counter-sale-walk-in-account", payload: {
    ...command.payload, settlement: "on_account", paymentMethod: undefined, paymentReference: undefined, paymentTerms: "Net 30", dueDate: "2026-09-24",
    lines: [{ ...command.payload.lines[0], quantity: 1 }],
  } }), (error) => error?.code === "WALK_IN_PAYMENT_REQUIRED");

  await assert.rejects(inventoryDomain.executeInventoryCommand({ ...command, entityId: "counter-sale-request-short", idempotencyKey: "post-counter-sale-short", payload: { ...command.payload, lines: [
    { ...command.payload.lines[0], quantity: 2 }, { ...command.payload.lines[1], quantity: 1, discountCents: 0 },
  ] } }), (error) => error?.code === "INSUFFICIENT_AVAILABILITY");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM command_log WHERE idempotency_key='post-counter-sale-short'").get().count, 0);
});

test("accounting exports reject base-total plugs and emit tax from the tax component", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('vendor-a','VEND-A','Vendor A','vendor','USD',1,1,'2026-08-01')");
  await run("INSERT INTO vendor_bills (id,number,vendor_invoice_number,vendor_id,status,match_status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,version) VALUES ('bill-fx','VB-FX','V-FX','vendor-a','posted','matched','2026-08-02','2026-09-01',10000,500,10500,0,'USD',1.5,16000,1)");
  const actor = { id: "accountant", email: "accountant@example.com", name: "Accountant", role: "accounting", label: "Accountant <accountant@example.com>", localDevelopment: false };
  await assert.rejects(exportsModule.buildExport("quickbooks", actor, { from: "2026-08-01", to: "2026-08-31" }), /base total is 16000; expected 15750/);
  await run("UPDATE vendor_bills SET base_total_cents=15750 WHERE id='bill-fx'");
  const exported = await exportsModule.buildExport("accounting", actor, { from: "2026-08-01", to: "2026-08-31" });
  assert.match(exported.body, /Recoverable tax,750,0/);
  await exportsModule.buildExport("quickbooks", actor, { from: "2026-08-01", to: "2026-08-31" });
});

test("tenant integrity blocks orphaned locations and exports accept a valid location", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const legacyMovement = "INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,posted_at,posted_by,idempotency_key) VALUES ('movement-orphan','legacy_adjustment','prod-a',-1,'loc-restored-legacy','usable','legacy_import','legacy-1','2026-08-01T00:00:00Z','Legacy import','legacy-orphan')";
  await assert.rejects(run(legacyMovement), /CROSS_TENANT_REFERENCE/);
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-restored-legacy','LEGACY-A','Restored legacy A','storage','usable','wh-test',1,1)");
  await run(legacyMovement);
  const exported = await exportsModule.buildExport("inventory", administrator);
  assert.ok(exported.rowCount > 0);
  assert.equal(db.sqlite.prepare("SELECT code FROM locations WHERE id='loc-restored-legacy'").get().code, "LEGACY-A");
});

test("sales-order availability is computed across every line, independent of the product page", async () => {
  // The worklist row and the "blocked" queue must answer the same question. This used to be
  // derived in the browser from the first line's product within the current product page, so
  // on the sales-order scope — which ships no products at all — every order read as short.
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-avail-covered','SKU-AVAIL-OK','Covered product','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-avail-short','SKU-AVAIL-SHORT','Short product','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-avail-covered','loc-a',4,0,1)");
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('customer-avail','CUST-AV','Availability Customer','customer','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-avail','SO-AVAIL','customer-avail','confirmed','not_invoiced','2026-09-01','CAD',1,1400,1400,1,'2026-08-01')");
  // Line one is fully covered by stock; line two has neither stock nor approved supply.
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-avail-ok','so-avail','prod-avail-covered',4,0,200,'stock',0,1,0)");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-avail-short','so-avail','prod-avail-short',3,0,200,'stock',0,1,0)");

  const load = async (status = "") => {
    const snapshot = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "sales-orders", search: "SO-AVAIL", status });
    return { snapshot, order: snapshot.salesOrders.find((row) => row.number === "SO-AVAIL") };
  };

  const initial = await load();
  // The crux: this scope carries no products, so the figures cannot come from the browser.
  assert.equal(initial.snapshot.products.length, 0);
  assert.equal(initial.order.openToShipQuantity, 7);
  assert.equal(initial.order.availableNowQuantity, 4);
  assert.equal(initial.order.incomingSupplyQuantity, 0);
  assert.equal((await load("blocked")).order?.number, "SO-AVAIL");

  // Approved incoming supply covers the short line, and the row must stop reading as short at
  // the same moment it leaves the blocked queue.
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('po-avail','PO-AVAIL','vendor-a','approved','not_billed','2026-08-25','CAD',1,300,300,1,'2026-08-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route) VALUES ('pol-avail','po-avail','prod-avail-short',3,0,100,'stock')");
  // Supply expected after the customer's requested date must not appear in the
  // "incoming before date" quantity or rescue the order from the blocked queue.
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('po-avail-late','PO-AVAIL-LATE','vendor-a','approved','not_billed','2026-09-02','CAD',1,300,300,1,'2026-08-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route) VALUES ('pol-avail-late','po-avail-late','prod-avail-short',3,0,100,'stock')");

  const supplied = await load();
  assert.equal(supplied.order.availableNowQuantity, 4);
  assert.equal(supplied.order.incomingSupplyQuantity, 3);
  assert.equal((await load("blocked")).order, undefined);

  // Each line also carries its own product's supply, because the reserve and ship dialogs work
  // one line at a time and cannot reach the product page either.
  const byId = Object.fromEntries(supplied.order.lines.map((line) => [line.id, line]));
  assert.equal(byId["sol-avail-ok"].productAvailableQuantity, 4);
  assert.equal(byId["sol-avail-ok"].productIncomingQuantity, 0);
  assert.equal(byId["sol-avail-short"].productAvailableQuantity, 0);
  assert.equal(byId["sol-avail-short"].productIncomingQuantity, 3);
});

test("a fully reserved sales order is covered and is absent from the blocked queue", async () => {
  const before = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 1, scope: "sales-orders" });
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-reserved-covered','SKU-RESERVED-COVERED','Reserved covered product','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-reserved-covered','loc-a',1,1,1)");
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('customer-reserved-covered','CUST-RES-COVERED','Reserved Coverage Customer','customer','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-reserved-covered','SO-RESERVED-COVERED','customer-reserved-covered','confirmed','not_invoiced','2026-09-14','CAD',1,200,200,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-reserved-covered','so-reserved-covered','prod-reserved-covered',1,0,200,'stock',0,1,0)");
  await run("INSERT INTO reservations (id,sales_order_line_id,product_id,location_id,quantity,status,created_at) VALUES ('res-reserved-covered','sol-reserved-covered','prod-reserved-covered','loc-a',1,'active','2026-08-01T00:00:00Z')");

  const snapshot = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "sales-orders", search: "SO-RESERVED-COVERED" });
  const order = snapshot.salesOrders.find((row) => row.number === "SO-RESERVED-COVERED");
  assert.deepEqual({
    open: order.openToShipQuantity,
    reserved: order.reservedQuantity,
    available: order.availableNowQuantity,
    incoming: order.incomingSupplyQuantity,
  }, { open: 1, reserved: 1, available: 0, incoming: 0 });
  assert.equal((await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "sales-orders", search: "SO-RESERVED-COVERED", status: "blocked" })).salesOrders.length, 0);
  assert.equal(snapshot.summary.blockedSalesOrders, before.summary.blockedSalesOrders);
});

test("management and warehouse calculations use complete, non-overlapping quantities", async () => {
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('customer-ops-reports','CUST-OPS-RPT','Operations Report Customer','customer','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-replenishment','SKU-REPLENISH','Reserved replenishment product','test','test','test','test','quantity','stocked',100,200,7,20,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-replenishment','loc-a',10,4,1)");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-report-open','SO-REPORT-OPEN','customer-ops-reports','confirmed','not_invoiced','2026-09-10','CAD',1,800,800,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-report-open','so-report-open','prod-replenishment',4,0,200,'stock',0,0,0)");

  const replenishment = await reportsModule.replenishmentWorklist();
  const replenishmentRow = replenishment.rows.find((row) => row.id === "prod-replenishment");
  assert.deepEqual({
    usable: replenishmentRow.usableQuantity,
    available: replenishmentRow.availableQuantity,
    demand: replenishmentRow.openDemandQuantity,
    projected: replenishmentRow.projectedQuantity,
    suggested: replenishmentRow.suggestedOrderQuantity,
    reorderPoint: replenishmentRow.reorderPoint,
    maxStockLevel: replenishmentRow.maxStockLevel,
  }, { usable: 10, available: 6, demand: 4, projected: 6, suggested: 14, reorderPoint: 7, maxStockLevel: 20 });

  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-report-shipped','SO-REPORT-SHIPPED','customer-ops-reports','confirmed','not_invoiced','2026-01-05','CAD',1,1000,1000,1,'2026-01-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-report-shipped','so-report-shipped','prod-replenishment',5,0,200,'stock',0,0,0)");
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,source_line_id,sales_order_line_id,posted_at,posted_by,idempotency_key) VALUES ('movement-report-shipped','sales_shipment','prod-replenishment',-5,'loc-a','usable','shipment','shipment-report','shipment-line-report','sol-report-shipped','2026-01-05T12:00:00Z','Tester','report-shipped')");
  const openOrders = await reportsModule.openOrdersByCustomer();
  const customerCommitment = openOrders.rows.find((row) => row.customerId === "customer-ops-reports");
  assert.deepEqual({ orderCount: customerCommitment.orderCount, orderedQuantity: customerCommitment.orderedQuantity, openQuantity: customerCommitment.openQuantity, earliestRequestedDate: customerCommitment.earliestRequestedDate }, { orderCount: 1, orderedQuantity: 4, openQuantity: 4, earliestRequestedDate: "2026-09-10" });

  // One unit remains actively reserved after three of four units ship. It must remain in the
  // fulfillment queue even though the cumulative shipped quantity is now larger than the
  // reservation remainder.
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,source_line_id,sales_order_line_id,posted_at,posted_by,idempotency_key) VALUES ('movement-report-partial','sales_shipment','prod-replenishment',-3,'loc-a','usable','shipment','shipment-report-partial','shipment-line-report-partial','sol-report-open','2026-08-05T12:00:00Z','Tester','report-partial')");
  await run("INSERT INTO reservations (id,sales_order_line_id,product_id,location_id,quantity,status,created_at) VALUES ('reservation-report-remainder','sol-report-open','prod-replenishment','loc-a',1,'active','2026-08-05T11:00:00Z')");
  const fulfillment = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "fulfillment", search: "SO-REPORT-OPEN", status: "reserved" });
  assert.equal(fulfillment.salesOrders[0]?.number, "SO-REPORT-OPEN");
  assert.deepEqual({ reserved: fulfillment.salesOrders[0].reservedQuantity, shipped: fulfillment.salesOrders[0].shippedQuantity }, { reserved: 1, shipped: 3 });

  // Once every shipped unit has come back, the order no longer belongs in the return intake
  // queue, and the line-level return dialog sees a zero remainder as well.
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,sales_order_line_id,posted_at,posted_by,idempotency_key) VALUES ('movement-report-returned','customer_return','prod-replenishment',3,'loc-a','usable','customer_return','return-report','return-line-report','sol-report-open','2026-08-06T12:00:00Z','Tester','report-returned')");
  const returns = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "customer-returns", search: "SO-REPORT-OPEN", status: "shipped" });
  assert.equal(returns.salesOrders.length, 0);
  const returnedOrder = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "sales-orders", search: "SO-REPORT-OPEN" });
  assert.deepEqual({ returned: returnedOrder.salesOrders[0].returnedQuantity, lineReturned: returnedOrder.salesOrders[0].lines[0].returnedQuantity }, { returned: 3, lineReturned: 3 });

  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-putaway-report','PUTAWAY-RPT','Receiving overflow','receiving','usable','wh-test',1,1)");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-putaway-report','SKU-PUTAWAY-RPT','ZZZ put-away product','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-putaway-report','loc-putaway-report',3,0,1)");
  const warehouse = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 1, scope: "warehouse", warehouseId: "wh-test" });
  assert.equal(warehouse.inventoryBalances.some((row) => row.productId === "prod-putaway-report"), false);
  assert.equal(warehouse.summary.receivingBalanceCount, 1);
});

test("the dashboard special-order watchlist searches beyond the first catalog page", async () => {
  for (let index = 0; index < 55; index += 1) {
    const suffix = String(index).padStart(2, "0");
    await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `prod-dashboard-filler-${suffix}`, `SKU-DASH-${suffix}`, `AAA dashboard filler ${suffix}`, "test", "test", "test", "test", "quantity", "stocked", 100, 200, 0, "uom-each", "uom-each", "uom-each", 1, 1, "2026-08-01");
  }
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('prod-dashboard-special','SKU-DASH-SPECIAL','ZZZ dashboard special order','test','test','test','test','quantity','special_order',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-dashboard-special','SO-DASH-SPECIAL','customer-ops-reports','confirmed','not_invoiced','2026-09-15','CAD',1,400,400,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-dashboard-special','so-dashboard-special','prod-dashboard-special',2,0,200,'special_order',0,0,0)");

  const home = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 50, scope: "home" });
  assert.equal(home.products.some((row) => row.id === "prod-dashboard-special"), true);
  assert.equal(home.products.every((row) => ["special_order", "drop_ship"].includes(String(row.inventoryPolicy))), true);
});

test("inventory count sessions save, review, approve, post, and preserve their audit lineage", async () => {
  const operator = { id: "count-operator", email: "counter@example.com", name: "Counter", role: "operator", label: "Counter <counter@example.com>", localDevelopment: false };
  const manager = { id: "count-manager", email: "manager@example.com", name: "Manager", role: "manager", label: "Manager <manager@example.com>", localDevelopment: false };
  await run("INSERT INTO warehouses (id,code,name,timezone,active,version) VALUES ('warehouse-count-test','COUNT','Count Test Warehouse','America/Edmonton',1,1)");
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('location-count-test','COUNT-A-01','Count aisle','storage','usable','warehouse-count-test',1,1)");
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('product-count-test','COUNT-SKU','Count session product','test','test','test','test','quantity','stocked',200000,250000,0,'uom-each','uom-each','uom-each',1,1,'2026-09-01')");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('product-count-test','location-count-test',2,0,1)");
  await run("INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES ('product-count-test','standard',200000,200000,1,'2026-09-01','Tester')");

  const created = await countSessions.createCountSession(operator, { countType: "correction", warehouseId: "warehouse-count-test", effectiveDate: "2026-09-02", blindCount: false, idempotencyKey: "count-session-create-test" });
  await countSessions.addCountLine(operator, { sessionId: created.session.id, productId: "product-count-test", locationId: "location-count-test" });
  let workspace = await countSessions.getCountSessionWorkspace({ sessionId: created.session.id });
  const line = workspace.lines[0];
  await countSessions.saveCountLine(operator, { sessionId: created.session.id, lineId: line.id, version: line.version, countedQuantity: 3, reason: "Found in adjacent bay" });
  await countSessions.submitCountSession(operator, { sessionId: created.session.id });

  const firstPost = await countSessions.postCountSession(operator, { sessionId: created.session.id, postingDate: "2026-09-02" });
  assert.equal(firstPost.finished, false);
  assert.equal(firstPost.blocked[0].code, "APPROVAL_REQUIRED");
  workspace = await countSessions.getCountSessionWorkspace({ sessionId: created.session.id });
  assert.equal(workspace.lines[0].status, "needs_approval");

  await countSessions.requestCountLineApproval(operator, { sessionId: created.session.id, lineId: line.id, idempotencyKey: "count-session-approval-request-test" });
  await countSessions.approveCountLine(manager, { sessionId: created.session.id, lineId: line.id, reason: "Variance independently reviewed", idempotencyKey: "count-session-approval-decision-test" });
  const finalPost = await countSessions.postCountSession(operator, { sessionId: created.session.id, postingDate: "2026-09-02" });
  assert.equal(finalPost.finished, true);
  assert.equal(db.sqlite.prepare("SELECT status FROM inventory_count_sessions WHERE id=?").get(created.session.id).status, "posted");
  assert.equal(db.sqlite.prepare("SELECT on_hand_qty FROM inventory_balances WHERE product_id='product-count-test' AND location_id='location-count-test'").get().on_hand_qty, 3);
  const posted = db.sqlite.prepare(`SELECT ic.count_session_id AS sessionId,ic.count_session_line_id AS lineId,sm.movement_type AS movementType,sm.inventory_status AS inventoryStatus
    FROM inventory_counts ic JOIN stock_movements sm ON sm.source_document_id=ic.id WHERE ic.count_session_id=?`).get(created.session.id);
  assert.deepEqual({ ...posted }, { sessionId: created.session.id, lineId: line.id, movementType: "inventory_adjustment_gain", inventoryStatus: "usable" });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_type='inventory_count_session' AND entity_id=?").get(created.session.id).count >= 3, true);
});

test("opening inventory uses opening balance accounting and stale count sessions never overwrite newer stock", async () => {
  const administrator = { id: "count-admin", email: "admin@example.com", name: "Admin", role: "administrator", label: "Admin <admin@example.com>", localDevelopment: false };
  await run("INSERT INTO warehouses (id,code,name,timezone,active,version) VALUES ('warehouse-opening-test','OPEN','Opening Test Warehouse','America/Edmonton',1,1)");
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('location-opening-test','OPEN-QA','Opening quarantine','quarantine','quarantine','warehouse-opening-test',1,1)");
  for (const [id, sku] of [["product-opening-test", "OPEN-SKU"], ["product-conflict-test", "CONFLICT-SKU"]]) {
    await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES (?,?,?,'test','test','test','test','quantity','stocked',5000,7000,0,'uom-each','uom-each','uom-each',1,1,'2026-09-01')", id, sku, `${sku} product`);
  }
  const opening = await countSessions.createCountSession(administrator, { countType: "opening", warehouseId: "warehouse-opening-test", effectiveDate: "2026-09-02", idempotencyKey: "opening-session-create-test" });
  await countSessions.addCountLine(administrator, { sessionId: opening.session.id, productId: "product-opening-test", locationId: "location-opening-test" });
  let workspace = await countSessions.getCountSessionWorkspace({ sessionId: opening.session.id });
  await countSessions.saveCountLine(administrator, { sessionId: opening.session.id, lineId: workspace.lines[0].id, version: workspace.lines[0].version, countedQuantity: 4, unitCostCents: 5000, reason: "Initial warehouse cutover" });
  await countSessions.submitCountSession(administrator, { sessionId: opening.session.id });
  assert.equal((await countSessions.postCountSession(administrator, { sessionId: opening.session.id, postingDate: "2026-09-02" })).finished, true);
  const openingMovement = db.sqlite.prepare("SELECT movement_type,inventory_status FROM stock_movements WHERE source_document_id=(SELECT id FROM inventory_counts WHERE count_session_id=?)").get(opening.session.id);
  assert.deepEqual({ ...openingMovement }, { movement_type: "opening_balance", inventory_status: "quarantine" });
  assert.equal(db.sqlite.prepare("SELECT entry_type FROM inventory_value_entries WHERE reference_id=(SELECT id FROM inventory_counts WHERE count_session_id=?)").get(opening.session.id).entry_type, "opening_balance");

  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('product-conflict-test','location-opening-test',1,0,1)");
  const conflict = await countSessions.createCountSession(administrator, { countType: "correction", warehouseId: "warehouse-opening-test", effectiveDate: "2026-09-02", idempotencyKey: "conflict-session-create-test" });
  await countSessions.addCountLine(administrator, { sessionId: conflict.session.id, productId: "product-conflict-test", locationId: "location-opening-test" });
  workspace = await countSessions.getCountSessionWorkspace({ sessionId: conflict.session.id });
  await countSessions.saveCountLine(administrator, { sessionId: conflict.session.id, lineId: workspace.lines[0].id, version: workspace.lines[0].version, countedQuantity: 1, reason: "Count confirmed" });
  await countSessions.submitCountSession(administrator, { sessionId: conflict.session.id });
  await run("UPDATE inventory_balances SET on_hand_qty=2,version=version+1 WHERE product_id='product-conflict-test' AND location_id='location-opening-test'");
  const result = await countSessions.postCountSession(administrator, { sessionId: conflict.session.id, postingDate: "2026-09-02" });
  assert.equal(result.finished, false);
  assert.equal(result.blocked[0].code, "VERSION_CONFLICT");
  assert.equal(db.sqlite.prepare("SELECT on_hand_qty FROM inventory_balances WHERE product_id='product-conflict-test' AND location_id='location-opening-test'").get().on_hand_qty, 2);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM inventory_counts WHERE count_session_id=?").get(conflict.session.id).count, 0);
});

test("the margin matrix can become the catalog default without replacing specific manual overrides", async () => {
  const administrator = { id: "catalog-pricing-admin", email: "catalog-pricing-admin@example.com", name: "Catalog Pricing Admin", role: "administrator", label: "Catalog Pricing Admin <catalog-pricing-admin@example.com>", localDevelopment: false };
  await run(`INSERT INTO products
    (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,last_unit_cost_cents,
     selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
    VALUES
    ('product-catalog-matrix','MATRIX-DEFAULT','Matrix default product','matrix-test','test','test','test','quantity','stocked',1000,800,1999,1200,'manual','Imported from Max Green inventory count sheet',0,'uom-each','uom-each','uom-each',1,1,'2026-09-02'),
    ('product-manual-exception','MATRIX-MANUAL','Manual exception product','matrix-test','test','test','test','quantity','stocked',1000,800,2222,1200,'manual','Market-specific distributor override',0,'uom-each','uom-each','uom-each',1,1,'2026-09-02')`);

  assert.equal(advancedDomain.workflowCapability("adoptMarginMatrixForCatalog"), "administer");
  const result = await advancedDomain.executeWorkflow({ command: "adoptMarginMatrixForCatalog", idempotencyKey: "adopt-margin-matrix-catalog", actor: administrator, payload: {} });
  assert.match(result.message, /now use the automatic margin matrix/);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT pricing_mode,selling_price_cents,manual_price_reason FROM products WHERE id='product-catalog-matrix'").get() }, {
    pricing_mode: "automatic", selling_price_cents: 1200, manual_price_reason: null,
  });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT pricing_mode,selling_price_cents,manual_price_reason FROM products WHERE id='product-manual-exception'").get() }, {
    pricing_mode: "manual", selling_price_cents: 2222, manual_price_reason: "Market-specific distributor override",
  });
  assert.equal(db.sqlite.prepare("SELECT event_type FROM catalog_price_history WHERE product_id='product-catalog-matrix' ORDER BY created_at DESC LIMIT 1").get().event_type, "catalog_matrix_adopted");
});

test("reorder percentage rules support company followers, custom parts, and apply-to-all", async () => {
  const administrator = { id: "reorder-admin", email: "reorder-admin@example.com", name: "Reorder Admin", role: "administrator", label: "Reorder Admin <reorder-admin@example.com>", localDevelopment: false };
  const base = { category: "reorder-test", material: "test", dimensions: "test", finish: "test", trackingPolicy: "quantity", inventoryPolicy: "stocked", standardCostCents: 100, sellingPriceCents: 200, baseUomId: "uom-each", purchaseUomId: "uom-each", salesUomId: "uom-each" };
  const follower = await advancedDomain.executeWorkflow({ command: "createProduct", idempotencyKey: "create-reorder-follower", actor: administrator, payload: { ...base, sku: "REORDER-FOLLOW", name: "Company reorder follower", maxStockLevel: 20, reorderRuleMode: "global" } });
  const custom = await advancedDomain.executeWorkflow({ command: "createProduct", idempotencyKey: "create-reorder-custom", actor: administrator, payload: { ...base, sku: "REORDER-CUSTOM", name: "Custom reorder part", maxStockLevel: 20, reorderRuleMode: "custom", reorderRulePercent: 40 } });
  const manual = await advancedDomain.executeWorkflow({ command: "createProduct", idempotencyKey: "create-reorder-manual", actor: administrator, payload: { ...base, sku: "REORDER-MANUAL", name: "Manual reorder part", maxStockLevel: 20, reorderPoint: 3, reorderRuleMode: "manual" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT reorder_point,reorder_rule_mode,reorder_rule_percent FROM products WHERE id=?").get(follower.recordId) }, { reorder_point: 14, reorder_rule_mode: "global", reorder_rule_percent: 70 });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT reorder_point,reorder_rule_mode,reorder_rule_percent FROM products WHERE id=?").get(custom.recordId) }, { reorder_point: 8, reorder_rule_mode: "custom", reorder_rule_percent: 40 });

  const version = () => db.sqlite.prepare("SELECT version FROM system_settings WHERE key='inventory.reorderPointRule'").get().version;
  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "inventory.reorderPointRule", version: version(), idempotencyKey: "update-following-reorder-rule", actor: administrator, payload: { key: "inventory.reorderPointRule", value: { percent: 65, applyToAllStocked: false }, reason: "Update opted-in parts" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT reorder_point,reorder_rule_mode,reorder_rule_percent FROM products WHERE id=?").get(follower.recordId) }, { reorder_point: 13, reorder_rule_mode: "global", reorder_rule_percent: 65 });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT reorder_point,reorder_rule_mode,reorder_rule_percent FROM products WHERE id=?").get(custom.recordId) }, { reorder_point: 8, reorder_rule_mode: "custom", reorder_rule_percent: 40 });
  assert.equal(db.sqlite.prepare("SELECT reorder_point FROM products WHERE id=?").get(manual.recordId).reorder_point, 3);

  await assert.rejects(advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "inventory.reorderPointRule", version: version(), idempotencyKey: "invalid-reorder-rule", actor: administrator, payload: { key: "inventory.reorderPointRule", value: { percent: 101, applyToAllStocked: false }, reason: "Invalid percentage" } }), (error) => error?.code === "VALIDATION_ERROR");
  await advancedDomain.executeWorkflow({ command: "updatePolicy", entityId: "inventory.reorderPointRule", version: version(), idempotencyKey: "apply-all-reorder-rule", actor: administrator, payload: { key: "inventory.reorderPointRule", value: { percent: 55, applyToAllStocked: true }, reason: "Standardize all stocked parts" } });
  for (const productId of [follower.recordId, custom.recordId, manual.recordId]) {
    assert.deepEqual({ ...db.sqlite.prepare("SELECT reorder_point,reorder_rule_mode,reorder_rule_percent FROM products WHERE id=?").get(productId) }, { reorder_point: 11, reorder_rule_mode: "global", reorder_rule_percent: 55 });
  }
  assert.equal((await inventoryDomain.getInventorySnapshot({ scope: "products", page: 1, pageSize: 5 })).configuration.reorderPointPercent, 55);
});
