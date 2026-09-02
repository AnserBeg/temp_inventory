#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const data = JSON.parse(readFileSync(`${root}/data/max-green-inventory.json`, "utf8"));
const statementBreakpoint = "--> statement-breakpoint";
const statements = [];

function sqlText(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  if (!Number.isFinite(Number(value))) throw new Error(`Expected a finite number, received ${value}`);
  return String(Number(value));
}

function add(sql) {
  statements.push(sql.trim());
}

const importGuardTable = "_max_green_import_guard";
const importGuardExists = `EXISTS (SELECT 1 FROM temp.${importGuardTable} WHERE enabled=1)`;

function addGuardedInsert(sql) {
  const normalized = sql.trim();
  const match = normalized.match(/^(INSERT(?: OR IGNORE)? INTO[\s\S]+?)\bVALUES\s*\(([\s\S]*)\)(\s*ON CONFLICT[\s\S]*)?$/i);
  if (!match) throw new Error(`Unable to guard INSERT statement: ${normalized.slice(0, 120)}`);
  const [, insertClause, values, conflictClause = ""] = match;
  add(`${insertClause}SELECT ${values}\nWHERE ${importGuardExists}${conflictClause}`);
}

const businessTables = [
  "qbo_webhook_events",
  "qbo_sync_deliveries",
  "qbo_sync_cursors",
  "qbo_reference_mappings",
  "qbo_reconciliation_runs",
  "qbo_entity_links",
  "qbo_account_mappings",
  "qbo_oauth_states",
  "qbo_connections",
  "document_email_deliveries",
  "attachments",
  "inventory_count_session_lines",
  "inventory_count_sessions",
  "payments",
  "customer_invoice_lines",
  "customer_credits",
  "customer_invoices",
  "vendor_bill_lines",
  "vendor_credits",
  "vendor_bills",
  "catalog_price_history",
  "product_cost_history",
  "landed_cost_allocation_lines",
  "landed_cost_allocations",
  "inventory_value_entries",
  "cost_layers",
  "movement_assignments",
  "returnable_events",
  "returnable_obligations",
  "returnable_asset_types",
  "inventory_counts",
  "customer_returns",
  "vendor_returns",
  "drop_ship_deliveries",
  "shipment_lines",
  "shipments",
  "reservations",
  "receipt_lines",
  "receipts",
  "inventory_transfer_lines",
  "inventory_transfers",
  "stock_movements",
  "inventory_balances",
  "inventory_units",
  "inventory_lots",
  "sales_order_lines",
  "sales_orders",
  "purchase_order_revisions",
  "purchase_order_lines",
  "purchase_orders",
  "price_list_entries",
  "price_list_assignments",
  "price_lists",
  "partner_addresses",
  "document_charges",
  "approvals",
  "outbox_events",
  "audit_events",
  "command_log",
  "valuation_policies",
  "uom_conversions",
  "margin_rules",
  "products",
  "business_partners",
  "locations",
  "warehouses",
  "document_sequences",
  "period_locks",
];

add("PRAGMA defer_foreign_keys=TRUE");
add(`DROP TABLE IF EXISTS temp.${importGuardTable}`);
add(`CREATE TEMP TABLE ${importGuardTable} (enabled INTEGER PRIMARY KEY)`);
add(`INSERT INTO temp.${importGuardTable} (enabled)
SELECT 1
WHERE (SELECT COUNT(*) FROM products)=6
  AND (SELECT COUNT(*) FROM business_partners)=6
  AND (SELECT COUNT(*) FROM locations)=6
  AND (SELECT COUNT(*) FROM inventory_balances)=7
  AND EXISTS (SELECT 1 FROM products WHERE id='prod-awning-2436')
  AND EXISTS (SELECT 1 FROM products WHERE id='prod-casement-3648')
  AND EXISTS (SELECT 1 FROM products WHERE id='prod-slider-6048')
  AND EXISTS (SELECT 1 FROM business_partners WHERE id='vendor-andersen')
  AND EXISTS (SELECT 1 FROM business_partners WHERE id='customer-copperstone')
  AND EXISTS (SELECT 1 FROM locations WHERE id='loc-a01')`);
add("DROP TRIGGER IF EXISTS stock_movements_immutable_delete");
add("DROP TRIGGER IF EXISTS stock_movements_immutable_update");
for (const table of businessTables) add(`DELETE FROM ${table} WHERE ${importGuardExists}`);

