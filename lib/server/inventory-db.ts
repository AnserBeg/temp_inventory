import { env } from "cloudflare:workers";

type SqlValue = string | number | null;

export type CommandClaim = {
  idempotencyKey: string;
  claimToken?: string;
};

const commandGuardTag = "/* paneflow-command-claim */";

let ready: Promise<void> | undefined;

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable. The logical D1 binding must be configured as DB.");
  }
  return env.DB;
}

export function commandGuardSql() {
  return `EXISTS (SELECT 1 FROM command_log WHERE idempotency_key = ? AND claim_token = ?) ${commandGuardTag}`;
}

/**
 * Returns a request-scoped D1 facade that appends the command claim bindings
 * to statements containing commandGuardSql(). The SQL text remains static, so
 * D1 can cache the prepared statement and user input never enters SQL source.
 */
export function commandD1(command: CommandClaim): D1Database {
  const db = getD1();
  const claimToken = command.claimToken;
  if (!command.idempotencyKey || !claimToken) {
    throw new Error("A command claim requires both an idempotency key and claim token.");
  }
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          const prepared = target.prepare(sql);
          if (!sql.includes(commandGuardTag)) return prepared;
          return new Proxy(prepared, {
            get(statementTarget, statementProperty) {
              if (statementProperty === "bind") {
                return (...values: unknown[]) => statementTarget.bind(...values, command.idempotencyKey, claimToken);
              }
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              return typeof value === "function" ? value.bind(statementTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function demoBootstrapEnabled() {
  const runtime = env as unknown as { BOOTSTRAP_DEMO_DATA?: string };
  return runtime.BOOTSTRAP_DEMO_DATA?.trim().toLowerCase() === "true";
}

export function statement(sql: string, ...values: SqlValue[]) {
  return getD1().prepare(sql).bind(...values);
}

export async function first<T>(sql: string, ...values: SqlValue[]): Promise<T | null> {
  return (await statement(sql, ...values).first<T>()) ?? null;
}

export async function all<T>(sql: string, ...values: SqlValue[]): Promise<T[]> {
  const result = await statement(sql, ...values).all<T>();
  return result.results ?? [];
}

function addDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedDatabase(db: D1Database) {
  const existing = await db.prepare("SELECT id FROM products LIMIT 1").first();
  if (existing) return;

  const now = new Date().toISOString();
  const prior = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const old = new Date(Date.now() - 12 * 86_400_000).toISOString();
  const seed: Array<[string, SqlValue[]]> = [];
  const push = (sql: string, ...values: SqlValue[]) => seed.push([sql, values]);

  [
    ["vendor-andersen", "V-100", "Andersen Distribution", "vendor", "orders@andersen.example", "1-800-426-4261"],
    ["vendor-plygem", "V-220", "Ply Gem Canada", "vendor", "service@plygem.example", "1-888-975-9436"],
    ["vendor-allweather", "V-310", "All Weather Windows", "vendor", "orders@allweather.example", "1-800-638-5700"],
    ["customer-ridgeview", "C-410", "Ridgeview Custom Homes", "customer", "purchasing@ridgeview.example", "403-555-0182"],
    ["customer-northstar", "C-425", "Northstar Renovations", "customer", "ops@northstar.example", "780-555-0144"],
    ["customer-copperstone", "C-440", "Copperstone Developments", "customer", "site@copperstone.example", "587-555-0197"],
  ].forEach((row) => push(
    "INSERT OR IGNORE INTO business_partners (id, code, name, partner_type, email, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ...row, now
  ));

  const productRows: Array<Array<SqlValue>> = [
    ["prod-casement-3648", "AW100-CAS-3648-L", "100CAS3648L", "100 Series Casement · 36 × 48", "Casement", "Fibrex composite", "36 × 48 in", "White / White", "quantity", "stocked", 41700, 65900, 8, 24],
    ["prod-doublehung-3054", "PG-CLASSIC-3054", "PG3054DH", "Classic Double-Hung · 30 × 54", "Double-hung", "Vinyl", "30 × 54 in", "White", "quantity", "stocked", 29800, 47900, 6, 18],
    ["prod-slider-6048", "AWW-SS-6048", "SS6048", "Series 700 Slider · 60 × 48", "Slider", "Vinyl", "60 × 48 in", "Black / White", "quantity", "stocked", 53600, 81900, 5, 15],
    ["prod-awning-2436", "AW400-AWN-2436", "400AWN2436", "400 Series Awning · 24 × 36", "Awning", "Wood clad", "24 × 36 in", "Pine / Sandtone", "quantity", "stocked", 48200, 74900, 4, 12],
    ["prod-patio-6068", "PG-PATIO-6068", "PG6068PD", "Select Patio Door · 60 × 80", "Patio door", "Vinyl", "60 × 80 in", "White", "quantity", "stocked", 118500, 169900, 2, 6],
    ["prod-custom-413859", "CUSTOM-4138-5978", null, "Custom Casement · Kitchen W-03", "Custom casement", "Fiberglass", "41 3/8 × 59 7/8 in", "Oak / Black", "serial", "special_order", 88400, 132900, 0, 0],
  ];
  productRows.forEach((row) => push(
    `INSERT OR IGNORE INTO products
      (id, sku, manufacturer_sku, name, category, material, dimensions, finish, tracking_policy,
       inventory_policy, standard_cost_cents, selling_price_cents, reorder_point, max_stock_level, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ...row, now
  ));

  [
    ["loc-a01", "WH1-A-01", "Aisle A · Rack 01", "storage", "usable"],
    ["loc-b03", "WH1-B-03", "Aisle B · Rack 03", "storage", "usable"],
    ["loc-receiving", "WH1-RECV", "Receiving dock", "receiving", "usable"],
    ["loc-quarantine", "WH1-QA", "Quality quarantine", "quarantine", "quarantine"],
    ["loc-returns", "WH1-RET", "Customer returns", "returns", "quarantine"],
    ["loc-staging", "WH1-STAGE", "Outbound staging", "staging", "usable"],
  ].forEach((row) => push(
    "INSERT OR IGNORE INTO locations (id, code, name, location_type, inventory_status) VALUES (?, ?, ?, ?, ?)",
    ...row
  ));

  [
    ["po-1048", "PO-1048", "vendor-andersen", "approved", "partially_billed", addDays(-3), 1011600, "Maya Chen", 3, old],
    ["po-1051", "PO-1051", "vendor-plygem", "approved", "not_billed", addDays(6), 711000, "Maya Chen", 1, prior],
    ["po-1045", "PO-1045", "vendor-allweather", "approved", "fully_billed", addDays(-9), 643200, "Jon Bell", 4, old],
  ].forEach((row) => push(
    `INSERT OR IGNORE INTO purchase_orders
      (id, number, vendor_id, lifecycle_status, billing_status, expected_date, total_cents, buyer_name, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...row
  ));
  [
    ["pol-1048-1", "po-1048", "prod-casement-3648", 24, 0, 41700],
    ["pol-1051-1", "po-1051", "prod-patio-6068", 6, 0, 118500],
    ["pol-1045-1", "po-1045", "prod-slider-6048", 12, 4, 53600],
  ].forEach((row) => push(
    "INSERT OR IGNORE INTO purchase_order_lines (id, purchase_order_id, product_id, ordered_qty, closed_qty, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?)",
    ...row
  ));

  push("INSERT OR IGNORE INTO receipts (id, number, purchase_order_id, status, posted_at, version) VALUES (?, ?, ?, 'posted', ?, 1)", "receipt-1048-a", "RCV-2041", "po-1048", old);
  push("INSERT OR IGNORE INTO receipts (id, number, purchase_order_id, status, posted_at, version) VALUES (?, ?, ?, 'posted', ?, 1)", "receipt-1045-a", "RCV-2037", "po-1045", old);
  push("INSERT OR IGNORE INTO receipt_lines (id, receipt_id, purchase_order_line_id, product_id, location_id, quantity, condition) VALUES (?, ?, ?, ?, ?, ?, ?)", "rcl-1048-a", "receipt-1048-a", "pol-1048-1", "prod-casement-3648", "loc-a01", 24, "usable");
  push("INSERT OR IGNORE INTO receipt_lines (id, receipt_id, purchase_order_line_id, product_id, location_id, quantity, condition) VALUES (?, ?, ?, ?, ?, ?, ?)", "rcl-1045-a", "receipt-1045-a", "pol-1045-1", "prod-slider-6048", "loc-b03", 8, "usable");

  [
    ["so-2087", "SO-2087", "customer-ridgeview", "confirmed", "partially_invoiced", addDays(2), 659000, "Elena Rossi", 3, old],
    ["so-2092", "SO-2092", "customer-northstar", "confirmed", "not_invoiced", addDays(5), 287400, "Elena Rossi", 2, prior],
    ["so-2095", "SO-2095", "customer-copperstone", "confirmed", "not_invoiced", addDays(16), 132900, "Darren Lee", 1, now],
  ].forEach((row) => push(
    `INSERT OR IGNORE INTO sales_orders
      (id, number, customer_id, lifecycle_status, billing_status, requested_date, total_cents, owner_name, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...row
  ));
  [
    ["sol-2087-1", "so-2087", "prod-casement-3648", 10, 0, 65900, null],
    ["sol-2092-1", "so-2092", "prod-doublehung-3054", 6, 0, 47900, null],
    ["sol-2095-1", "so-2095", "prod-custom-413859", 1, 0, 132900, "{\"roomReference\":\"Kitchen W-03\",\"glass\":\"Low-E triple-pane\",\"handing\":\"Left\"}"],
  ].forEach((row) => push(
    "INSERT OR IGNORE INTO sales_order_lines (id, sales_order_id, product_id, ordered_qty, canceled_qty, unit_price_cents, configuration_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ...row
  ));
  push("INSERT OR IGNORE INTO reservations (id, sales_order_line_id, product_id, location_id, quantity, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)", "res-2087-a", "sol-2087-1", "prod-casement-3648", "loc-a01", 6, prior);
  push("INSERT OR IGNORE INTO reservations (id, sales_order_line_id, product_id, location_id, quantity, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)", "res-2092-a", "sol-2092-1", "prod-doublehung-3054", "loc-b03", 4, prior);
  push("INSERT OR IGNORE INTO shipments (id, number, sales_order_id, status, posted_at, version) VALUES (?, ?, ?, 'posted', ?, 1)", "shipment-2087-a", "SHP-3014", "so-2087", old);
  push("INSERT OR IGNORE INTO shipment_lines (id, shipment_id, sales_order_line_id, product_id, location_id, quantity) VALUES (?, ?, ?, ?, ?, ?)", "shl-2087-a", "shipment-2087-a", "sol-2087-1", "prod-casement-3648", "loc-a01", 4);

  const balances = [
    ["prod-casement-3648", "loc-a01", 20, 6],
    ["prod-casement-3648", "loc-quarantine", 2, 0],
    ["prod-doublehung-3054", "loc-b03", 8, 4],
    ["prod-slider-6048", "loc-b03", 8, 0],
    ["prod-awning-2436", "loc-a01", 4, 0],
    ["prod-patio-6068", "loc-a01", 2, 0],
    ["prod-custom-413859", "loc-quarantine", 1, 0],
  ];
  balances.forEach((row) => push(
    "INSERT OR IGNORE INTO inventory_balances (product_id, location_id, on_hand_qty, reserved_qty, version) VALUES (?, ?, ?, ?, 1)",
    ...row
  ));

  const movements = [
    ["mov-open-cas-q", "opening_balance", "prod-casement-3648", 2, null, "loc-quarantine", "quarantine", "opening_balance", "OPEN-001", null, null, null, null, old, "System import", 41700, "seed-open-cas-q"],
    ["mov-rcv-1048", "purchase_receipt", "prod-casement-3648", 24, null, "loc-a01", "usable", "receipt", "receipt-1048-a", "rcl-1048-a", "pol-1048-1", null, null, old, "Sam Rivera", 41700, "seed-rcv-1048"],
    ["mov-ship-2087", "sales_shipment", "prod-casement-3648", -4, "loc-a01", null, "usable", "shipment", "shipment-2087-a", "shl-2087-a", null, "sol-2087-1", null, old, "Nina Patel", 41700, "seed-ship-2087"],
    ["mov-open-dh", "opening_balance", "prod-doublehung-3054", 8, null, "loc-b03", "usable", "opening_balance", "OPEN-001", null, null, null, null, old, "System import", 29800, "seed-open-dh"],
    ["mov-rcv-1045", "purchase_receipt", "prod-slider-6048", 8, null, "loc-b03", "usable", "receipt", "receipt-1045-a", "rcl-1045-a", "pol-1045-1", null, null, old, "Sam Rivera", 53600, "seed-rcv-1045"],
    ["mov-open-awn", "opening_balance", "prod-awning-2436", 4, null, "loc-a01", "usable", "opening_balance", "OPEN-001", null, null, null, null, old, "System import", 48200, "seed-open-awn"],
    ["mov-open-patio", "opening_balance", "prod-patio-6068", 2, null, "loc-a01", "usable", "opening_balance", "OPEN-001", null, null, null, null, old, "System import", 118500, "seed-open-patio"],
    ["mov-open-custom", "opening_balance", "prod-custom-413859", 1, null, "loc-quarantine", "quarantine", "opening_balance", "OPEN-001", null, null, null, null, old, "System import", 88400, "seed-open-custom"],
  ];
  movements.forEach((row) => push(
    `INSERT OR IGNORE INTO stock_movements
      (id, movement_type, product_id, quantity, from_location_id, to_location_id, inventory_status,
       source_document_type, source_document_id, source_line_id, purchase_order_line_id, sales_order_line_id,
       reversal_of_movement_id, posted_at, posted_by, unit_cost_cents, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...row
  ));

  [
    ["bill-8871", "VB-8871", "vendor-andersen", "po-1048", "open", "matched", 1000800, addDays(22)],
    ["bill-8844", "VB-8844", "vendor-allweather", "po-1045", "paid", "matched", 643200, addDays(-2)],
    ["bill-8890", "VB-8890", "vendor-plygem", "po-1051", "on_hold", "price_exception", 728500, addDays(28)],
  ].forEach((row) => push(
    "INSERT OR IGNORE INTO vendor_bills (id, number, vendor_id, purchase_order_id, status, match_status, total_cents, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ...row
  ));
  [
    ["audit-seed-1", "purchase_order", "po-1048", "receipt_posted", "24 casement windows received into WH1-A-01", "Sam Rivera", old],
    ["audit-seed-2", "sales_order", "so-2087", "shipment_posted", "4 units shipped to Ridgeview Custom Homes", "Nina Patel", old],
    ["audit-seed-3", "purchase_order", "po-1045", "remainder_closed", "4 units closed short after vendor confirmation", "Jon Bell", prior],
    ["audit-seed-4", "vendor_bill", "bill-8890", "match_exception", "Vendor price is $175.00 above the purchase order", "System", now],
  ].forEach((row) => push(
    "INSERT OR IGNORE INTO audit_events (id, entity_type, entity_id, action, summary, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ...row
  ));

  await db.batch(seed.map(([sql, values]) => db.prepare(sql).bind(...values)));
  await db.prepare("PRAGMA optimize").run();
}

async function seedAdvancedDatabase(db: D1Database) {
  // Sample data is only for an empty database. Its rows reference the sample products and
  // partners, so injecting them into a database that already holds real master data fails
  // on a foreign key and takes every request down with it.
  const existing = await db.prepare("SELECT id FROM products LIMIT 1").first();
  if (existing) return;
  const now = new Date().toISOString();
  const statements = [
    db.prepare("INSERT OR IGNORE INTO warehouses (id, code, name, timezone, active) VALUES ('warehouse-main','YYC','Calgary Distribution Centre','America/Edmonton',1)"),
    db.prepare("INSERT OR IGNORE INTO warehouses (id, code, name, timezone, active) VALUES ('warehouse-north','YEG','Edmonton Cross-dock','America/Edmonton',1)"),
    db.prepare("INSERT OR IGNORE INTO units_of_measure (id, code, name, dimension, precision, active) VALUES ('uom-each','EA','Each','quantity',0,1)"),
    db.prepare("INSERT OR IGNORE INTO units_of_measure (id, code, name, dimension, precision, active) VALUES ('uom-crate','CRT','Crate','quantity',0,1)"),
    db.prepare("INSERT OR IGNORE INTO units_of_measure (id, code, name, dimension, precision, active) VALUES ('uom-square-foot','SQFT','Square foot','area',3,1)"),
    db.prepare("INSERT OR IGNORE INTO uom_conversions (id, product_id, from_uom_id, to_uom_id, numerator, denominator, rounding_mode) VALUES ('uomconv-cas-crate','prod-casement-3648','uom-crate','uom-each',6,1,'nearest')"),
    db.prepare("INSERT OR IGNORE INTO locations (id, code, name, location_type, inventory_status, warehouse_id, parent_location_id) VALUES ('loc-north-receiving','YEG-RECV','Edmonton receiving','receiving','usable','warehouse-north',NULL)"),
    db.prepare("INSERT OR IGNORE INTO locations (id, code, name, location_type, inventory_status, warehouse_id, parent_location_id) VALUES ('loc-interwarehouse-transit','TRANSIT-YYC-YEG','Calgary to Edmonton transit','in_transit','in_transit','warehouse-main',NULL)"),
    db.prepare("UPDATE locations SET warehouse_id='warehouse-main' WHERE warehouse_id IS NULL OR warehouse_id='warehouse-main'"),
    db.prepare("INSERT OR IGNORE INTO app_users (user_id, email, full_name, role, active, created_at, updated_at) VALUES ('local-dev', 'local@paneflow.dev', 'Local developer', 'administrator', 1, ?, ?)").bind(now, now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('receiving.overReceiptPolicy', ?, 'Percentage and absolute-quantity tolerance for receipts above ordered quantity.', 1, 'System', ?)").bind(JSON.stringify({ tolerancePct: 5, toleranceQuantity: 0 }), now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('inventory.negativeAllowed', 'false', 'Negative on-hand inventory is blocked by default.', 1, 'System', ?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('inventory.countApprovalThreshold', ?, 'Absolute inventory count variance thresholds requiring manager approval.', 1, 'System', ?)").bind(JSON.stringify({ absoluteQuantity: 5, absoluteValueCents: 100000 }), now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('inventory.scrapApprovalThresholdCents', '50000', 'Inventory value above which scrap requires manager approval.', 1, 'System', ?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('matching.tolerances', ?, 'Quantity, unit-price, total, and allowed-charge tolerances for three-way matching.', 1, 'System', ?)").bind(JSON.stringify({ quantity: 0, unitPriceCents: 2500, totalCents: 5000, allowedChargeKinds: ['freight', 'fuel_surcharge', 'environmental_fee'] }), now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('tax.defaultRateBps', '500', 'Default GST rate in basis points.', 1, 'System', ?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('security.defaultRole', ?, 'Least-privilege role assigned to authenticated users without an explicit mapping.', 1, 'System', ?)").bind(JSON.stringify('viewer'), now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('valuation.defaultMethod', ?, 'Default inventory valuation method for new products.', 1, 'System', ?)").bind(JSON.stringify('fifo'), now),
    db.prepare("INSERT OR IGNORE INTO period_locks (id, module, locked_through, reason, active, version, created_by, created_at) VALUES ('lock-accounting-jul26', 'accounting', '2026-07-31', 'July accounting close', 1, 1, 'System', ?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO returnable_asset_types (id, code, name, asset_class, unit_deposit_cents, active) VALUES ('asset-a-frame', 'AFRAME', 'Window transport A-frame', 'rack', 35000, 1)"),
    db.prepare("INSERT OR IGNORE INTO returnable_asset_types (id, code, name, asset_class, unit_deposit_cents, active) VALUES ('asset-pallet', 'PALLET', 'Reusable window pallet', 'pallet', 6500, 1)"),
    db.prepare("INSERT OR IGNORE INTO returnable_asset_types (id, code, name, asset_class, unit_deposit_cents, active) VALUES ('asset-glass-rack', 'GLASSRACK', 'Glazing transport rack', 'rack', 50000, 1)"),
    db.prepare("INSERT OR IGNORE INTO returnable_obligations (id, partner_id, asset_type_id, direction, issued_qty, returned_qty, forfeited_qty, deposit_charged_cents, deposit_refunded_cents, status, version, created_at) VALUES ('retobl-ridgeview-pallet', 'customer-ridgeview', 'asset-pallet', 'customer_holds', 4, 1, 0, 26000, 6500, 'open', 1, ?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO returnable_events (id, obligation_id, event_type, quantity, amount_cents, reason, posted_at, posted_by) VALUES ('retevt-ridgeview-issue', 'retobl-ridgeview-pallet', 'issue', 4, 26000, 'Delivery pallets issued with SO-2087', ?, 'Nina Patel')").bind(now),
    db.prepare("INSERT OR IGNORE INTO returnable_events (id, obligation_id, event_type, quantity, amount_cents, reason, posted_at, posted_by) VALUES ('retevt-ridgeview-return', 'retobl-ridgeview-pallet', 'return', 1, 6500, 'One pallet returned in good condition', ?, 'Nina Patel')").bind(now),
    db.prepare("INSERT OR IGNORE INTO inventory_lots (id, product_id, lot_number, vendor_id, manufactured_date, status, created_at) VALUES ('lot-cas-2607', 'prod-casement-3648', 'AND-2607-BC', 'vendor-andersen', '2026-07-18', 'active', ?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO inventory_units (id, product_id, serial_number, lot_id, location_id, inventory_status, lifecycle_status, allocated_sales_order_line_id, version, created_at) VALUES ('unit-custom-w03', 'prod-custom-413859', 'AWC-W03-2608117', NULL, 'loc-quarantine', 'quarantine', 'on_hand', 'sol-2095-1', 1, ?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO movement_assignments (id, movement_id, lot_id, inventory_unit_id, quantity) SELECT 'assign-custom-open', id, NULL, 'unit-custom-w03', 1 FROM stock_movements WHERE id='mov-open-custom'"),
    db.prepare("INSERT OR IGNORE INTO movement_assignments (id, movement_id, lot_id, inventory_unit_id, quantity) SELECT 'assign-cas-rcv', id, 'lot-cas-2607', NULL, quantity FROM stock_movements WHERE id='mov-rcv-1048'"),
    db.prepare("INSERT OR IGNORE INTO valuation_policies (product_id, method, standard_cost_cents, average_cost_cents, version, updated_at, updated_by) SELECT id, CASE WHEN inventory_policy='special_order' THEN 'standard' ELSE 'fifo' END, standard_cost_cents, standard_cost_cents, 1, ?, 'System' FROM products").bind(now),
    db.prepare("INSERT OR IGNORE INTO cost_layers (id, product_id, receipt_movement_id, received_qty, remaining_qty, unit_cost_cents, landed_cost_cents, received_at, status) SELECT 'layer-' || id, product_id, id, quantity, quantity, unit_cost_cents, 0, posted_at, 'open' FROM stock_movements WHERE movement_type IN ('purchase_receipt','opening_balance') AND quantity > 0").bind(),
    db.prepare("INSERT OR IGNORE INTO inventory_value_entries (id, product_id, movement_id, entry_type, quantity, unit_cost_cents, value_cents, cost_method, reference_type, reference_id, posted_at, posted_by) SELECT 'value-' || sm.id, sm.product_id, sm.id, CASE WHEN sm.movement_type='opening_balance' THEN 'opening_balance' ELSE 'receipt' END, sm.quantity, sm.unit_cost_cents, ROUND(sm.quantity*sm.unit_cost_cents), COALESCE(vp.method,'fifo'), sm.source_document_type, sm.source_document_id, sm.posted_at, sm.posted_by FROM stock_movements sm LEFT JOIN valuation_policies vp ON vp.product_id=sm.product_id WHERE sm.quantity > 0"),
    db.prepare("INSERT OR IGNORE INTO inventory_value_entries (id, product_id, movement_id, entry_type, quantity, unit_cost_cents, value_cents, cost_method, reference_type, reference_id, posted_at, posted_by) SELECT 'value-' || sm.id, sm.product_id, sm.id, 'shipment', sm.quantity, sm.unit_cost_cents, ROUND(sm.quantity*sm.unit_cost_cents), COALESCE(vp.method,'fifo'), sm.source_document_type, sm.source_document_id, sm.posted_at, sm.posted_by FROM stock_movements sm LEFT JOIN valuation_policies vp ON vp.product_id=sm.product_id WHERE sm.movement_type='sales_shipment' AND sm.quantity < 0"),
    db.prepare("UPDATE cost_layers SET remaining_qty=0,status='consumed' WHERE id='layer-mov-open-cas-q' AND EXISTS (SELECT 1 FROM inventory_value_entries WHERE id='value-mov-ship-2087')"),
    db.prepare("UPDATE cost_layers SET remaining_qty=22,status='open' WHERE id='layer-mov-rcv-1048' AND EXISTS (SELECT 1 FROM inventory_value_entries WHERE id='value-mov-ship-2087')"),
    db.prepare("INSERT OR IGNORE INTO purchase_order_revisions (id, purchase_order_id, revision_number, lifecycle_status, snapshot_json, reason, created_by, created_at) SELECT 'revision-' || id || '-1', id, 1, lifecycle_status, json_object('number',number,'vendorId',vendor_id,'expectedDate',expected_date,'totalCents',total_cents), 'Initial approved commitment', COALESCE(buyer_name,'System'), created_at FROM purchase_orders"),
    db.prepare("UPDATE purchase_orders SET base_total_cents=ROUND(total_cents*COALESCE(NULLIF(exchange_rate_to_base,0),1)) WHERE base_total_cents=0 AND total_cents<>0"),
    db.prepare("UPDATE sales_orders SET base_total_cents=ROUND(total_cents*COALESCE(NULLIF(exchange_rate_to_base,0),1)) WHERE base_total_cents=0 AND total_cents<>0"),
    db.prepare("UPDATE vendor_bills SET vendor_invoice_number=COALESCE(vendor_invoice_number, number), invoice_date=COALESCE(invoice_date, '2026-08-01'), posted_at=COALESCE(posted_at, ?), subtotal_cents=CASE WHEN subtotal_cents=0 THEN total_cents ELSE subtotal_cents END, base_total_cents=ROUND(total_cents*COALESCE(NULLIF(exchange_rate_to_base,0),1)) WHERE vendor_invoice_number IS NULL OR posted_at IS NULL OR (base_total_cents=0 AND total_cents<>0)").bind(now),
    db.prepare("INSERT OR IGNORE INTO vendor_bill_lines (id, vendor_bill_id, purchase_order_line_id, product_id, quantity, unit_cost_cents, line_total_cents, match_status, match_details_json) VALUES ('vbl-8871-1','bill-8871','pol-1048-1','prod-casement-3648',24,41700,1000800,'matched','{}')"),
    db.prepare("INSERT OR IGNORE INTO vendor_bill_lines (id, vendor_bill_id, purchase_order_line_id, product_id, quantity, unit_cost_cents, line_total_cents, match_status, match_details_json) VALUES ('vbl-8844-1','bill-8844','pol-1045-1','prod-slider-6048',12,53600,643200,'matched','{}')"),
    db.prepare("INSERT OR IGNORE INTO vendor_bill_lines (id, vendor_bill_id, purchase_order_line_id, product_id, quantity, unit_cost_cents, line_total_cents, match_status, match_details_json) VALUES ('vbl-8890-1','bill-8890','pol-1051-1','prod-patio-6068',6,121417,728502,'blocked',?)").bind(JSON.stringify({ exceptions: [{ code: 'BILL_BEFORE_RECEIPT', severity: 'blocking' }, { code: 'UNIT_PRICE_VARIANCE', severity: 'approval', varianceCents: 2917 }] })),
    db.prepare("INSERT OR IGNORE INTO document_charges (id, document_type, document_id, charge_type, description, amount_cents, direction, taxable, refundable, tax_code, created_at) VALUES ('charge-8890-freight','vendor_bill','bill-8890','freight','Inbound freight',18500,'add',1,0,'GST',?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO customer_invoices (id, number, customer_id, sales_order_id, status, invoice_date, due_date, subtotal_cents, tax_cents, total_cents, paid_cents, currency, posted_at, posted_by, version) VALUES ('invoice-5008','INV-5008','customer-ridgeview','so-2087','partially_paid','2026-08-01','2026-08-31',131800,6590,138390,70000,'CAD',?,'Morgan Liu',1)").bind(now),
    db.prepare("UPDATE customer_invoices SET base_total_cents=ROUND(total_cents*COALESCE(NULLIF(exchange_rate_to_base,0),1)) WHERE base_total_cents=0 AND total_cents<>0"),
    db.prepare("INSERT OR IGNORE INTO customer_invoice_lines (id, customer_invoice_id, sales_order_line_id, product_id, quantity, unit_price_cents, line_total_cents) VALUES ('cil-5008-1','invoice-5008','sol-2087-1','prod-casement-3648',2,65900,131800)"),
    db.prepare("INSERT OR IGNORE INTO payments (id, number, direction, partner_id, document_type, document_id, amount_cents, payment_date, method, reference, posted_at, posted_by) VALUES ('payment-7008','PAY-7008','inbound','customer-ridgeview','customer_invoice','invoice-5008',70000,'2026-08-06','eft','Ridgeview EFT 0806',?,'Morgan Liu')").bind(now),
    db.prepare("UPDATE payments SET base_amount_cents=ROUND(amount_cents*COALESCE(NULLIF(exchange_rate_to_base,0),1)) WHERE base_amount_cents=0 AND amount_cents<>0"),
  ];
  await db.batch(statements);
}

export async function ensureDatabase() {
  if (!ready) {
    ready = (async () => {
      const db = getD1();
      await db.prepare("SELECT source_sales_order_line_id FROM purchase_order_lines LIMIT 0").run();
      if (demoBootstrapEnabled()) {
        await seedDatabase(db);
        await seedAdvancedDatabase(db);
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

export function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Reserves the next number for a document prefix.
 *
 * Numbers are sequential and never reused: accounting, customer AP departments, and the
 * QuickBooks handoff all expect readable ascending document numbers, and a random suffix
 * cannot be dictated over the phone. The counter is bumped by a single atomic upsert, so
 * concurrent commands can never claim the same value. A command that fails after reserving
 * leaves a gap, which is the correct trade: a gap is auditable, a duplicate is not.
 */
export async function nextDocumentNumber(prefix: string) {
  const row = await first<{ nextValue: number }>(
    `INSERT INTO document_sequences (prefix, next_value, updated_at) VALUES (?, 1, ?)
     ON CONFLICT(prefix) DO UPDATE SET next_value = next_value + 1, updated_at = excluded.updated_at
     RETURNING next_value AS nextValue`,
    prefix,
    new Date().toISOString(),
  );
  const value = Number(row?.nextValue ?? 0);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Could not reserve a ${prefix} document number.`);
  return `${prefix}-${String(value).padStart(6, "0")}`;
}

export function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
