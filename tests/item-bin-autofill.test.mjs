import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let advancedDomain;
let documentEmail;
let inventoryDomain;

const administrator = {
  id: "bin-admin",
  email: "bin-admin@example.com",
  name: "Bin Admin",
  role: "administrator",
  label: "Bin Admin <bin-admin@example.com>",
  localDevelopment: false,
};

async function applyMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
  }
}

function run(sql, ...values) { return db.prepare(sql).bind(...values).run(); }
function row(sql, ...values) { const found = db.sqlite.prepare(sql).get(...values); return found ? { ...found } : undefined; }
function pdfText(pdf) { return new TextDecoder().decode(pdf.body); }

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  env.BOOTSTRAP_DEMO_DATA = "false";
  inventoryDomain = await import("../lib/server/inventory-domain.ts");
  advancedDomain = await import("../lib/server/advanced-domain.ts");
  documentEmail = await import("../lib/server/document-email.ts");
  await (await import("../lib/server/inventory-db.ts")).ensureDatabase();

  await run("INSERT INTO warehouses (id,code,name,timezone,active,version) VALUES ('wh-bin','BIN-WH','Bin Warehouse','America/Edmonton',1,1)");
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-bin-a1','A-01-02','Aisle 1 shelf 2','storage','usable','wh-bin',1,1)");
  await run("INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,active,version) VALUES ('loc-bin-b1','B-01-01','Aisle 2 shelf 1','storage','usable','wh-bin',1,1)");
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('vendor-bin','V-BIN','Bin Vendor','vendor','CAD',1,1,'2026-09-01')");
  await run("INSERT INTO business_partners (id,code,name,partner_type,address_line_1,city,region,postal_code,country,currency,credit_limit_cents,credit_hold,active,version,created_at) VALUES ('customer-bin','C-BIN','Bin Customer','customer','1 Bin Way','Edmonton','AB','T5J 0N1','CA','CAD',0,0,1,1,'2026-09-01')");
  await run(`INSERT INTO products
    (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at,pricing_mode,suggested_selling_price_cents)
    VALUES ('prod-bin','BIN-100','Bin item','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-09-01','manual',200)`);
  await run(`INSERT INTO products
    (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at,pricing_mode,suggested_selling_price_cents)
    VALUES
      ('prod-single-bin','BIN-SINGLE','Single-bin item','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-09-01','manual',200),
      ('prod-multi-bin','BIN-MULTI','Multi-bin item','test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-09-01','manual',200)`);
  await run("INSERT INTO product_default_locations (product_id,warehouse_id,location_id,updated_at,updated_by,version) VALUES ('prod-bin','wh-bin','loc-bin-a1','2026-09-01','Bin Admin',1)");
  await run(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version) VALUES
    ('prod-single-bin','loc-bin-a1',6,0,1),
    ('prod-multi-bin','loc-bin-a1',3,0,1),
    ('prod-multi-bin','loc-bin-b1',3,0,1)`);
});

after(() => db.close());

test("an item's configured bin auto-fills purchase, sales, and invoice lines", async () => {
  const lookup = await inventoryDomain.searchInventoryReferences("products", "BIN-100", 20, "sales", "customer-bin", 1, "wh-bin", "CAD", 1);
  const product = lookup.items.find((item) => item.id === "prod-bin");
  assert.deepEqual({
    id: product.defaultBinLocationId,
    code: product.defaultBinLocationCode,
    name: product.defaultBinLocationName,
  }, { id: "loc-bin-a1", code: "A-01-02", name: "Aisle 1 shelf 2" });

  const purchaseOrder = await advancedDomain.executeWorkflow({
    command: "createApprovedPurchaseOrder",
    idempotencyKey: "bin-purchase-order",
    actor: administrator,
    payload: {
      vendorId: "vendor-bin",
      warehouseId: "wh-bin",
      expectedDate: "2026-09-20",
      currency: "CAD",
      exchangeRateToBase: 1,
      paymentTerms: "Net 30",
      dueDate: "2026-10-20",
      approvalReason: "Bin auto-fill integration coverage",
      lines: [{ kind: "item", productId: "prod-bin", quantity: 2, unitCostCents: 100, taxable: false, taxRateBps: 0 }],
    },
  });
  assert.equal(row("SELECT bin_location_id FROM purchase_order_lines WHERE purchase_order_id=?", purchaseOrder.recordId).bin_location_id, "loc-bin-a1");
  assert.match(pdfText(await documentEmail.getDocumentPdf("purchase_order", purchaseOrder.recordId)), /Bin: A-01-02/);

  const salesOrder = await advancedDomain.executeWorkflow({
    command: "createConfirmedSalesOrder",
    idempotencyKey: "bin-sales-order",
    actor: administrator,
    payload: {
      customerId: "customer-bin",
      warehouseId: "wh-bin",
      requestedDate: "2026-09-20",
      currency: "CAD",
      exchangeRateToBase: 1,
      paymentTerms: "Net 30",
      dueDate: "2026-10-20",
      shipToName: "Bin Customer",
      shipToAddressLine1: "1 Bin Way",
      shipToCity: "Edmonton",
      shipToRegion: "AB",
      shipToPostalCode: "T5J 0N1",
      shipToCountry: "CA",
      approvalReason: "Bin auto-fill integration coverage",
      lines: [{ kind: "item", productId: "prod-bin", quantity: 2, unitPriceCents: 200, taxable: false, taxRateBps: 0 }],
    },
  });
  const salesLine = row("SELECT id,bin_location_id FROM sales_order_lines WHERE sales_order_id=?", salesOrder.recordId);
  assert.equal(salesLine.bin_location_id, "loc-bin-a1");
  assert.match(pdfText(await documentEmail.getDocumentPdf("sales_order", salesOrder.recordId)), /Bin: A-01-02/);

  await run(`INSERT INTO stock_movements
    (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,sales_order_line_id,posted_at,posted_by,idempotency_key)
    VALUES ('bin-shipment','sales_shipment','prod-bin',-2,'loc-bin-a1','usable','shipment','shipment-bin',?,'2026-09-03T12:00:00Z','Bin Admin','bin-shipment')`, salesLine.id);
  const invoice = await advancedDomain.executeWorkflow({
    command: "createCustomerInvoice",
    entityId: salesOrder.recordId,
    version: 1,
    idempotencyKey: "bin-customer-invoice",
    actor: administrator,
    payload: { invoiceDate: "2026-09-03", dueDate: "2026-10-03" },
  });
  assert.equal(row("SELECT bin_location_id FROM customer_invoice_lines WHERE customer_invoice_id=?", invoice.recordId).bin_location_id, "loc-bin-a1");
  assert.match(pdfText(await documentEmail.getDocumentPdf("customer_invoice", invoice.recordId)), /Bin: A-01-02/);
});

test("the only stocked bin auto-fills when an item has no configured default", async () => {
  const lookup = await inventoryDomain.searchInventoryReferences("products", "BIN-SINGLE", 20, "sales", "customer-bin", 2, "wh-bin", "CAD", 1);
  const product = lookup.items.find((item) => item.id === "prod-single-bin");
  assert.deepEqual({
    id: product.defaultBinLocationId,
    code: product.defaultBinLocationCode,
    name: product.defaultBinLocationName,
    available: product.defaultBinAvailableQuantity,
    source: product.binLocationSource,
  }, { id: "loc-bin-a1", code: "A-01-02", name: "Aisle 1 shelf 2", available: 6, source: "only_stocked" });

  const ambiguousLookup = await inventoryDomain.searchInventoryReferences("products", "BIN-MULTI", 20, "sales", "customer-bin", 1, "wh-bin", "CAD", 1);
  const ambiguousProduct = ambiguousLookup.items.find((item) => item.id === "prod-multi-bin");
  assert.equal(ambiguousProduct.defaultBinLocationId, null);
  assert.equal(ambiguousProduct.binLocationSource, null);

  const salesOrder = await advancedDomain.executeWorkflow({
    command: "createConfirmedSalesOrder",
    idempotencyKey: "single-stocked-bin-sales-order",
    actor: administrator,
    payload: {
      customerId: "customer-bin",
      warehouseId: "wh-bin",
      requestedDate: "2026-09-20",
      currency: "CAD",
      exchangeRateToBase: 1,
      paymentTerms: "Net 30",
      dueDate: "2026-10-20",
      shipToName: "Bin Customer",
      shipToAddressLine1: "1 Bin Way",
      shipToCity: "Edmonton",
      shipToRegion: "AB",
      shipToPostalCode: "T5J 0N1",
      shipToCountry: "CA",
      approvalReason: "Single stocked bin fallback coverage",
      lines: [{ kind: "item", productId: "prod-single-bin", quantity: 2, unitPriceCents: 200, taxable: false, taxRateBps: 0 }],
    },
  });
  assert.equal(row("SELECT bin_location_id FROM sales_order_lines WHERE sales_order_id=?", salesOrder.recordId).bin_location_id, "loc-bin-a1");
});