const importedAt = `${data.company.inventoryAsOf}T23:59:59.000Z`;
addGuardedInsert(`INSERT OR IGNORE INTO units_of_measure (id,code,name,dimension,precision,active)
VALUES ('uom-each','EA','Each','quantity',0,1)`);
addGuardedInsert(`INSERT INTO warehouses (id,code,name,timezone,active,version)
VALUES (${sqlText(data.company.warehouse.id)},${sqlText(data.company.warehouse.code)},${sqlText(data.company.warehouse.name)},${sqlText(data.company.warehouse.timezone)},1,1)`);

for (const location of data.company.warehouse.locations) {
  addGuardedInsert(`INSERT INTO locations (id,code,name,location_type,inventory_status,warehouse_id,parent_location_id,active,version)
VALUES (${sqlText(location.id)},${sqlText(location.code)},${sqlText(location.name)},${sqlText(location.locationType)},'usable',${sqlText(data.company.warehouse.id)},NULL,1,1)`);
}

for (const vendor of data.vendors) {
  addGuardedInsert(`INSERT INTO business_partners (id,code,name,partner_type,country,currency,credit_limit_cents,credit_hold,active,version,created_at)
VALUES (${sqlText(vendor.id)},${sqlText(vendor.code)},${sqlText(vendor.name)},'vendor','CA','CAD',0,0,1,1,${sqlText(importedAt)})`);
}

