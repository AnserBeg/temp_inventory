import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let inventoryDb;
let inventoryDomain;
let advancedDomain;
let auth;
let exportsModule;

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
  auth = await import("../lib/server/auth.ts");
  exportsModule = await import("../lib/server/exports.ts");
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

test("document numbers remain unique within the same clock tick", () => {
  const numbers = Array.from({ length: 5000 }, () => inventoryDb.documentNumber("SHP"));
  assert.equal(new Set(numbers).size, numbers.length);
  assert.ok(numbers.every((number) => /^SHP-\d{6}-[A-F0-9]{8}$/.test(number)));
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
  const created = await advancedDomain.executeWorkflow({ command: "createSalesOrderDraft", entityId: "new", version: 0, idempotencyKey: "create-addressed-draft", actor, payload: { customerId: "customer-draft", requestedDate: "2026-08-20", currency: "CAD", exchangeRateToBase: 1, paymentTerms: "Net 30", dueDate: "2026-09-19", shipToName: "Created Job Site", shipToAddressLine1: "21 Site Road", shipToCity: "Edmonton", shipToRegion: "AB", shipToPostalCode: "T5J 0N8", shipToCountry: "CA", lines: [{ kind: "item", productId: "prod-a", quantity: 1, unitPriceCents: 250, taxable: true, taxRateBps: 500 }] } });
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

test("customer contract prices override catalog defaults in server product search", async () => {
  const administrator = { id: "administrator", email: "admin@example.com", name: "Administrator", role: "administrator", label: "Administrator <admin@example.com>", localDevelopment: false };
  const list = await advancedDomain.executeWorkflow({ command: "createPriceList", idempotencyKey: "create-contract-list", actor: administrator, payload: { code: "CONTRACT-A", name: "Contract A", currency: "CAD", priority: 10 } });
  await advancedDomain.executeWorkflow({ command: "assignPriceList", idempotencyKey: "assign-contract-list", actor: administrator, payload: { priceListId: list.recordId, partnerId: "customer-draft", priority: 10 } });
  await advancedDomain.executeWorkflow({ command: "createPriceListEntry", idempotencyKey: "create-contract-entry", actor: administrator, payload: { priceListId: list.recordId, productId: "prod-a", uomId: "uom-each", minimumQuantity: 1, unitPriceCents: 123 } });
  const result = await inventoryDomain.searchInventoryReferences("products", "SKU-A", 20, "sales", "customer-draft", 2);
  const product = result.items.find((item) => item.id === "prod-a");
  assert.equal(product.effectiveUnitAmountCents, 123);
  assert.equal(product.priceSource, "Contract CONTRACT-A");
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
  await inventoryDomain.executeInventoryCommand({ command: "shipSale", entityId: "so-split", version: 1, idempotencyKey: "ship-split", payload: { lineId: "sol-split", quantity: 5, carrier: "Prairie Freight", serviceLevel: "LTL", billOfLadingNumber: "BOL-1001", postingDate: "2026-08-01", actor: "Tester" } });
  assert.deepEqual({ ...db.sqlite.prepare("SELECT carrier,service_level,bill_of_lading_number,ship_to_postal_code FROM shipments WHERE sales_order_id='so-split'").get() }, { carrier: "Prairie Freight", service_level: "LTL", bill_of_lading_number: "BOL-1001", ship_to_postal_code: "T5J 0N5" });
  const lines = db.sqlite.prepare("SELECT location_id,quantity FROM shipment_lines ORDER BY location_id").all().map((row) => ({ ...row }));
  assert.deepEqual(lines, [{ location_id: "loc-a", quantity: 3 }, { location_id: "loc-b", quantity: 2 }]);
  const balances = db.sqlite.prepare("SELECT location_id,on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-a' ORDER BY location_id").all().map((row) => ({ ...row }));
  assert.deepEqual(balances, [{ location_id: "loc-a", on_hand_qty: 0, reserved_qty: 0 }, { location_id: "loc-b", on_hand_qty: 1, reserved_qty: 1 }]);
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
