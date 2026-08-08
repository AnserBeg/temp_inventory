import { env } from "cloudflare:workers";

type SqlValue = string | number | null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS business_partners (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    partner_type TEXT NOT NULL, email TEXT, phone TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, manufacturer_sku TEXT, name TEXT NOT NULL,
    category TEXT NOT NULL, material TEXT NOT NULL, dimensions TEXT NOT NULL, finish TEXT NOT NULL,
    tracking_policy TEXT NOT NULL DEFAULT 'quantity', inventory_policy TEXT NOT NULL DEFAULT 'stocked',
    standard_cost_cents INTEGER NOT NULL, selling_price_cents INTEGER NOT NULL,
    reorder_point REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    location_type TEXT NOT NULL, inventory_status TEXT NOT NULL DEFAULT 'usable'
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, vendor_id TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL DEFAULT 'approved', billing_status TEXT NOT NULL DEFAULT 'not_billed',
    expected_date TEXT, currency TEXT NOT NULL DEFAULT 'CAD', total_cents INTEGER NOT NULL,
    buyer_name TEXT, project_reference TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL, product_id TEXT NOT NULL,
    ordered_qty REAL NOT NULL, closed_qty REAL NOT NULL DEFAULT 0,
    unit_cost_cents INTEGER NOT NULL, configuration_snapshot TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, purchase_order_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'posted', posted_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS receipt_lines (
    id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, purchase_order_line_id TEXT NOT NULL,
    product_id TEXT NOT NULL, location_id TEXT NOT NULL, quantity REAL NOT NULL,
    condition TEXT NOT NULL DEFAULT 'usable'
  )`,
  `CREATE TABLE IF NOT EXISTS sales_orders (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL DEFAULT 'confirmed', billing_status TEXT NOT NULL DEFAULT 'not_invoiced',
    requested_date TEXT, currency TEXT NOT NULL DEFAULT 'CAD', total_cents INTEGER NOT NULL,
    owner_name TEXT, project_reference TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sales_order_lines (
    id TEXT PRIMARY KEY, sales_order_id TEXT NOT NULL, product_id TEXT NOT NULL,
    ordered_qty REAL NOT NULL, canceled_qty REAL NOT NULL DEFAULT 0,
    unit_price_cents INTEGER NOT NULL, configuration_snapshot TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY, sales_order_line_id TEXT NOT NULL, product_id TEXT NOT NULL,
    location_id TEXT NOT NULL, quantity REAL NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS shipments (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, sales_order_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'posted', posted_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS shipment_lines (
    id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL, sales_order_line_id TEXT NOT NULL,
    product_id TEXT NOT NULL, location_id TEXT NOT NULL, quantity REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_returns (
    id TEXT PRIMARY KEY, number TEXT NOT NULL, purchase_order_id TEXT NOT NULL,
    purchase_order_line_id TEXT NOT NULL, product_id TEXT NOT NULL, location_id TEXT NOT NULL,
    quantity REAL NOT NULL, disposition TEXT NOT NULL, posted_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS customer_returns (
    id TEXT PRIMARY KEY, number TEXT NOT NULL, sales_order_id TEXT NOT NULL,
    sales_order_line_id TEXT NOT NULL, product_id TEXT NOT NULL, location_id TEXT NOT NULL,
    quantity REAL NOT NULL, condition TEXT NOT NULL, financial_resolution TEXT NOT NULL DEFAULT 'pending',
    posted_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY, movement_type TEXT NOT NULL, product_id TEXT NOT NULL, quantity REAL NOT NULL,
    from_location_id TEXT, to_location_id TEXT, inventory_status TEXT NOT NULL,
    source_document_type TEXT NOT NULL, source_document_id TEXT NOT NULL, source_line_id TEXT,
    purchase_order_line_id TEXT, sales_order_line_id TEXT, reversal_of_movement_id TEXT,
    posted_at TEXT NOT NULL, posted_by TEXT NOT NULL, unit_cost_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'CAD', idempotency_key TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_balances (
    product_id TEXT NOT NULL, location_id TEXT NOT NULL, on_hand_qty REAL NOT NULL DEFAULT 0,
    reserved_qty REAL NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (product_id, location_id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_counts (
    id TEXT PRIMARY KEY, number TEXT NOT NULL, product_id TEXT NOT NULL, location_id TEXT NOT NULL,
    recorded_qty REAL NOT NULL, counted_qty REAL NOT NULL, variance_qty REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'posted', reason TEXT NOT NULL, counted_at TEXT NOT NULL,
    counted_by TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_bills (
    id TEXT PRIMARY KEY, number TEXT NOT NULL, vendor_id TEXT NOT NULL, purchase_order_id TEXT,
    status TEXT NOT NULL, match_status TEXT NOT NULL, total_cents INTEGER NOT NULL,
    due_date TEXT, currency TEXT NOT NULL DEFAULT 'CAD', version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS command_log (
    idempotency_key TEXT PRIMARY KEY, command TEXT NOT NULL, entity_id TEXT NOT NULL,
    response_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    summary TEXT NOT NULL, actor TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_status ON purchase_orders(vendor_id, lifecycle_status)",
  "CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_order ON purchase_order_lines(purchase_order_id)",
  "CREATE INDEX IF NOT EXISTS idx_receipts_purchase_order ON receipts(purchase_order_id)",
  "CREATE INDEX IF NOT EXISTS idx_receipt_lines_receipt ON receipt_lines(receipt_id)",
  "CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_status ON sales_orders(customer_id, lifecycle_status)",
  "CREATE INDEX IF NOT EXISTS idx_sales_order_lines_order ON sales_order_lines(sales_order_id)",
  "CREATE INDEX IF NOT EXISTS idx_reservations_line_status ON reservations(sales_order_line_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_reservations_product_location_status ON reservations(product_id, location_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_shipments_sales_order ON shipments(sales_order_id)",
  "CREATE INDEX IF NOT EXISTS idx_shipment_lines_shipment ON shipment_lines(shipment_id)",
  "CREATE INDEX IF NOT EXISTS idx_stock_movements_product_posted ON stock_movements(product_id, posted_at)",
  "CREATE INDEX IF NOT EXISTS idx_stock_movements_po_line ON stock_movements(purchase_order_line_id)",
  "CREATE INDEX IF NOT EXISTS idx_stock_movements_so_line ON stock_movements(sales_order_line_id)",
  "CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(source_document_type, source_document_id)",
  "CREATE INDEX IF NOT EXISTS idx_stock_movements_reversal ON stock_movements(reversal_of_movement_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_events_entity_created ON audit_events(entity_type, entity_id, created_at)",
] as const;

let ready: Promise<void> | undefined;

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable. The logical D1 binding must be configured as DB.");
  }
  return env.DB;
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
    ["prod-casement-3648", "AW100-CAS-3648-L", "100CAS3648L", "100 Series Casement · 36 × 48", "Casement", "Fibrex composite", "36 × 48 in", "White / White", "quantity", "stocked", 41700, 65900, 8],
    ["prod-doublehung-3054", "PG-CLASSIC-3054", "PG3054DH", "Classic Double-Hung · 30 × 54", "Double-hung", "Vinyl", "30 × 54 in", "White", "quantity", "stocked", 29800, 47900, 6],
    ["prod-slider-6048", "AWW-SS-6048", "SS6048", "Series 700 Slider · 60 × 48", "Slider", "Vinyl", "60 × 48 in", "Black / White", "quantity", "stocked", 53600, 81900, 5],
    ["prod-awning-2436", "AW400-AWN-2436", "400AWN2436", "400 Series Awning · 24 × 36", "Awning", "Wood clad", "24 × 36 in", "Pine / Sandtone", "quantity", "stocked", 48200, 74900, 4],
    ["prod-patio-6068", "PG-PATIO-6068", "PG6068PD", "Select Patio Door · 60 × 80", "Patio door", "Vinyl", "60 × 80 in", "White", "quantity", "stocked", 118500, 169900, 2],
    ["prod-custom-413859", "CUSTOM-4138-5978", null, "Custom Casement · Kitchen W-03", "Custom casement", "Fiberglass", "41 3/8 × 59 7/8 in", "Oak / Black", "serial", "special_order", 88400, 132900, 0],
  ];
  productRows.forEach((row) => push(
    `INSERT OR IGNORE INTO products
      (id, sku, manufacturer_sku, name, category, material, dimensions, finish, tracking_policy,
       inventory_policy, standard_cost_cents, selling_price_cents, reorder_point, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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

async function ensureColumn(db: D1Database, table: string, column: string, definition: string) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!info.results.some((item) => item.name === column)) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export async function ensureDatabase() {
  if (!ready) {
    ready = (async () => {
      const db = getD1();
      await db.batch(schemaStatements.map((sql) => db.prepare(sql)));
      await ensureColumn(db, "purchase_orders", "project_reference", "TEXT");
      await ensureColumn(db, "sales_orders", "project_reference", "TEXT");
      await seedDatabase(db);
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

export function documentNumber(prefix: string) {
  return `${prefix}-${Date.now().toString().slice(-7)}`;
}

export function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
