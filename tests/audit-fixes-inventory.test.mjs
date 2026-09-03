import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

/**
 * Server-side regression coverage for the inventory audit findings. Each test builds its own
 * rows (prefixed AUD) so the fixes are exercised against the real migration chain rather than
 * hand-written tables.
 */
const db = new D1SqliteDatabase();
let inventoryDb;
let inventoryDomain;

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
const get = (sql, ...values) => db.sqlite.prepare(sql).get(...values);
const rows = (sql, ...values) => db.sqlite.prepare(sql).all(...values);
const placeholders = (sql) => (sql.match(/\?/g) ?? []).length;
const command = (input) => inventoryDomain.executeInventoryCommand(input);
const poVersion = (id) => get("SELECT version FROM purchase_orders WHERE id=?", id).version;

const PRODUCT_COLUMNS = "(id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)";
function product(id, sku, { tracking = "quantity", policy = "stocked", cost = 100, uom = "uom-each" } = {}) {
  return run(`INSERT INTO products ${PRODUCT_COLUMNS} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, sku, `${sku} product`, "audit", "test", "test", "test", tracking, policy, cost, cost * 2, 0, uom, uom, uom, 1, 1, "2026-08-01");
}
function purchaseOrder(id, number, lines, { expected = "2026-08-10", currency = "CAD" } = {}) {
  run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES (?,?,?,'approved','not_billed',?,?,1,1000,1000,1,'2026-08-01')", id, number, "vendor-audit", expected, currency);
  for (const [lineId, productId, quantity, cost, closed = 0] of lines) {
    run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,fulfillment_route,version) VALUES (?,?,?,?,?,?,'stock',1)", lineId, id, productId, quantity, closed, cost);
  }
}
function salesOrder(id, number, customerId, lines, { requested = "2026-08-20" } = {}) {
  run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at,ship_to_name,ship_to_address_line_1,ship_to_city,ship_to_region,ship_to_postal_code,ship_to_country) VALUES (?,?,?,'confirmed','not_invoiced',?,'CAD',1,1000,1000,1,'2026-08-01','Audit Customer','1 Audit Way','Edmonton','AB','T5J 0N3','CA')", id, number, customerId, requested);
  for (const [lineId, productId, quantity, price] of lines) {
    run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents,fulfillment_route,discount_cents,taxable,tax_rate_bps) VALUES (?,?,?,?,0,?,'stock',0,0,0)", lineId, id, productId, quantity, price);
  }
}
function receipt(poId, lineId, quantity, extra = {}, key = `${poId}-${lineId}-${quantity}-${JSON.stringify(extra)}`) {
  return command({ command: "postReceipt", entityId: poId, version: poVersion(poId), idempotencyKey: `receipt-${key}`, payload: { lineId, quantity, locationId: "loc-aud-usable", postingDate: "2026-08-01", actor: "Tester", ...extra } });
}

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  env.BOOTSTRAP_DEMO_DATA = "false";
  inventoryDb = await import("../lib/server/inventory-db.ts");
  inventoryDomain = await import("../lib/server/inventory-domain.ts");
  await inventoryDb.ensureDatabase();
  run("INSERT OR IGNORE INTO units_of_measure (id,code,name,dimension,precision,active) VALUES ('uom-each','EA','Each','quantity',0,1)");
  run("INSERT INTO units_of_measure (id,code,name,dimension,precision,active) VALUES ('uom-aud-kg','KG3','Kilogram (3dp)','quantity',3,1)");
  run("INSERT INTO warehouses (id,code,name,timezone,active,version) VALUES ('wh-aud','AUD','Audit warehouse','America/Edmonton',1,1)");
  for (const [id, code, type, status] of [
    ["loc-aud-usable", "AUD-A1", "storage", "usable"], ["loc-aud-usable-2", "AUD-A2", "storage", "usable"],
    ["loc-aud-quarantine", "AUD-QA", "quarantine", "quarantine"], ["loc-aud-damaged", "AUD-DMG", "storage", "damaged"],
    ["loc-aud-transit", "AUD-TRANSIT", "in_transit", "in_transit"], ["loc-aud-frac", "AUD-FRAC", "storage", "usable"],
  ]) run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES (?,?,?,?,?,'wh-aud',1,1)", id, code, `${code} bin`, type, status);
  run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('vendor-audit','AUD-V','Audit Vendor','vendor','CAD',1,1,'2026-08-01')");
  for (const [id, code, name, hold, limit] of [["customer-audit", "AUD-C", "Audit Customer", 0, 0], ["customer-aud-hold", "AUD-HOLD", "Held Customer", 1, 0], ["customer-aud-limit", "AUD-LIMIT", "Limited Customer", 0, 1000]]) {
    run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,currency,credit_hold,credit_limit_cents,payment_terms,active,version,created_at) VALUES (?,?,?,'customer','1 Audit Way','Edmonton','AB','T5J 0N3','CA','CAD',?,?,'Net 30',1,1,'2026-08-01')", id, code, name, hold, limit);
  }
  run("INSERT INTO partner_addresses (id,partner_id,label,contact_name,address_line_1,address_line_2,city,region,postal_code,country,delivery_instructions,is_default,active,version,created_at,updated_at) VALUES ('addr-aud-1','customer-audit','Main site','Pat','100 Main Street',NULL,'Edmonton','AB','T5J 0N3','CA',NULL,1,1,1,'2026-08-01','2026-08-01')");
});

after(() => db.close());

test("#1 snapshot child queries bind page ids as one JSON parameter and stay under D1's 100-variable cap", async () => {
  for (let index = 0; index < 120; index += 1) {
    const suffix = String(index).padStart(4, "0");
    product(`prod-aud-param-${suffix}`, `AUD-PARAM-${suffix}`);
    run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES (?,?,?,0,1)", `prod-aud-param-${suffix}`, "loc-aud-usable", 1);
    purchaseOrder(`po-aud-param-${suffix}`, `PO-AUD-PARAM-${suffix}`, [[`pol-aud-param-${suffix}`, `prod-aud-param-${suffix}`, 10, 100]], { expected: "2026-08-15" });
    salesOrder(`so-aud-param-${suffix}`, `SO-AUD-PARAM-${suffix}`, "customer-audit", [[`sol-aud-param-${suffix}`, `prod-aud-param-${suffix}`, 1, 200]]);
  }
  const marker = db.preparedSql.length;
  const products = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 100, scope: "products", search: "AUD-PARAM" });
  const purchases = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 100, scope: "purchase-orders", search: "PO-AUD-PARAM" });
  const sales = await inventoryDomain.getInventorySnapshot({ page: 1, pageSize: 100, scope: "sales-orders", search: "SO-AUD-PARAM" });
  const issued = db.preparedSql.slice(marker);
  assert.equal(products.products.length, 100);
  assert.equal(products.inventoryBalances.length, 100);
  assert.equal(purchases.purchaseOrders.length, 100);
  assert.ok(purchases.purchaseOrders.every((order) => order.lines.length === 1), "every purchase order on the page carries its line");
  assert.equal(sales.salesOrders.length, 100);
  assert.ok(sales.salesOrders.every((order) => order.lines.length === 1), "every sales order on the page carries its line");
  const widest = Math.max(...issued.map(placeholders));
  assert.ok(widest <= 100, `a snapshot statement bound ${widest} parameters; Cloudflare D1 rejects more than 100`);
  assert.ok(issued.some((sql) => sql.includes("IN (SELECT value FROM json_each(?))")), "child queries use a JSON id list");
  assert.ok(!issued.some((sql) => /IN \(\?,\?/.test(sql)), "no statement builds a repeated-placeholder IN list");
});

test("#2 the saved-address lookup accepts a search term", async () => {
  const found = await inventoryDomain.searchInventoryReferences("partnerAddresses", "Main", 10, undefined, "customer-audit");
  assert.deepEqual(found.items.map((item) => item.label), ["Main site"]);
  const byCity = await inventoryDomain.searchInventoryReferences("partnerAddresses", "edmon", 10, undefined, "customer-audit");
  assert.equal(byCity.items.length, 1);
  assert.equal((await inventoryDomain.searchInventoryReferences("partnerAddresses", "nowhere", 10, undefined, "customer-audit")).items.length, 0);
});

test("#33 a receipt without lineId resolves a single-line order and refuses a multi-line one before numbering", async () => {
  product("prod-aud-line", "AUD-LINE");
  purchaseOrder("po-aud-single", "PO-AUD-SINGLE", [["pol-aud-single", "prod-aud-line", 4, 100]]);
  purchaseOrder("po-aud-multi", "PO-AUD-MULTI", [["pol-aud-multi-a", "prod-aud-line", 4, 100], ["pol-aud-multi-b", "prod-aud-line", 4, 100]]);
  const sequenceBefore = get("SELECT next_value FROM document_sequences WHERE prefix='RCV'")?.next_value ?? 0;
  await assert.rejects(command({ command: "postReceipt", entityId: "po-aud-multi", version: 1, idempotencyKey: "aud-multi-no-line", payload: { quantity: 1, locationId: "loc-aud-usable", postingDate: "2026-08-01", actor: "Tester" } }), (error) => error?.code === "LINE_REQUIRED");
  assert.equal(get("SELECT next_value FROM document_sequences WHERE prefix='RCV'")?.next_value ?? 0, sequenceBefore, "no receipt number is consumed by a refused receipt");
  assert.equal(get("SELECT COUNT(*) AS count FROM command_log WHERE idempotency_key='aud-multi-no-line'").count, 0);
  const posted = await command({ command: "postReceipt", entityId: "po-aud-single", version: 1, idempotencyKey: "aud-single-no-line", payload: { quantity: 1, locationId: "loc-aud-usable", postingDate: "2026-08-01", actor: "Tester" } });
  assert.match(posted.message, /^RCV-\d+ posted/);
  assert.equal(get("SELECT COUNT(*) AS count FROM receipts WHERE purchase_order_id='po-aud-single'").count, 1);
});

test("#5/#6 movements resolve and search by document number and related order for receipts, reversals, and vendor returns", async () => {
  product("prod-aud-move", "AUD-MOVE");
  purchaseOrder("po-aud-move", "PO-AUD-MOVE", [["pol-aud-move", "prod-aud-move", 5, 100]]);
  const posted = await receipt("po-aud-move", "pol-aud-move", 5);
  const receiptNumber = posted.message.split(" ")[0];
  const byReceipt = await inventoryDomain.getInventorySnapshot({ scope: "movements", search: receiptNumber, page: 1, pageSize: 20 });
  assert.equal(byReceipt.movements.length, 1);
  assert.deepEqual({ document: byReceipt.movements[0].sourceDocumentNumber, order: byReceipt.movements[0].relatedOrderNumber, kind: byReceipt.movements[0].relatedOrderKind }, { document: receiptNumber, order: "PO-AUD-MOVE", kind: "purchase" });
  assert.equal(byReceipt.pagination.filteredTotal, 1);
  const byOrder = await inventoryDomain.getInventorySnapshot({ scope: "movements", search: "PO-AUD-MOVE", page: 1, pageSize: 20 });
  assert.equal(byOrder.movements.length, 1);
  assert.equal(byOrder.pagination.filteredTotal, 1);

  const receiptRow = get("SELECT id,version FROM receipts WHERE purchase_order_id='po-aud-move'");
  await command({ command: "reverseReceipt", entityId: receiptRow.id, version: receiptRow.version, idempotencyKey: "aud-move-reverse", payload: { lineId: "pol-aud-move", quantity: 1, disposition: "reopen", reason: "Keyed one too many", postingDate: "2026-08-02", actor: "Tester" } });
  await command({ command: "postVendorReturn", entityId: "po-aud-move", version: poVersion("po-aud-move"), idempotencyKey: "aud-move-vendor-return", payload: { lineId: "pol-aud-move", quantity: 1, locationId: "loc-aud-usable", disposition: "refund", reason: "Wrong colour", postingDate: "2026-08-03", actor: "Tester" } });
  const afterCorrections = await inventoryDomain.getInventorySnapshot({ scope: "movements", search: "PO-AUD-MOVE", page: 1, pageSize: 20 });
  assert.equal(afterCorrections.movements.length, 3);
  assert.equal(afterCorrections.pagination.filteredTotal, 3);
  const reversal = afterCorrections.movements.find((movement) => movement.type === "receipt_reversal");
  assert.deepEqual({ document: reversal.sourceDocumentNumber, order: reversal.relatedOrderNumber }, { document: receiptNumber, order: "PO-AUD-MOVE" });
  const vendorReturn = afterCorrections.movements.find((movement) => movement.type === "vendor_return");
  const returnNumber = get("SELECT number FROM vendor_returns WHERE purchase_order_id='po-aud-move'").number;
  assert.deepEqual({ document: vendorReturn.sourceDocumentNumber, order: vendorReturn.relatedOrderNumber }, { document: returnNumber, order: "PO-AUD-MOVE" });
  assert.equal((await inventoryDomain.getInventorySnapshot({ scope: "movements", search: returnNumber, page: 1, pageSize: 20 })).movements.length, 1);
});

test("#13 vendor returns leave from quarantine and damaged bins and stamp the movement with that status; role=stocked lists those bins", async () => {
  product("prod-aud-vrt", "AUD-VRT");
  purchaseOrder("po-aud-vrt", "PO-AUD-VRT", [["pol-aud-vrt", "prod-aud-vrt", 5, 100]]);
  await receipt("po-aud-vrt", "pol-aud-vrt", 5, { damagedQuantity: 2, quarantineLocationId: "loc-aud-quarantine" });
  assert.equal(get("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-aud-vrt' AND location_id='loc-aud-quarantine'").on_hand_qty, 2);
  const stocked = await inventoryDomain.searchInventoryReferences("locations", "AUD-", 50, "stocked", undefined, 1, "wh-aud", undefined, undefined, 0, "prod-aud-vrt");
  assert.deepEqual(stocked.items.map((item) => item.code).sort(), ["AUD-A1", "AUD-QA"], "with a product, only bins holding its stock are listed; in-transit is never listed");
  const stockedAll = await inventoryDomain.searchInventoryReferences("locations", "AUD-", 50, "stocked", undefined, 1, "wh-aud");
  assert.ok(["AUD-A1", "AUD-A2", "AUD-QA", "AUD-DMG", "AUD-FRAC"].every((code) => stockedAll.items.some((item) => item.code === code)));
  assert.ok(!stockedAll.items.some((item) => item.code === "AUD-TRANSIT"));

  const returned = await command({ command: "postVendorReturn", entityId: "po-aud-vrt", version: poVersion("po-aud-vrt"), idempotencyKey: "aud-vrt-from-quarantine", payload: { lineId: "pol-aud-vrt", quantity: 2, locationId: "loc-aud-quarantine", disposition: "refund", reason: "Arrived damaged", postingDate: "2026-08-02", actor: "Tester" } });
  assert.match(returned.impact.physical, /quarantine on-hand inventory at AUD-QA/);
  assert.equal(get("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-aud-vrt' AND location_id='loc-aud-quarantine'").on_hand_qty, 0);
  assert.equal(get("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-aud-vrt' AND location_id='loc-aud-usable'").on_hand_qty, 3);
  assert.deepEqual({ ...get("SELECT inventory_status,from_location_id FROM stock_movements WHERE movement_type='vendor_return' AND product_id='prod-aud-vrt'") }, { inventory_status: "quarantine", from_location_id: "loc-aud-quarantine" });
  await assert.rejects(command({ command: "postVendorReturn", entityId: "po-aud-vrt", version: poVersion("po-aud-vrt"), idempotencyKey: "aud-vrt-from-transit", payload: { lineId: "pol-aud-vrt", quantity: 1, locationId: "loc-aud-transit", disposition: "refund", reason: "Not allowed", postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "LOCATION_STATUS_MISMATCH");
});

test("#14 a reservation without a location spreads across usable bins and fails only when the product cannot cover it", async () => {
  product("prod-aud-spread", "AUD-SPREAD");
  run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-aud-spread','loc-aud-usable',3,0,1),('prod-aud-spread','loc-aud-usable-2',2,0,1),('prod-aud-spread','loc-aud-quarantine',5,0,1)");
  salesOrder("so-aud-spread", "SO-AUD-SPREAD", "customer-audit", [["sol-aud-spread", "prod-aud-spread", 5, 200], ["sol-aud-spread-more", "prod-aud-spread", 1, 200]]);
  await assert.rejects(command({ command: "reserveSale", entityId: "so-aud-spread", version: 1, idempotencyKey: "aud-spread-one-bin", payload: { lineId: "sol-aud-spread", quantity: 5, locationId: "loc-aud-usable", actor: "Tester" } }), (error) => error?.code === "INSUFFICIENT_AVAILABILITY");
  const reserved = await command({ command: "reserveSale", entityId: "so-aud-spread", version: 1, idempotencyKey: "aud-spread-product-wide", payload: { lineId: "sol-aud-spread", quantity: 5, actor: "Tester" } });
  assert.match(reserved.message, /reserved for this sales order across 2 locations/);
  assert.deepEqual(rows("SELECT location_id,quantity FROM reservations WHERE sales_order_line_id='sol-aud-spread' AND status='active' ORDER BY location_id").map((row) => ({ ...row })), [{ location_id: "loc-aud-usable", quantity: 3 }, { location_id: "loc-aud-usable-2", quantity: 2 }]);
  assert.deepEqual(rows("SELECT location_id,reserved_qty FROM inventory_balances WHERE product_id='prod-aud-spread' ORDER BY location_id").map((row) => ({ ...row })), [{ location_id: "loc-aud-quarantine", reserved_qty: 0 }, { location_id: "loc-aud-usable", reserved_qty: 3 }, { location_id: "loc-aud-usable-2", reserved_qty: 2 }]);
  await assert.rejects(command({ command: "reserveSale", entityId: "so-aud-spread", version: 2, idempotencyKey: "aud-spread-exhausted", payload: { lineId: "sol-aud-spread-more", quantity: 1, actor: "Tester" } }), (error) => error?.code === "INSUFFICIENT_AVAILABILITY" && /Only 0 of 1 units/.test(error.message));
  assert.equal(get("SELECT COUNT(*) AS count FROM command_log WHERE idempotency_key='aud-spread-exhausted'").count, 0);
});

test("#30 two reservations in one bin ship as one tracked pick", async () => {
  product("prod-aud-lot", "AUD-LOT", { tracking: "lot" });
  purchaseOrder("po-aud-lot", "PO-AUD-LOT", [["pol-aud-lot", "prod-aud-lot", 4, 100]]);
  await receipt("po-aud-lot", "pol-aud-lot", 4, { lotNumber: "AUD-LOT-1" });
  const lotId = get("SELECT id FROM inventory_lots WHERE product_id='prod-aud-lot'").id;
  salesOrder("so-aud-lot", "SO-AUD-LOT", "customer-audit", [["sol-aud-lot", "prod-aud-lot", 4, 200]]);
  await command({ command: "reserveSale", entityId: "so-aud-lot", version: 1, idempotencyKey: "aud-lot-reserve-1", payload: { lineId: "sol-aud-lot", quantity: 2, locationId: "loc-aud-usable", actor: "Tester" } });
  await command({ command: "reserveSale", entityId: "so-aud-lot", version: 2, idempotencyKey: "aud-lot-reserve-2", payload: { lineId: "sol-aud-lot", quantity: 2, locationId: "loc-aud-usable", actor: "Tester" } });
  assert.equal(get("SELECT COUNT(*) AS count FROM reservations WHERE sales_order_line_id='sol-aud-lot' AND status='active'").count, 2);
  await command({ command: "shipSale", entityId: "so-aud-lot", version: 3, idempotencyKey: "aud-lot-ship", payload: { lineId: "sol-aud-lot", quantity: 4, lotId, carrier: "Audit Freight", trackingNumber: "AUD-LOT-TRACK", postingDate: "2026-08-02", actor: "Tester" } });
  assert.deepEqual(rows("SELECT sl.location_id,sl.quantity FROM shipment_lines sl JOIN shipments sh ON sh.id=sl.shipment_id WHERE sh.sales_order_id='so-aud-lot'").map((row) => ({ ...row })), [{ location_id: "loc-aud-usable", quantity: 4 }]);
  assert.deepEqual(rows("SELECT status FROM reservations WHERE sales_order_line_id='sol-aud-lot'").map((row) => row.status), ["consumed", "consumed"]);
  assert.deepEqual({ ...get("SELECT on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-aud-lot' AND location_id='loc-aud-usable'") }, { on_hand_qty: 0, reserved_qty: 0 });
});

test("#15 a receipt whose cost layer FIFO already spent is still reversible, funded from other layers with a cost variance", async () => {
  product("prod-aud-fifo", "AUD-FIFO");
  purchaseOrder("po-aud-fifo-a", "PO-AUD-FIFO-A", [["pol-aud-fifo-a", "prod-aud-fifo", 5, 100]]);
  purchaseOrder("po-aud-fifo-b", "PO-AUD-FIFO-B", [["pol-aud-fifo-b", "prod-aud-fifo", 5, 150]]);
  await receipt("po-aud-fifo-a", "pol-aud-fifo-a", 5, { postingDate: "2026-08-01" });
  await receipt("po-aud-fifo-b", "pol-aud-fifo-b", 5, { locationId: "loc-aud-usable-2", postingDate: "2026-08-02" });
  salesOrder("so-aud-fifo", "SO-AUD-FIFO", "customer-audit", [["sol-aud-fifo", "prod-aud-fifo", 5, 400]]);
  // Sold physically from bin A2, but FIFO charges receipt A's layer (the older, cheaper one).
  await command({ command: "postImmediateSale", entityId: "so-aud-fifo", version: 1, idempotencyKey: "aud-fifo-sale", payload: { lineId: "sol-aud-fifo", quantity: 5, locationId: "loc-aud-usable-2", postingDate: "2026-08-03", actor: "Tester" } });
  const layerA = get("SELECT cl.remaining_qty FROM cost_layers cl JOIN stock_movements sm ON sm.id=cl.receipt_movement_id WHERE sm.purchase_order_line_id='pol-aud-fifo-a'");
  assert.equal(layerA.remaining_qty, 0, "the sale consumed receipt A's layer");
  const advertised = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: "PO-AUD-FIFO-A", page: 1, pageSize: 10 });
  assert.equal(advertised.purchaseOrders[0].lines[0].latestReceiptReversibleQuantity, 5, "physically on hand, so reversible regardless of the layer");

  const receiptA = get("SELECT id,version FROM receipts WHERE purchase_order_id='po-aud-fifo-a'");
  const reversed = await command({ command: "reverseReceipt", entityId: receiptA.id, version: receiptA.version, idempotencyKey: "aud-fifo-reverse", payload: { lineId: "pol-aud-fifo-a", quantity: 5, disposition: "close", reason: "Receipt keyed against the wrong PO", postingDate: "2026-08-04", actor: "Tester" } });
  assert.match(reversed.impact.financial, /750 cents \(500 cents at the original receipt cost/);
  assert.equal(get("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-aud-fifo' AND location_id='loc-aud-usable'").on_hand_qty, 0);
  assert.equal(get("SELECT COALESCE(SUM(remaining_qty),0) AS remaining FROM cost_layers WHERE product_id='prod-aud-fifo'").remaining, 0, "receipt B's layer funded the reversal");
  const entries = rows("SELECT entry_type,quantity,value_cents FROM inventory_value_entries WHERE product_id='prod-aud-fifo' ORDER BY posted_at,entry_type").map((row) => ({ ...row }));
  assert.deepEqual(entries.filter((entry) => entry.entry_type === "receipt_reversal"), [{ entry_type: "receipt_reversal", quantity: -5, value_cents: -500 }]);
  assert.deepEqual(entries.filter((entry) => entry.entry_type === "cost_variance"), [{ entry_type: "cost_variance", quantity: 0, value_cents: -250 }]);
  assert.equal(get("SELECT COALESCE(SUM(value_cents),0) AS value FROM inventory_value_entries WHERE product_id='prod-aud-fifo'").value, 0, "no stock left, so no inventory value left");
  assert.equal(get("SELECT COALESCE(SUM(quantity),0) AS quantity FROM inventory_value_entries WHERE product_id='prod-aud-fifo'").quantity, 0);
});

test("#31 split receipts advertise per-status reversible quantities and can be reversed by status or receipt line", async () => {
  product("prod-aud-split", "AUD-SPLIT");
  purchaseOrder("po-aud-split", "PO-AUD-SPLIT", [["pol-aud-split", "prod-aud-split", 6, 100]]);
  await receipt("po-aud-split", "pol-aud-split", 6, { damagedQuantity: 2, quarantineLocationId: "loc-aud-quarantine" });
  const snapshot = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", search: "PO-AUD-SPLIT", page: 1, pageSize: 10 });
  const line = snapshot.purchaseOrders[0].lines[0];
  const byStatus = JSON.parse(line.latestReceiptReversibleJson);
  assert.deepEqual(byStatus.map((entry) => [entry.inventoryStatus, entry.locationCode, entry.reversibleQuantity]).sort(), [["quarantine", "AUD-QA", 2], ["usable", "AUD-A1", 4]]);
  assert.equal(line.latestReceiptReversibleQuantity, 4);

  const receiptRow = get("SELECT id,version FROM receipts WHERE purchase_order_id='po-aud-split'");
  await command({ command: "reverseReceipt", entityId: receiptRow.id, version: receiptRow.version, idempotencyKey: "aud-split-reverse-quarantine", payload: { lineId: "pol-aud-split", quantity: 2, inventoryStatus: "quarantine", disposition: "reopen", reason: "Damaged units refused at the dock", postingDate: "2026-08-02", actor: "Tester" } });
  assert.deepEqual(rows("SELECT location_id,on_hand_qty FROM inventory_balances WHERE product_id='prod-aud-split' ORDER BY location_id").map((row) => ({ ...row })), [{ location_id: "loc-aud-quarantine", on_hand_qty: 0 }, { location_id: "loc-aud-usable", on_hand_qty: 4 }]);
  const usableLine = byStatus.find((entry) => entry.inventoryStatus === "usable");
  await command({ command: "reverseReceipt", entityId: receiptRow.id, version: receiptRow.version + 1, idempotencyKey: "aud-split-reverse-line", payload: { receiptLineId: usableLine.receiptLineId, quantity: 1, disposition: "reopen", reason: "One usable unit short", postingDate: "2026-08-02", actor: "Tester" } });
  assert.equal(get("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-aud-split' AND location_id='loc-aud-usable'").on_hand_qty, 3);
  await assert.rejects(command({ command: "reverseReceipt", entityId: receiptRow.id, version: receiptRow.version + 2, idempotencyKey: "aud-split-reverse-missing", payload: { lineId: "pol-aud-split", quantity: 1, inventoryStatus: "quarantine", disposition: "reopen", reason: "Nothing left", postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "NOT_REVERSIBLE");
});

test("#17 the snapshot judges lateness against the viewer's asOf date", async () => {
  product("prod-aud-late", "AUD-LATE");
  purchaseOrder("po-aud-late", "PO-AUD-LATE", [["pol-aud-late", "prod-aud-late", 5, 100]], { expected: "2026-09-05" });
  const viewedAfter = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", status: "late", search: "PO-AUD-LATE", page: 1, pageSize: 10, asOf: "2026-09-10" });
  const viewedBefore = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", status: "late", search: "PO-AUD-LATE", page: 1, pageSize: 10, asOf: "2026-09-01" });
  assert.deepEqual(viewedAfter.purchaseOrders.map((order) => order.number), ["PO-AUD-LATE"]);
  assert.equal(viewedAfter.pagination.filteredTotal, 1);
  assert.deepEqual(viewedBefore.purchaseOrders, []);
  assert.equal(viewedBefore.pagination.filteredTotal, 0);
  assert.equal(viewedAfter.summary.latePurchaseOrders, viewedBefore.summary.latePurchaseOrders + 1);
  // A malformed asOf must not reach SQL; it silently falls back to the database clock.
  const malformed = await inventoryDomain.getInventorySnapshot({ scope: "purchase-orders", status: "late", search: "PO-AUD-LATE", page: 1, pageSize: 10, asOf: "2026-09-10' OR 1=1 --" });
  assert.ok(Number.isSafeInteger(malformed.pagination.filteredTotal));
});

test("#21 global search reports the page the priority-sorted worklist actually shows", async () => {
  purchaseOrder("po-aud-page-done", "PO-AUD-PAGE-DONE", [["pol-aud-page-done", "prod-aud-late", 1, 100, 1]], { expected: "2026-01-01" });
  purchaseOrder("po-aud-page-open", "PO-AUD-PAGE-OPEN", [["pol-aud-page-open", "prod-aud-late", 1, 100]], { expected: "2026-12-01" });
  salesOrder("so-aud-page-open", "SO-AUD-PAGE-OPEN", "customer-audit", [["sol-aud-page-open", "prod-aud-late", 1, 200]], { requested: "2026-12-01" });
  const pageSize = 7;
  const locate = async (scope, key, number) => {
    for (let page = 1; page <= 80; page += 1) {
      const snapshot = await inventoryDomain.getInventorySnapshot({ scope, page, pageSize, sort: "priority" });
      if (!snapshot[key].length) break;
      if (snapshot[key].some((order) => order.number === number)) return page;
    }
    throw new Error(`${number} was not found in the ${scope} worklist`);
  };
  const search = await inventoryDomain.searchInventoryRecords("AUD-PAGE", 20, pageSize);
  assert.equal(search.purchaseOrders.length, 2);
  for (const hit of search.purchaseOrders) assert.equal(hit.page, await locate("purchase-orders", "purchaseOrders", hit.number), hit.number);
  assert.equal(search.salesOrders.length, 1);
  for (const hit of search.salesOrders) assert.equal(hit.page, await locate("sales-orders", "salesOrders", hit.number), hit.number);
});

test("#26 an immediate sale applies the customer credit checks before posting the receivable", async () => {
  product("prod-aud-credit", "AUD-CREDIT");
  run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-aud-credit','loc-aud-usable',10,0,1)");
  run("INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES ('prod-aud-credit','fifo',100,100,1,'2026-08-01','Tester')");
  run("INSERT INTO cost_layers (id,product_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) VALUES ('layer-aud-credit','prod-aud-credit',10,10,100,0,'2026-08-01','open')");
  salesOrder("so-aud-hold", "SO-AUD-HOLD", "customer-aud-hold", [["sol-aud-hold", "prod-aud-credit", 1, 500]]);
  salesOrder("so-aud-limit", "SO-AUD-LIMIT", "customer-aud-limit", [["sol-aud-limit", "prod-aud-credit", 1, 5000]]);
  salesOrder("so-aud-within", "SO-AUD-WITHIN", "customer-aud-limit", [["sol-aud-within", "prod-aud-credit", 1, 500]]);
  await assert.rejects(command({ command: "postImmediateSale", entityId: "so-aud-hold", version: 1, idempotencyKey: "aud-immediate-hold", payload: { lineId: "sol-aud-hold", quantity: 1, postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "CREDIT_HOLD");
  await assert.rejects(command({ command: "postImmediateSale", entityId: "so-aud-limit", version: 1, idempotencyKey: "aud-immediate-limit", payload: { lineId: "sol-aud-limit", quantity: 1, postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "CREDIT_LIMIT_EXCEEDED");
  assert.equal(get("SELECT COUNT(*) AS count FROM shipments WHERE sales_order_id IN ('so-aud-hold','so-aud-limit')").count, 0);
  assert.equal(get("SELECT COUNT(*) AS count FROM customer_invoices WHERE sales_order_id IN ('so-aud-hold','so-aud-limit')").count, 0);
  assert.equal(get("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-aud-credit' AND location_id='loc-aud-usable'").on_hand_qty, 10);
  const within = await command({ command: "postImmediateSale", entityId: "so-aud-within", version: 1, idempotencyKey: "aud-immediate-within", payload: { lineId: "sol-aud-within", quantity: 1, postingDate: "2026-08-02", actor: "Tester" } });
  assert.ok(within.invoiceId, "a sale inside the limit still posts");
});

test("#27 tracked products reject anonymous count variances", async () => {
  product("prod-aud-serial", "AUD-SERIAL", { tracking: "serial" });
  run("INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES ('prod-aud-serial','loc-aud-usable',1,0,1)");
  await assert.rejects(command({ command: "postInventoryAdjustment", entityId: "prod-aud-serial", version: 1, idempotencyKey: "aud-serial-count-gain", payload: { locationId: "loc-aud-usable", countedQuantity: 3, reason: "Found two on the floor", postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "TRACKED_PRODUCT_COUNT" && /serial number/.test(error.message));
  await assert.rejects(command({ command: "postInventoryAdjustment", entityId: "prod-aud-serial", version: 1, idempotencyKey: "aud-serial-count-loss", payload: { locationId: "loc-aud-usable", countedQuantity: 0, reason: "Missing", postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "TRACKED_PRODUCT_COUNT");
  assert.equal(get("SELECT on_hand_qty FROM inventory_balances WHERE product_id='prod-aud-serial' AND location_id='loc-aud-usable'").on_hand_qty, 1);
  assert.equal(get("SELECT COUNT(*) AS count FROM inventory_counts WHERE product_id='prod-aud-serial'").count, 0);
  const agreed = await command({ command: "postInventoryAdjustment", entityId: "prod-aud-serial", version: 1, idempotencyKey: "aud-serial-count-agree", payload: { locationId: "loc-aud-usable", countedQuantity: 1, reason: "Cycle count agrees", postingDate: "2026-08-02", actor: "Tester" } });
  assert.match(agreed.message, /no variance/);
});

test("#32 counts and opening balances create the missing balance row in the same batch", async () => {
  product("prod-aud-newbin", "AUD-NEWBIN");
  product("prod-aud-dropship", "AUD-DROPSHIP", { policy: "drop_ship" });
  assert.equal(get("SELECT COUNT(*) AS count FROM inventory_balances WHERE product_id='prod-aud-newbin'").count, 0);
  const opened = await command({ command: "postOpeningBalance", entityId: "prod-aud-newbin", version: 1, idempotencyKey: "aud-newbin-opening", payload: { locationId: "loc-aud-usable", countedQuantity: 3, unitCostCents: 250, reason: "Go-live stock", postingDate: "2026-08-02", actor: "Tester" } });
  assert.match(opened.message, /posted 3 opening units/);
  assert.deepEqual({ ...get("SELECT on_hand_qty,reserved_qty,version FROM inventory_balances WHERE product_id='prod-aud-newbin' AND location_id='loc-aud-usable'") }, { on_hand_qty: 3, reserved_qty: 0, version: 2 });
  const counted = await command({ command: "postInventoryAdjustment", entityId: "prod-aud-newbin", version: 1, idempotencyKey: "aud-newbin-count", payload: { locationId: "loc-aud-usable-2", countedQuantity: 2, unitCostCents: 250, reason: "First count of the second bin", postingDate: "2026-08-02", actor: "Tester" } });
  assert.match(counted.message, /\+2 unit variance/);
  assert.deepEqual({ ...get("SELECT on_hand_qty,version FROM inventory_balances WHERE product_id='prod-aud-newbin' AND location_id='loc-aud-usable-2'") }, { on_hand_qty: 2, version: 2 });
  assert.equal(get("SELECT COALESCE(SUM(value_cents),0) AS value FROM inventory_value_entries WHERE product_id='prod-aud-newbin'").value, 1250);
  await assert.rejects(command({ command: "postInventoryAdjustment", entityId: "prod-aud-newbin", version: 3, idempotencyKey: "aud-newbin-wrong-version", payload: { locationId: "loc-aud-frac", countedQuantity: 1, reason: "Stale", postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "VERSION_CONFLICT");
  await assert.rejects(command({ command: "postInventoryAdjustment", entityId: "prod-aud-dropship", version: 1, idempotencyKey: "aud-dropship-count", payload: { locationId: "loc-aud-usable", countedQuantity: 1, reason: "Not stocked", postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "NOT_STOCKED");
  await assert.rejects(command({ command: "postInventoryAdjustment", entityId: "prod-aud-newbin", version: 1, idempotencyKey: "aud-newbin-bad-location", payload: { locationId: "loc-does-not-exist", countedQuantity: 1, reason: "Bad bin", postingDate: "2026-08-02", actor: "Tester" } }), (error) => error?.code === "INVALID_LOCATION");
});

test("#29 precision-3 quantities do not drift into the non-negative balance triggers", async () => {
  product("prod-aud-frac", "AUD-FRAC", { uom: "uom-aud-kg", cost: 1000 });
  await command({ command: "postOpeningBalance", entityId: "prod-aud-frac", version: 1, idempotencyKey: "aud-frac-opening", payload: { locationId: "loc-aud-frac", countedQuantity: 0.3, unitCostCents: 1000, reason: "Opening", postingDate: "2026-08-02", actor: "Tester" } });
  salesOrder("so-aud-frac", "SO-AUD-FRAC", "customer-audit", [["sol-aud-frac-1", "prod-aud-frac", 0.1, 2000], ["sol-aud-frac-2", "prod-aud-frac", 0.2, 2000]]);
  await command({ command: "reserveSale", entityId: "so-aud-frac", version: 1, idempotencyKey: "aud-frac-reserve-1", payload: { lineId: "sol-aud-frac-1", quantity: 0.1, actor: "Tester" } });
  await command({ command: "reserveSale", entityId: "so-aud-frac", version: 2, idempotencyKey: "aud-frac-reserve-2", payload: { lineId: "sol-aud-frac-2", quantity: 0.2, actor: "Tester" } });
  assert.deepEqual({ ...get("SELECT on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-aud-frac' AND location_id='loc-aud-frac'") }, { on_hand_qty: 0.3, reserved_qty: 0.3 });
  await command({ command: "shipSale", entityId: "so-aud-frac", version: 3, idempotencyKey: "aud-frac-ship-1", payload: { lineId: "sol-aud-frac-1", quantity: 0.1, carrier: "Audit Freight", trackingNumber: "FRAC-1", postingDate: "2026-08-03", actor: "Tester" } });
  await command({ command: "shipSale", entityId: "so-aud-frac", version: 4, idempotencyKey: "aud-frac-ship-2", payload: { lineId: "sol-aud-frac-2", quantity: 0.2, carrier: "Audit Freight", trackingNumber: "FRAC-2", postingDate: "2026-08-03", actor: "Tester" } });
  assert.deepEqual({ ...get("SELECT on_hand_qty,reserved_qty FROM inventory_balances WHERE product_id='prod-aud-frac' AND location_id='loc-aud-frac'") }, { on_hand_qty: 0, reserved_qty: 0 });
  assert.deepEqual(rows("SELECT remaining_qty,status FROM cost_layers WHERE product_id='prod-aud-frac'").map((row) => ({ ...row })), [{ remaining_qty: 0, status: "consumed" }]);
});

test("#34 the legacy reverseShipment command alias is gone from /api/commands", async () => {
  assert.equal(inventoryDomain.inventoryCommandCapability("reverseShipment"), undefined);
  assert.equal(inventoryDomain.inventoryCommandCapability("reverse_shipment"), undefined);
  await assert.rejects(command({ command: "reverseShipment", entityId: "shipment-none", version: 1, idempotencyKey: "aud-reverse-shipment-alias", payload: { quantity: 1, reason: "Alias", actor: "Tester" } }), (error) => error?.code === "UNKNOWN_COMMAND");
});

test("lower-severity: dated fields are validated, future postings are refused, duplicate-SKU batches are allowed under FIFO, and bad currencies do not crash allowances", async () => {
  product("prod-aud-misc", "AUD-MISC");
  product("prod-aud-average", "AUD-AVERAGE");
  run("INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES ('prod-aud-average','average',100,100,1,'2026-08-01','Tester')");
  purchaseOrder("po-aud-reopen", "PO-AUD-REOPEN", [["pol-aud-reopen", "prod-aud-misc", 4, 100, 2]]);
  await assert.rejects(command({ command: "reopenRemainder", entityId: "po-aud-reopen", version: 1, idempotencyKey: "aud-reopen-bad-date", payload: { lineId: "pol-aud-reopen", quantity: 1, expectedDate: "next week", reason: "Vendor found stock", actor: "Tester" } }), (error) => error?.code === "VALIDATION_ERROR" && /expectedDate must use YYYY-MM-DD/.test(error.message));
  await assert.rejects(command({ command: "reopenRemainder", entityId: "po-aud-reopen", version: 1, idempotencyKey: "aud-reopen-fake-date", payload: { lineId: "pol-aud-reopen", quantity: 1, expectedDate: "2026-02-30", reason: "Vendor found stock", actor: "Tester" } }), (error) => error?.code === "VALIDATION_ERROR" && /valid calendar date/.test(error.message));
  await command({ command: "reopenRemainder", entityId: "po-aud-reopen", version: 1, idempotencyKey: "aud-reopen-ok", payload: { lineId: "pol-aud-reopen", quantity: 1, expectedDate: "2026-09-15", reason: "Vendor found stock", actor: "Tester" } });
  assert.equal(get("SELECT expected_date FROM purchase_orders WHERE id='po-aud-reopen'").expected_date, "2026-09-15");

  await assert.rejects(command({ command: "postReceipt", entityId: "po-aud-reopen", version: 2, idempotencyKey: "aud-future-receipt", payload: { lineId: "pol-aud-reopen", quantity: 1, locationId: "loc-aud-usable", postingDate: "2099-01-01", actor: "Tester" } }), (error) => error?.code === "POSTING_DATE_IN_FUTURE");
  await assert.rejects(command({ command: "postReceipt", entityId: "po-aud-reopen", version: 2, idempotencyKey: "aud-future-receipt-asof", payload: { lineId: "pol-aud-reopen", quantity: 1, locationId: "loc-aud-usable", postingDate: "2026-08-05", asOf: "2026-08-01", actor: "Tester" } }), (error) => error?.code === "POSTING_DATE_IN_FUTURE");
  assert.equal(get("SELECT COUNT(*) AS count FROM receipts WHERE purchase_order_id='po-aud-reopen'").count, 0);

  purchaseOrder("po-aud-dupe-fifo", "PO-AUD-DUPE-FIFO", [["pol-aud-dupe-fifo-a", "prod-aud-misc", 2, 100], ["pol-aud-dupe-fifo-b", "prod-aud-misc", 2, 120]]);
  const batch = await command({ command: "postReceiptBatch", entityId: "po-aud-dupe-fifo", version: 1, idempotencyKey: "aud-dupe-fifo", payload: { postingDate: "2026-08-02", actor: "Tester", lines: [
    { lineId: "pol-aud-dupe-fifo-a", lineVersion: 1, quantity: 2, locationId: "loc-aud-usable" },
    { lineId: "pol-aud-dupe-fifo-b", lineVersion: 1, quantity: 2, locationId: "loc-aud-usable" },
  ] } });
  assert.match(batch.message, /2 lines and 4 units as one receipt/);
  purchaseOrder("po-aud-dupe-avg", "PO-AUD-DUPE-AVG", [["pol-aud-dupe-avg-a", "prod-aud-average", 2, 100], ["pol-aud-dupe-avg-b", "prod-aud-average", 2, 120]]);
  await assert.rejects(command({ command: "postReceiptBatch", entityId: "po-aud-dupe-avg", version: 1, idempotencyKey: "aud-dupe-avg", payload: { postingDate: "2026-08-02", actor: "Tester", lines: [
    { lineId: "pol-aud-dupe-avg-a", lineVersion: 1, quantity: 2, locationId: "loc-aud-usable" },
    { lineId: "pol-aud-dupe-avg-b", lineVersion: 1, quantity: 2, locationId: "loc-aud-usable" },
  ] } }), (error) => error?.code === "DUPLICATE_PRODUCT_RECEIPT" && /Lines 1 and 2/.test(error.message) && /pol-aud-dupe-avg-a and pol-aud-dupe-avg-b/.test(error.message));

  // Intl accepts any well-formed three-letter code; a malformed one used to throw a RangeError
  // out of the handler as a raw 500. The guard falls back to a plain amount with the code.
  purchaseOrder("po-aud-currency", "PO-AUD-CURRENCY", [["pol-aud-currency", "prod-aud-misc", 1, 100]], { currency: "XX" });
  const allowance = await command({ command: "priceOnlyCredit", entityId: "po-aud-currency", version: 1, idempotencyKey: "aud-bad-currency-allowance", payload: { amountCents: 1234, reason: "Price protection", postingDate: "2026-08-02", actor: "Tester" } });
  assert.match(allowance.message, /12\.34 XX price-only vendor allowance recorded/);
});

test("a long multi-line truck receipt claims its lines with one JSON parameter and stays under D1's 100-variable cap", async () => {
  const lines = [];
  for (let index = 0; index < 25; index += 1) {
    product(`prod-aud-truck-${index}`, `AUD-TRUCK-${index}`);
    lines.push([`pol-aud-truck-${index}`, `prod-aud-truck-${index}`, 4, 250]);
  }
  purchaseOrder("po-aud-truck", "PO-AUD-TRUCK", lines);
  const before = db.preparedSql.length;
  const result = await command({ command: "postReceiptBatch", entityId: "po-aud-truck", version: 1, idempotencyKey: "aud-truck-receipt", payload: {
    postingDate: "2026-08-02", actor: "Tester",
    lines: lines.map(([lineId]) => ({ lineId, lineVersion: 1, quantity: 4, locationId: "loc-aud-usable" })),
  } });
  assert.match(result.message, /25 lines/);
  const claim = db.preparedSql.slice(before).find((sql) => sql.includes("command_log") && sql.includes("INSERT OR IGNORE INTO") && sql.includes("json_each"));
  assert.ok(claim, "the batch claim binds its line preconditions through json_each");
  const widest = Math.max(...db.preparedSql.slice(before).map(placeholders));
  assert.ok(widest <= 100, `widest statement binds ${widest} parameters`);
  assert.equal(get("SELECT COUNT(*) AS count FROM receipt_lines rl JOIN receipts r ON r.id=rl.receipt_id WHERE r.purchase_order_id='po-aud-truck'").count, 25);
  assert.equal(get("SELECT SUM(on_hand_qty) AS onHand FROM inventory_balances WHERE product_id LIKE 'prod-aud-truck-%'").onHand, 100);
});
