import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let advancedDomain;
let inventoryDomain;
const admin = { id: "merge-admin", email: "merge@example.com", name: "Merge Admin", role: "administrator", label: "Merge Admin <merge@example.com>", localDevelopment: false };

async function applyMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
  }
}

function run(sql, ...values) { return db.prepare(sql).bind(...values).run(); }
function row(sql, ...values) { return db.sqlite.prepare(sql).get(...values); }

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  env.BOOTSTRAP_DEMO_DATA = "false";
  advancedDomain = await import("../lib/server/advanced-domain.ts");
  inventoryDomain = await import("../lib/server/inventory-domain.ts");

  await run("INSERT INTO warehouses (id,code,name,timezone,active,version) VALUES ('merge-warehouse','MERGE-WH','Merge Warehouse','America/Edmonton',1,1)");
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('merge-bin','MERGE-BIN','Merge Bin','storage','usable','merge-warehouse',1,1)");
  await run(`INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES
    ('merge-vendor','MERGE-V','Surviving Vendor','vendor','CAD',1,1,'2026-09-01'),
    ('duplicate-vendor','DUP-V','Duplicate Vendor','vendor','CAD',1,1,'2026-09-01')`);
  await run(`INSERT INTO products (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES
    ('merge-product','KEEP-100',NULL,'Surviving Part','Test','Steel','1 in','Plain','quantity','stocked',100,200,0,0,'uom-each','uom-each','uom-each',1,1,'2026-09-01'),
    ('duplicate-product','OLD-100','MFG-OLD','Duplicate Part','Test','Steel','1 in','Plain','quantity','stocked',100,200,0,0,'uom-each','uom-each','uom-each',1,1,'2026-09-01')`);
  await run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('merge-product','merge-bin',3,1,1),('duplicate-product','merge-bin',2,1,1)");
  await run(`INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,posted_at,posted_by,idempotency_key) VALUES
    ('old-product-movement','purchase_receipt','duplicate-product',2,'merge-bin','usable','opening_balance','old-product','2026-09-01T00:00:00Z','Seeder','old-product-movement')`);
});

after(() => db.close());

test("product merge combines balances, preserves aliases, references history, and keeps immutable movements", async () => {
  await advancedDomain.executeWorkflow({ command: "setProductDefaultLocation", entityId: "duplicate-product", version: 1, idempotencyKey: "default-duplicate-bin", actor: admin, payload: { warehouseId: "merge-warehouse", locationId: "merge-bin" } });
  await advancedDomain.executeWorkflow({ command: "addProductAlias", entityId: "duplicate-product", version: 2, idempotencyKey: "add-duplicate-alias", actor: admin, payload: { alias: "Legacy blue widget" } });
  const result = await advancedDomain.executeWorkflow({ command: "mergeProducts", entityId: "merge-product", version: 1, idempotencyKey: "merge-products", actor: admin, payload: { sourceProductId: "duplicate-product" } });
  assert.match(result.message, /OLD-100 merged into KEEP-100/);
  assert.deepEqual({ ...row("SELECT on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='merge-product' AND location_id='merge-bin'") }, { on_hand_qty: 5, reserved_qty: 2 });
  assert.equal(row("SELECT active FROM products WHERE id='duplicate-product'").active, 0);
  assert.deepEqual(db.sqlite.prepare("SELECT alias FROM product_aliases WHERE product_id='merge-product' ORDER BY alias").all().map((item) => item.alias), ["Duplicate Part", "Legacy blue widget", "MFG-OLD", "OLD-100"]);
  assert.equal(row("SELECT product_id FROM stock_movements WHERE id='old-product-movement'").product_id, "duplicate-product");
  assert.equal(row("SELECT product_id FROM product_default_locations WHERE warehouse_id='merge-warehouse'").product_id, "merge-product");
  const detail = await inventoryDomain.getProductOperationalDetail("merge-product");
  assert.ok(detail.movements.some((movement) => movement.id === "old-product-movement"));
  const lookup = await inventoryDomain.searchInventoryReferences("products", "OLD-100");
  assert.equal(lookup.items[0].id, "merge-product");
  const retainedAlias = row("SELECT id FROM product_aliases WHERE product_id='merge-product' AND alias='OLD-100'");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "removeProductAlias", entityId: "merge-product", version: 2, idempotencyKey: "reject-retained-alias-removal", actor: admin, payload: { aliasId: retainedAlias.id } }), (error) => error?.code === "MERGED_ALIAS_REQUIRED");
});