for (const product of data.products) {
  const missingPriceOrCost = product.sellingPriceCents === 0 || product.standardCostCents === 0;
  addGuardedInsert(`INSERT INTO products
  (id,sku,manufacturer_sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,
   standard_cost_cents,last_unit_cost_cents,selling_price_cents,suggested_selling_price_cents,pricing_mode,manual_price_reason,pricing_updated_at,
   reorder_point,max_stock_level,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
VALUES
  (${sqlText(product.id)},${sqlText(product.sku)},${sqlText(product.manufacturerSku)},${sqlText(product.name)},${sqlText(product.category)},${sqlText(product.material)},${sqlText(product.dimensions)},${sqlText(product.finish)},
   'quantity','stocked',${sqlNumber(product.standardCostCents)},${sqlNumber(product.standardCostCents)},${sqlNumber(product.sellingPriceCents)},${sqlNumber(product.sellingPriceCents)},'manual',
   ${sqlText(missingPriceOrCost ? "Source workbook did not provide both cost and selling price" : "Imported from Max Green inventory count sheet")},${sqlText(importedAt)},
   ${sqlNumber(product.reorderPoint)},${sqlNumber(product.maxStockLevel)},'uom-each','uom-each','uom-each',1,1,${sqlText(importedAt)})`);

  addGuardedInsert(`INSERT INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by)
VALUES (${sqlText(product.id)},'fifo',${sqlNumber(product.standardCostCents)},${sqlNumber(product.standardCostCents)},1,${sqlText(importedAt)},'Max Green inventory import')`);

  addGuardedInsert(`INSERT INTO catalog_price_history
  (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
VALUES
  (${sqlText(`price-max-green-${product.sku}`)},${sqlText(product.id)},'inventory_import',${sqlNumber(product.standardCostCents)},${sqlNumber(product.sellingPriceCents)},${sqlNumber(product.sellingPriceCents)},${sqlNumber(product.sellingPriceCents)},'manual',NULL,NULL,
   'Imported from Max Green inventory count sheet',${sqlText(importedAt)},'Max Green inventory import')`);

  for (const [locationKey, quantity] of [["inside", product.insideQty], ["outside", product.outsideQty]]) {
    if (quantity <= 0) continue;
    const locationId = locationKey === "inside" ? "loc-max-green-inside" : "loc-max-green-outside";
    const movementId = `mov-max-green-${product.sku.toLowerCase()}-${locationKey}`;
    addGuardedInsert(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
VALUES (${sqlText(product.id)},${sqlText(locationId)},${sqlNumber(quantity)},0,1)`);
    addGuardedInsert(`INSERT INTO stock_movements
  (id,movement_type,product_id,quantity,from_location_id,to_location_id,inventory_status,source_document_type,source_document_id,source_line_id,posted_at,posted_by,unit_cost_cents,currency,idempotency_key)
VALUES
  (${sqlText(movementId)},'opening_balance',${sqlText(product.id)},${sqlNumber(quantity)},NULL,${sqlText(locationId)},'usable','opening_balance','MAX-GREEN-2026-08-26',${sqlText(product.id)},
   ${sqlText(importedAt)},'Max Green inventory import',${sqlNumber(product.standardCostCents)},'CAD',${sqlText(`max-green-opening-${product.sku}-${locationKey}`)})`);
    addGuardedInsert(`INSERT INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status)
VALUES (${sqlText(`layer-${movementId}`)},${sqlText(product.id)},${sqlText(movementId)},${sqlNumber(quantity)},${sqlNumber(quantity)},${sqlNumber(product.standardCostCents)},0,${sqlText(importedAt)},'open')`);
    addGuardedInsert(`INSERT INTO inventory_value_entries
  (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by)
VALUES
  (${sqlText(`value-${movementId}`)},${sqlText(product.id)},${sqlText(movementId)},'opening_balance',${sqlNumber(quantity)},${sqlNumber(product.standardCostCents)},${sqlNumber(Math.round(quantity * product.standardCostCents))},'fifo','opening_balance','MAX-GREEN-2026-08-26',${sqlText(importedAt)},'Max Green inventory import')`);
  }
}

let purchaseOrderLineSequence = 0;
for (const order of data.purchaseOrders) {
  addGuardedInsert(`INSERT INTO purchase_orders
  (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,total_cents,buyer_name,project_reference,revision_number,version,created_at)
VALUES
  (${sqlText(order.id)},${sqlText(order.number)},${sqlText(order.vendorId)},'approved','not_billed',${sqlText(order.expectedDate)},'CAD',1,${sqlNumber(order.totalCents)},${sqlNumber(order.totalCents)},
   'Max Green inventory import',${sqlText(`Source quote ${order.sourceQuote}`)},1,1,${sqlText(importedAt)})`);
  for (const line of order.lines) {
    purchaseOrderLineSequence += 1;
    addGuardedInsert(`INSERT INTO purchase_order_lines
  (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,fulfillment_route,discount_cents,taxable,tax_code,tax_rate_bps,version)
VALUES
  (${sqlText(`pol-max-green-${String(purchaseOrderLineSequence).padStart(4, "0")}`)},${sqlText(order.id)},${sqlText(line.productId)},${sqlNumber(line.quantity)},0,${sqlNumber(line.unitCostCents)},'uom-each',${sqlNumber(line.quantity)},${sqlNumber(line.unitCostCents)},'stock',0,0,'EXEMPT',0,1)`);
  }
  addGuardedInsert(`INSERT INTO purchase_order_revisions
  (id,purchase_order_id,revision_number,lifecycle_status,snapshot_json,reason,created_by,created_at)
VALUES
  (${sqlText(`revision-${order.id}-1`)},${sqlText(order.id)},1,'approved',${sqlText(JSON.stringify({ sourceQuote: order.sourceQuote, sourceArrivalValues: order.sourceArrivalValues, lines: order.lines }))},
   'Imported open order from Max Green inventory count sheet','Max Green inventory import',${sqlText(importedAt)})`);
}

addGuardedInsert(`INSERT INTO margin_rules
  (id,code,name,product_id,category,minimum_cost_cents,maximum_cost_cents,target_margin_bps,minimum_gross_profit_cents,rounding_increment_cents,priority,valid_from,valid_to,active,version,created_at,updated_at)
VALUES
  ('margin-default-32','DEFAULT-32','Default 32% gross margin',NULL,NULL,0,NULL,3200,0,100,0,NULL,NULL,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);

addGuardedInsert(`INSERT INTO system_settings (key,value_json,description,version,updated_by,updated_at)
VALUES ('company.profile',${sqlText(JSON.stringify({ name: data.company.name, industry: data.company.industry, currency: data.company.currency, inventoryAsOf: data.company.inventoryAsOf }))},
  'Company identity and inventory cutover metadata.',1,'Max Green inventory import',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,description=excluded.description,version=system_settings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`);

addGuardedInsert(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,metadata_json,created_at)
VALUES ('audit-max-green-import','company','max-green','company_inventory_imported',
  ${sqlText(`Max Green imported with ${data.summary.productCount} products, ${data.summary.openingOnHandUnits} on-hand units across Inside and Outside, and ${data.summary.pendingOrderUnits} units on open purchase orders.`)},
  'Max Green inventory import',${sqlText(JSON.stringify({ source: data.source, summary: data.summary, discrepancies: data.discrepancies }))},CURRENT_TIMESTAMP)`);

add(`CREATE TRIGGER stock_movements_immutable_update
BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END`);
add(`CREATE TRIGGER stock_movements_immutable_delete
BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END`);
add(`DROP TABLE temp.${importGuardTable}`);
add("PRAGMA optimize");
const migration = `${statements.join(`;${statementBreakpoint}\n`)};\n`;
const outputFlagIndex = process.argv.indexOf("--output");
if (outputFlagIndex >= 0) {
  const outputPath = process.argv[outputFlagIndex + 1];
  if (!outputPath) throw new Error("--output requires a path");
  writeFileSync(outputPath, migration);
} else {
  process.stdout.write(migration);
}
