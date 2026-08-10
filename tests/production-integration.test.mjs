import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let inventoryDb;
let inventoryDomain;
let advancedDomain;
let outboxModule;
let auth;
let exportsModule;
let reportsModule;

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
  await assert.rejects(run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('missing-product','missing-location',1,0,1)"), /FOREIGN KEY constraint failed/);
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
  assert.deepEqual(core.pagination, { page: 1, pageSize: 5, filteredTotal: null, totals: { purchaseOrders: 0, products: 0, partners: 0, salesOrders: 0, movements: 0, bills: 0, activities: 0, counts: 0 } });
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
    (error) => error?.code === "VALIDATION_ERROR" && /locationId is required/.test(error.message),
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

  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-fraction-target','FRACTION','Fraction target','storage','usable','wh-test',1,1)");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "transferInventory", entityId: "prod-a", idempotencyKey: "reject-quarter-unit", actor: administrator, payload: { fromLocationId: "loc-a", toLocationId: "loc-fraction-target", quantity: 0.25, reason: "Must reject fractions", postingDate: "2026-08-01" } }), (error) => ["INVALID_QUANTITY_PRECISION", "DISCRETE_QUANTITY_REQUIRED"].includes(error?.code));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM command_log WHERE idempotency_key='reject-quarter-unit'").get().count, 0);
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
  assert.deepEqual(db.sqlite.prepare("SELECT product_id,ordered_qty,unit_price_cents FROM sales_order_lines WHERE sales_order_id='so-draft' ORDER BY product_id").all().map((row) => ({ ...row })), [
    { product_id: "prod-a", ordered_qty: 2, unit_price_cents: 250 },
    { product_id: "prod-b", ordered_qty: 1, unit_price_cents: 300 },
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
  assert.deepEqual({ ...db.sqlite.prepare("SELECT discount_cents,taxable,tax_rate_bps FROM purchase_order_lines WHERE purchase_order_id=?").get(created.recordId) }, { discount_cents: 100, taxable: 1, tax_rate_bps: 500 });

  await advancedDomain.executeWorkflow({ command: "updatePurchaseOrderDraft", entityId: created.recordId, version: 1, idempotencyKey: "update-priced-po-draft", actor, payload: {
    vendorId: "vendor-receipt", expectedDate: "2026-08-25", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 15", dueDate: "2026-09-09",
    lines: [
      { kind: "item", productId: "prod-a", quantity: 3, unitCostCents: 1000, discountCents: 150, taxable: true, taxCode: "GST", taxRateBps: 500 },
      { kind: "charge", chargeType: "fee", description: "Handling", amountCents: 300, taxable: true, taxCode: "GST", taxRateBps: 500 },
    ],
  } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT total_cents,payment_terms,version FROM purchase_orders WHERE id=?").get(created.recordId) }, { total_cents: 3308, payment_terms: "Net 15", version: 2 });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT discount_cents,taxable,tax_rate_bps FROM purchase_order_lines WHERE purchase_order_id=?").get(created.recordId) }, { discount_cents: 150, taxable: 1, tax_rate_bps: 500 });
  assert.deepEqual(db.sqlite.prepare("SELECT charge_type,amount_cents,tax_amount_cents FROM document_charges WHERE document_type='purchase_order' AND document_id=?").all(created.recordId).map((row) => ({ ...row })), [{ charge_type: "fee", amount_cents: 300, tax_amount_cents: 15 }]);

  const snapshot = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: created.number, page: 1, pageSize: 10 });
  assert.equal(snapshot.purchaseOrders[0].lines[0].discountCents, 150);
  assert.equal(snapshot.purchaseOrders[0].lines[0].taxable, 1);
  assert.equal(snapshot.purchaseOrders[0].lines[0].taxRateBps, 500);
});