test("receipt posting uses the product's preferred bin when the caller supplies only a warehouse", async () => {
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,revision_number,created_at) VALUES ('default-bin-po','PO-BIN','merge-vendor','approved','not_billed','2026-09-02','CAD',1,100,100,1,1,'2026-09-01')");
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,discount_cents,taxable,tax_code,tax_rate_bps,fulfillment_route,version) VALUES ('default-bin-line','default-bin-po','merge-product',1,0,100,'uom-each',1,100,0,0,'EXEMPT',0,'stock',1)");
  await inventoryDomain.executeInventoryCommand({ command: "postReceipt", entityId: "default-bin-po", version: 1, idempotencyKey: "receive-default-bin", payload: { lineId: "default-bin-line", quantity: 1, warehouseId: "merge-warehouse", postingDate: "2026-09-02", actor: "Receiver" } });
  assert.equal(row("SELECT to_location_id FROM stock_movements WHERE purchase_order_line_id='default-bin-line'").to_location_id, "merge-bin");
});

test("partner and draft purchase-order merges retain documents under the surviving records", async () => {
  await run(`INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,revision_number,created_at) VALUES
    ('keep-draft-po','PO-KEEP','merge-vendor','draft','not_billed','2026-09-10','CAD',1,100,100,1,1,'2026-09-01'),
    ('old-draft-po','PO-OLD','merge-vendor','draft','not_billed','2026-09-10','CAD',1,200,200,1,1,'2026-09-01'),
    ('duplicate-vendor-po','PO-DUP-V','duplicate-vendor','draft','not_billed','2026-09-10','CAD',1,100,100,1,1,'2026-09-01')`);
  await run(`INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,discount_cents,taxable,tax_code,tax_rate_bps,fulfillment_route,version) VALUES
    ('keep-draft-line','keep-draft-po','merge-product',1,0,100,0,0,'EXEMPT',0,'stock',1),
    ('old-draft-line','old-draft-po','merge-product',2,0,100,0,0,'EXEMPT',0,'stock',1),
    ('duplicate-vendor-line','duplicate-vendor-po','merge-product',1,0,100,0,0,'EXEMPT',0,'stock',1)`);
  await run(`INSERT INTO purchase_order_revisions (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_at,created_by) VALUES
    ('keep-draft-revision','keep-draft-po',1,'draft','{}','Created','2026-09-01','Seeder'),
    ('old-draft-revision','old-draft-po',1,'draft','{}','Created','2026-09-01','Seeder'),
    ('duplicate-vendor-revision','duplicate-vendor-po',1,'draft','{}','Created','2026-09-01','Seeder')`);
  await advancedDomain.executeWorkflow({ command: "mergePurchaseOrders", entityId: "keep-draft-po", version: 1, idempotencyKey: "merge-draft-pos", actor: admin, payload: { sourcePurchaseOrderId: "old-draft-po" } });
  assert.equal(row("SELECT COUNT(*) AS count FROM purchase_order_lines WHERE purchase_order_id='keep-draft-po'").count, 2);
  assert.deepEqual({ ...row("SELECT lifecycle_status,total_cents FROM purchase_orders WHERE id='old-draft-po'") }, { lifecycle_status: "canceled", total_cents: 0 });
  assert.equal(row("SELECT total_cents FROM purchase_orders WHERE id='keep-draft-po'").total_cents, 300);

  await advancedDomain.executeWorkflow({ command: "mergeBusinessPartners", entityId: "merge-vendor", version: 1, idempotencyKey: "merge-vendors", actor: admin, payload: { sourcePartnerId: "duplicate-vendor" } });
  assert.equal(row("SELECT active FROM business_partners WHERE id='duplicate-vendor'").active, 0);
  assert.equal(row("SELECT vendor_id FROM purchase_orders WHERE id='duplicate-vendor-po'").vendor_id, "merge-vendor");
  const lookup = await inventoryDomain.searchInventoryReferences("partners", "DUP-V");
  assert.equal(lookup.items[0].id, "merge-vendor");
});

test("submitted purchase orders cannot be merged", async () => {
  await run("UPDATE purchase_orders SET lifecycle_status='approved' WHERE id='duplicate-vendor-po'");
  await assert.rejects(advancedDomain.executeWorkflow({ command: "mergePurchaseOrders", entityId: "keep-draft-po", version: 2, idempotencyKey: "reject-approved-merge", actor: admin, payload: { sourcePurchaseOrderId: "duplicate-vendor-po" } }), (error) => error?.code === "INVALID_STATE");
});
