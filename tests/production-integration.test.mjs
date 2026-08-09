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
});

test("production snapshots execute with bounded pagination on the migrated schema", async () => {
  const actor = { id: "viewer", email: "viewer@example.com", name: "Viewer", role: "viewer", label: "Viewer <viewer@example.com>", localDevelopment: false };
  const core = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 5 });
  const advanced = await advancedDomain.getAdvancedSnapshot(actor, { page: 1, pageSize: 5 });
  assert.deepEqual(core.pagination, { page: 1, pageSize: 5, totals: { purchaseOrders: 0, products: 0, salesOrders: 0, movements: 0, bills: 0, activities: 0, counts: 0 } });
  assert.deepEqual(advanced.pagination, { page: 1, pageSize: 5 });
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

test("one shipment consumes reservations split across locations", async () => {
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-b','B','B','storage','usable','wh-test',1,1)");
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('customer-a','CUST-A','Customer A','customer','CAD',1,1,'2026-08-01')");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('so-split','SO-SPLIT','customer-a','confirmed','not_invoiced','2026-08-10','CAD',1,1000,1000,1,'2026-08-01')");
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES ('sol-split','so-split','prod-a',5,0,200,'stock',0,1,0)");
  await run("UPDATE inventory_balances SET on_hand_qty=3,reserved_qty=3,version=version+1 WHERE product_id='prod-a' AND location_id='loc-a'");
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-a','loc-b',3,3,1)");
  await run("INSERT INTO reservations (id,sales_order_line_id,product_id,location_id,quantity,status,created_at) VALUES ('res-a','sol-split','prod-a','loc-a',3,'active','2026-08-01T00:00:00Z'),('res-b','sol-split','prod-a','loc-b',3,'active','2026-08-01T00:00:01Z')");
  await run("INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES ('prod-a','fifo',100,100,1,'2026-08-01','tester')");
  await run("INSERT INTO cost_layers (id,product_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) VALUES ('layer-a','prod-a',6,6,100,0,'2026-08-01','open')");
  await inventoryDomain.executeInventoryCommand({ command: "shipSale", entityId: "so-split", version: 1, idempotencyKey: "ship-split", payload: { lineId: "sol-split", quantity: 5, postingDate: "2026-08-01", actor: "Tester" } });
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