test("dedicated supply links are unique, editable by their owner, and claimed atomically", async () => {
  const actor = { id: "operator", email: "operator@example.com", name: "Operator", role: "operator", label: "Operator <operator@example.com>", localDevelopment: false };
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-supply-link','SO-SUPPLY-LINK','customer-draft','draft','not_invoiced','2026-08-25','CAD',1,600,600,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-supply-link','so-supply-link','prod-a',2,0,200,'special_order',0,0,0),('sol-supply-duplicate','so-supply-link','prod-a',1,0,200,'special_order',0,0,0),('sol-supply-atomic','so-supply-link','prod-a',1,0,200,'special_order',0,0,0)");
  const basePayload = { vendorId: "vendor-receipt", expectedDate: "2026-08-30", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-09-29" };
  const linked = await advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "create-linked-supply-po", actor, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 2, unitCostCents: 100, taxable: false, taxRateBps: 0, fulfillmentRoute: "special_order", sourceSalesOrderLineId: "sol-supply-link" }] } });
  const originalLine = db.sqlite.prepare("SELECT id FROM purchase_order_lines WHERE purchase_order_id=?").get(linked.recordId).id;
  assert.equal(db.sqlite.prepare("SELECT linked_purchase_order_line_id FROM sales_order_lines WHERE id='sol-supply-link'").get().linked_purchase_order_line_id, originalLine);
  assert.equal((await inventoryDomain.searchInventoryReferences("salesOrderLines", "SO-SUPPLY-LINK", 20, "special_order")).items.some((item) => item.id === "sol-supply-link"), false);
  assert.equal((await inventoryDomain.searchInventoryReferences("salesOrderLines", "SO-SUPPLY-LINK", 20, "special_order", linked.recordId)).items.some((item) => item.id === "sol-supply-link"), true);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "updateSalesOrderDraft", entityId: "so-supply-link", version: 1, idempotencyKey: "reject-demand-replacement-with-supply", actor, payload: {} }), (error) => error?.code === "SUPPLY_COMMITMENT_EXISTS");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "cancelSalesOrder", entityId: "so-supply-link", version: 1, idempotencyKey: "reject-demand-cancel-with-supply", actor, payload: { reason: "Customer changed scope" } }), (error) => error?.code === "SUPPLY_COMMITMENT_EXISTS");

  await assert.rejects(advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "reject-reused-supply-link", actor, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 2, unitCostCents: 100, fulfillmentRoute: "special_order", sourceSalesOrderLineId: "sol-supply-link" }] } }), (error) => error?.code === "SUPPLY_LINK_IN_USE");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "reject-duplicate-supply-link", actor, payload: { ...basePayload, lines: [
    { kind: "item", productId: "prod-a", quantity: 1, unitCostCents: 100, fulfillmentRoute: "special_order", sourceSalesOrderLineId: "sol-supply-duplicate" },
    { kind: "item", productId: "prod-a", quantity: 1, unitCostCents: 100, fulfillmentRoute: "special_order", sourceSalesOrderLineId: "sol-supply-duplicate" },
  ] } }), (error) => error?.code === "DUPLICATE_SUPPLY_LINK");

  await advancedDomain.executeWorkflow({ command: "updatePurchaseOrderDraft", entityId: linked.recordId, version: 1, idempotencyKey: "retain-owned-supply-link", actor, payload: { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 3, unitCostCents: 110, fulfillmentRoute: "special_order", sourceSalesOrderLineId: "sol-supply-link" }] } });
  const replacementLine = db.sqlite.prepare("SELECT id FROM purchase_order_lines WHERE purchase_order_id=?").get(linked.recordId).id;
  assert.notEqual(replacementLine, originalLine);
  assert.equal(db.sqlite.prepare("SELECT linked_purchase_order_line_id FROM sales_order_lines WHERE id='sol-supply-link'").get().linked_purchase_order_line_id, replacementLine);

  const concurrentPayload = { ...basePayload, lines: [{ kind: "item", productId: "prod-a", quantity: 1, unitCostCents: 100, fulfillmentRoute: "special_order", sourceSalesOrderLineId: "sol-supply-atomic" }] };
  const attempts = await Promise.allSettled([
    advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "atomic-supply-link-a", actor, payload: concurrentPayload }),
    advancedDomain.executeWorkflow({ command: "createPurchaseOrderDraft", entityId: "new", version: 0, idempotencyKey: "atomic-supply-link-b", actor, payload: concurrentPayload }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected" && ["CREATE_CONFLICT", "SUPPLY_LINK_IN_USE"].includes(attempt.reason?.code)).length, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM purchase_order_lines WHERE source_sales_order_line_id='sol-supply-atomic'").get().count, 1);

  await advancedDomain.executeWorkflow({ command: "cancelPurchaseOrder", entityId: linked.recordId, version: 2, idempotencyKey: "cancel-linked-supply-po", actor, payload: { reason: "Customer demand was revised before commitment" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT lifecycle_status,version FROM purchase_orders WHERE id=?").get(linked.recordId) }, { lifecycle_status: "canceled", version: 3 });
  assert.equal(db.sqlite.prepare("SELECT linked_purchase_order_line_id FROM sales_order_lines WHERE id='sol-supply-link'").get().linked_purchase_order_line_id, null);
  await assert.rejects(advancedDomain.executeWorkflow({ command: "cancelPurchaseOrder", entityId: "po-batch", version: 4, idempotencyKey: "reject-cancel-po-with-receipt-history", actor, payload: { reason: "Cannot erase receipt history" } }), (error) => error?.code === "RECEIPT_HISTORY_EXISTS");
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
  assert.equal(usdPurchasing.items.find((item) => item.id === "prod-a").priceSource, "Catalog standard cost");
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
  const lines = db.sqlite.prepare("SELECT location_id,quantity FROM shipment_lines ORDER BY location_id").all().map((row) => ({ ...row }));
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

test("inventory exports block orphaned locations until the original location ID is restored", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  await run("INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,posted_at,posted_by,idempotency_key) VALUES ('movement-orphan','legacy_adjustment','prod-a',-1,'loc-restored-legacy','usable','legacy_import','legacy-1','2026-08-01T00:00:00Z','Legacy import','legacy-orphan')");
  await assert.rejects(exportsModule.buildExport("inventory", administrator), /Export blocked:.*loc-restored-legacy/);
  await advancedDomain.executeWorkflow({ command: "restoreLegacyLocation", entityId: "loc-restored-legacy", idempotencyKey: "restore-orphan-location", actor: administrator, payload: { warehouseId: "wh-test", code: "LEGACY-A", name: "Restored legacy A", inventoryStatus: "usable", locationType: "storage" } });
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
