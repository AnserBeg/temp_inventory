import { env } from "cloudflare:workers";

type SqlValue = string | number | null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS business_partners (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    partner_type TEXT NOT NULL, email TEXT, phone TEXT, payment_terms TEXT,
    currency TEXT NOT NULL DEFAULT 'CAD', active INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, manufacturer_sku TEXT, name TEXT NOT NULL,
    category TEXT NOT NULL, material TEXT NOT NULL, dimensions TEXT NOT NULL, finish TEXT NOT NULL,
    tracking_policy TEXT NOT NULL DEFAULT 'quantity', inventory_policy TEXT NOT NULL DEFAULT 'stocked',
    standard_cost_cents INTEGER NOT NULL, selling_price_cents INTEGER NOT NULL,
    reorder_point REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    location_type TEXT NOT NULL, inventory_status TEXT NOT NULL DEFAULT 'usable',
    active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1
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
  `CREATE TABLE IF NOT EXISTS drop_ship_deliveries (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
    purchase_order_id TEXT NOT NULL, purchase_order_line_id TEXT NOT NULL,
    sales_order_id TEXT NOT NULL, sales_order_line_id TEXT NOT NULL, product_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0), reversed_qty REAL NOT NULL DEFAULT 0 CHECK(reversed_qty >= 0 AND reversed_qty <= quantity),
    status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','partially_reversed','reversed')),
    delivery_date TEXT NOT NULL, external_reference TEXT NOT NULL,
    posted_at TEXT NOT NULL, posted_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY(purchase_order_line_id) REFERENCES purchase_order_lines(id),
    FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id),
    FOREIGN KEY(sales_order_line_id) REFERENCES sales_order_lines(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
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
    response_json TEXT NOT NULL, request_hash TEXT, claim_token TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    summary TEXT NOT NULL, actor TEXT NOT NULL, actor_id TEXT, actor_email TEXT,
    metadata_json TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_users (
    user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer','operator','accounting','manager','administrator')),
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_order_revisions (
    id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
    lifecycle_status TEXT NOT NULL, snapshot_json TEXT NOT NULL, reason TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(purchase_order_id, revision_number), FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, description TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','canceled')),
    requested_by TEXT NOT NULL, requested_reason TEXT NOT NULL, requested_at TEXT NOT NULL,
    decided_by TEXT, decision_reason TEXT, decided_at TEXT,
    consumed_at TEXT, consumed_by TEXT, consumed_entity_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS period_locks (
    id TEXT PRIMARY KEY, module TEXT NOT NULL, locked_through TEXT NOT NULL, reason TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_lots (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, lot_number TEXT NOT NULL, vendor_id TEXT,
    manufactured_date TEXT, expiry_date TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
    UNIQUE(product_id, lot_number), FOREIGN KEY(product_id) REFERENCES products(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_units (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, serial_number TEXT NOT NULL, lot_id TEXT,
    location_id TEXT NOT NULL, inventory_status TEXT NOT NULL DEFAULT 'usable',
    lifecycle_status TEXT NOT NULL DEFAULT 'on_hand', allocated_sales_order_line_id TEXT,
    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
    UNIQUE(product_id, serial_number), FOREIGN KEY(product_id) REFERENCES products(id),
    FOREIGN KEY(lot_id) REFERENCES inventory_lots(id), FOREIGN KEY(location_id) REFERENCES locations(id)
  )`,
  `CREATE TABLE IF NOT EXISTS movement_assignments (
    id TEXT PRIMARY KEY, movement_id TEXT NOT NULL, lot_id TEXT, inventory_unit_id TEXT,
    quantity REAL NOT NULL CHECK(quantity > 0), FOREIGN KEY(movement_id) REFERENCES stock_movements(id),
    FOREIGN KEY(lot_id) REFERENCES inventory_lots(id), FOREIGN KEY(inventory_unit_id) REFERENCES inventory_units(id)
  )`,
  `CREATE TABLE IF NOT EXISTS document_charges (
    id TEXT PRIMARY KEY, document_type TEXT NOT NULL, document_id TEXT NOT NULL,
    charge_type TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
    direction TEXT NOT NULL DEFAULT 'add' CHECK(direction IN ('add','subtract')),
    taxable INTEGER NOT NULL DEFAULT 0, refundable INTEGER NOT NULL DEFAULT 0,
    tax_code TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_bill_lines (
    id TEXT PRIMARY KEY, vendor_bill_id TEXT NOT NULL, purchase_order_line_id TEXT, product_id TEXT,
    quantity REAL NOT NULL CHECK(quantity > 0), unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents >= 0),
    line_total_cents INTEGER NOT NULL, match_status TEXT NOT NULL, match_details_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY(vendor_bill_id) REFERENCES vendor_bills(id), FOREIGN KEY(purchase_order_line_id) REFERENCES purchase_order_lines(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_credits (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, vendor_id TEXT NOT NULL, vendor_bill_id TEXT,
    purchase_order_id TEXT, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'posted', posted_at TEXT NOT NULL, posted_by TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(vendor_bill_id) REFERENCES vendor_bills(id),
    FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_invoices (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, sales_order_id TEXT,
    status TEXT NOT NULL DEFAULT 'posted', invoice_date TEXT NOT NULL, due_date TEXT NOT NULL,
    subtotal_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL,
    paid_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CAD',
    posted_at TEXT NOT NULL, posted_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_invoice_lines (
    id TEXT PRIMARY KEY, customer_invoice_id TEXT NOT NULL, sales_order_line_id TEXT NOT NULL,
    product_id TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity > 0), unit_price_cents INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL, FOREIGN KEY(customer_invoice_id) REFERENCES customer_invoices(id),
    FOREIGN KEY(sales_order_line_id) REFERENCES sales_order_lines(id), FOREIGN KEY(product_id) REFERENCES products(id)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_credits (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, customer_invoice_id TEXT,
    sales_order_id TEXT, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'posted', posted_at TEXT NOT NULL, posted_by TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(customer_invoice_id) REFERENCES customer_invoices(id),
    FOREIGN KEY(sales_order_id) REFERENCES sales_orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, direction TEXT NOT NULL,
    partner_id TEXT NOT NULL, document_type TEXT NOT NULL, document_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), payment_date TEXT NOT NULL,
    method TEXT NOT NULL, reference TEXT, posted_at TEXT NOT NULL, posted_by TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS returnable_asset_types (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, asset_class TEXT NOT NULL,
    unit_deposit_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS returnable_obligations (
    id TEXT PRIMARY KEY, partner_id TEXT NOT NULL, asset_type_id TEXT NOT NULL,
    direction TEXT NOT NULL, issued_qty REAL NOT NULL DEFAULT 0, returned_qty REAL NOT NULL DEFAULT 0,
    forfeited_qty REAL NOT NULL DEFAULT 0, deposit_charged_cents INTEGER NOT NULL DEFAULT 0,
    deposit_refunded_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open',
    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
    FOREIGN KEY(asset_type_id) REFERENCES returnable_asset_types(id)
  )`,
  `CREATE TABLE IF NOT EXISTS returnable_events (
    id TEXT PRIMARY KEY, obligation_id TEXT NOT NULL, event_type TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity >= 0), amount_cents INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL, posted_at TEXT NOT NULL, posted_by TEXT NOT NULL,
    FOREIGN KEY(obligation_id) REFERENCES returnable_obligations(id)
  )`,
  `CREATE TABLE IF NOT EXISTS valuation_policies (
    product_id TEXT PRIMARY KEY, method TEXT NOT NULL DEFAULT 'fifo' CHECK(method IN ('fifo','average','standard')),
    standard_cost_cents INTEGER NOT NULL DEFAULT 0, average_cost_cents INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`,
  `CREATE TABLE IF NOT EXISTS cost_layers (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, receipt_movement_id TEXT,
    received_qty REAL NOT NULL CHECK(received_qty > 0), remaining_qty REAL NOT NULL CHECK(remaining_qty >= 0),
    unit_cost_cents INTEGER NOT NULL, landed_cost_cents INTEGER NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(receipt_movement_id) REFERENCES stock_movements(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_value_entries (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, movement_id TEXT, entry_type TEXT NOT NULL,
    quantity REAL NOT NULL, unit_cost_cents INTEGER NOT NULL, value_cents INTEGER NOT NULL,
    cost_method TEXT NOT NULL, reference_type TEXT NOT NULL, reference_id TEXT NOT NULL,
    posted_at TEXT NOT NULL, posted_by TEXT NOT NULL, FOREIGN KEY(product_id) REFERENCES products(id),
    FOREIGN KEY(movement_id) REFERENCES stock_movements(id)
  )`,
  `CREATE TABLE IF NOT EXISTS landed_cost_allocations (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, source_document_type TEXT NOT NULL,
    source_document_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    allocation_basis TEXT NOT NULL, posted_at TEXT NOT NULL, posted_by TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS landed_cost_allocation_lines (
    id TEXT PRIMARY KEY, allocation_id TEXT NOT NULL, cost_layer_id TEXT NOT NULL,
    allocated_cents INTEGER NOT NULL, FOREIGN KEY(allocation_id) REFERENCES landed_cost_allocations(id),
    FOREIGN KEY(cost_layer_id) REFERENCES cost_layers(id)
  )`,
  `CREATE TABLE IF NOT EXISTS outbox_events (
    id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL, payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','processed','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, locked_at TEXT,
    last_error TEXT, created_at TEXT NOT NULL, processed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY, document_type TEXT NOT NULL, document_id TEXT NOT NULL,
    file_name TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0), category TEXT NOT NULL DEFAULT 'document',
    owner_id TEXT NOT NULL, owner_email TEXT NOT NULL, uploaded_at TEXT NOT NULL,
    deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    timezone TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS units_of_measure (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    dimension TEXT NOT NULL DEFAULT 'quantity', precision INTEGER NOT NULL DEFAULT 3,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS uom_conversions (
    id TEXT PRIMARY KEY, product_id TEXT, from_uom_id TEXT NOT NULL, to_uom_id TEXT NOT NULL,
    numerator INTEGER NOT NULL CHECK(numerator > 0), denominator INTEGER NOT NULL CHECK(denominator > 0),
    rounding_mode TEXT NOT NULL DEFAULT 'nearest', UNIQUE(product_id, from_uom_id, to_uom_id),
    FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(from_uom_id) REFERENCES units_of_measure(id),
    FOREIGN KEY(to_uom_id) REFERENCES units_of_measure(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_transfers (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
    transfer_type TEXT NOT NULL CHECK(transfer_type IN ('intra_warehouse','inter_warehouse')),
    status TEXT NOT NULL DEFAULT 'posted', from_warehouse_id TEXT NOT NULL, to_warehouse_id TEXT NOT NULL,
    in_transit_location_id TEXT, posted_at TEXT NOT NULL, posted_by TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(from_warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY(to_warehouse_id) REFERENCES warehouses(id), FOREIGN KEY(in_transit_location_id) REFERENCES locations(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
    id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, product_id TEXT NOT NULL,
    from_location_id TEXT NOT NULL, to_location_id TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity > 0),
    lot_id TEXT, inventory_unit_id TEXT, FOREIGN KEY(transfer_id) REFERENCES inventory_transfers(id),
    FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(from_location_id) REFERENCES locations(id),
    FOREIGN KEY(to_location_id) REFERENCES locations(id), FOREIGN KEY(lot_id) REFERENCES inventory_lots(id),
    FOREIGN KEY(inventory_unit_id) REFERENCES inventory_units(id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_approvals_entity_status ON approvals(entity_type, entity_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_movement_assignments_movement ON movement_assignments(movement_id)",
  "CREATE INDEX IF NOT EXISTS idx_document_charges_document ON document_charges(document_type, document_id)",
  "CREATE INDEX IF NOT EXISTS idx_vendor_bill_lines_bill ON vendor_bill_lines(vendor_bill_id)",
  "CREATE INDEX IF NOT EXISTS idx_customer_invoice_lines_invoice ON customer_invoice_lines(customer_invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_returnable_obligations_partner_status ON returnable_obligations(partner_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_cost_layers_product_received ON cost_layers(product_id, received_at)",
  "CREATE INDEX IF NOT EXISTS idx_value_entries_product_posted ON inventory_value_entries(product_id, posted_at)",
  "CREATE INDEX IF NOT EXISTS idx_outbox_status_available ON outbox_events(status, available_at)",
  "CREATE INDEX IF NOT EXISTS idx_attachments_document ON attachments(document_type, document_id, deleted_at)",
  "CREATE INDEX IF NOT EXISTS idx_drop_ship_deliveries_purchase_line ON drop_ship_deliveries(purchase_order_line_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_drop_ship_deliveries_sales_line ON drop_ship_deliveries(sales_order_line_id, status)",
  `CREATE TRIGGER IF NOT EXISTS inventory_balances_nonnegative_insert
     BEFORE INSERT ON inventory_balances
     WHEN NEW.on_hand_qty < 0 OR NEW.reserved_qty < 0 OR NEW.reserved_qty > NEW.on_hand_qty
     BEGIN SELECT RAISE(ABORT, 'inventory balance invariant violated'); END`,
  `CREATE TRIGGER IF NOT EXISTS inventory_balances_nonnegative_update
     BEFORE UPDATE ON inventory_balances
     WHEN NEW.on_hand_qty < 0 OR NEW.reserved_qty < 0 OR NEW.reserved_qty > NEW.on_hand_qty
     BEGIN SELECT RAISE(ABORT, 'inventory balance invariant violated'); END`,
  `CREATE TRIGGER IF NOT EXISTS stock_movements_immutable_update
     BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS stock_movements_immutable_delete
     BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END`,
  "CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_status ON purchase_orders(vendor_id, lifecycle_status)",
  "CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_order ON purchase_order_lines(purchase_order_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_order_lines_source_sales_line ON purchase_order_lines(source_sales_order_line_id)",
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

function demoBootstrapEnabled() {
  const runtime = env as unknown as { BOOTSTRAP_DEMO_DATA?: string; ENVIRONMENT?: string };
  const explicit = runtime.BOOTSTRAP_DEMO_DATA?.toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  const nodeEnvironment = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
  return nodeEnvironment === "development" || runtime.ENVIRONMENT === "development";
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

async function seedAdvancedDatabase(db: D1Database) {
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
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('receiving.overReceiptPolicy', ?, 'Percentage tolerance and approval threshold for receipts above ordered quantity.', 1, 'System', ?)").bind(JSON.stringify({ tolerancePct: 5, approvalRequiredAbovePct: 0 }), now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('inventory.negativeAllowed', 'false', 'Negative on-hand inventory is blocked by default.', 1, 'System', ?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO system_settings (key, value_json, description, version, updated_by, updated_at) VALUES ('inventory.countApprovalThreshold', ?, 'Absolute inventory count variance thresholds requiring manager approval.', 1, 'System', ?)").bind(JSON.stringify({ absoluteQuantity: 5, absoluteValueCents: 100000 }), now),
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
    db.prepare("UPDATE vendor_bills SET vendor_invoice_number=COALESCE(vendor_invoice_number, number), invoice_date=COALESCE(invoice_date, '2026-08-01'), posted_at=COALESCE(posted_at, ?), subtotal_cents=CASE WHEN subtotal_cents=0 THEN total_cents ELSE subtotal_cents END WHERE vendor_invoice_number IS NULL OR posted_at IS NULL").bind(now),
    db.prepare("INSERT OR IGNORE INTO vendor_bill_lines (id, vendor_bill_id, purchase_order_line_id, product_id, quantity, unit_cost_cents, line_total_cents, match_status, match_details_json) VALUES ('vbl-8871-1','bill-8871','pol-1048-1','prod-casement-3648',24,41700,1000800,'matched','{}')"),
    db.prepare("INSERT OR IGNORE INTO vendor_bill_lines (id, vendor_bill_id, purchase_order_line_id, product_id, quantity, unit_cost_cents, line_total_cents, match_status, match_details_json) VALUES ('vbl-8844-1','bill-8844','pol-1045-1','prod-slider-6048',12,53600,643200,'matched','{}')"),
    db.prepare("INSERT OR IGNORE INTO vendor_bill_lines (id, vendor_bill_id, purchase_order_line_id, product_id, quantity, unit_cost_cents, line_total_cents, match_status, match_details_json) VALUES ('vbl-8890-1','bill-8890','pol-1051-1','prod-patio-6068',6,121417,728502,'blocked',?)").bind(JSON.stringify({ exceptions: [{ code: 'BILL_BEFORE_RECEIPT', severity: 'blocking' }, { code: 'UNIT_PRICE_VARIANCE', severity: 'approval', varianceCents: 2917 }] })),
    db.prepare("INSERT OR IGNORE INTO document_charges (id, document_type, document_id, charge_type, description, amount_cents, direction, taxable, refundable, tax_code, created_at) VALUES ('charge-8890-freight','vendor_bill','bill-8890','freight','Inbound freight',18500,'add',1,0,'GST',?)").bind(now),
    db.prepare("INSERT OR IGNORE INTO customer_invoices (id, number, customer_id, sales_order_id, status, invoice_date, due_date, subtotal_cents, tax_cents, total_cents, paid_cents, currency, posted_at, posted_by, version) VALUES ('invoice-5008','INV-5008','customer-ridgeview','so-2087','partially_paid','2026-08-01','2026-08-31',131800,6590,138390,70000,'CAD',?,'Morgan Liu',1)").bind(now),
    db.prepare("INSERT OR IGNORE INTO customer_invoice_lines (id, customer_invoice_id, sales_order_line_id, product_id, quantity, unit_price_cents, line_total_cents) VALUES ('cil-5008-1','invoice-5008','sol-2087-1','prod-casement-3648',2,65900,131800)"),
    db.prepare("INSERT OR IGNORE INTO payments (id, number, direction, partner_id, document_type, document_id, amount_cents, payment_date, method, reference, posted_at, posted_by) VALUES ('payment-7008','PAY-7008','inbound','customer-ridgeview','customer_invoice','invoice-5008',70000,'2026-08-06','eft','Ridgeview EFT 0806',?,'Morgan Liu')").bind(now),
  ];
  await db.batch(statements);
}

async function backfillOpeningValuation(db: D1Database) {
  const result = await db.prepare(`SELECT p.id AS productId,p.standard_cost_cents AS standardCost,
    COALESCE(vp.method,'fifo') AS method,COALESCE(SUM(ib.on_hand_qty),0) AS onHand
    FROM products p JOIN inventory_balances ib ON ib.product_id=p.id
    LEFT JOIN valuation_policies vp ON vp.product_id=p.id
    WHERE NOT EXISTS (SELECT 1 FROM cost_layers cl WHERE cl.product_id=p.id)
    GROUP BY p.id HAVING COALESCE(SUM(ib.on_hand_qty),0)>0`)
    .all<{ productId: string; standardCost: number; method: string; onHand: number }>();
  if (!result.results.length) return;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const row of result.results) {
    const layerId = `layer-migration-opening-${row.productId}`;
    const valueId = `value-migration-opening-${row.productId}`;
    const referenceId = `migration-opening-${row.productId}`;
    const valueCents = Math.round(row.onHand * row.standardCost);
    statements.push(
      db.prepare("INSERT OR IGNORE INTO valuation_policies (product_id,method,standard_cost_cents,average_cost_cents,version,updated_at,updated_by) VALUES (?,'fifo',?,?,1,?,'System migration')").bind(row.productId,row.standardCost,row.standardCost,now),
      db.prepare("INSERT OR IGNORE INTO cost_layers (id,product_id,receipt_movement_id,received_qty,remaining_qty,unit_cost_cents,landed_cost_cents,received_at,status) VALUES (?,?,NULL,?,?,?,?,?,'open')").bind(layerId,row.productId,row.onHand,row.onHand,row.standardCost,0,now),
      db.prepare("INSERT OR IGNORE INTO inventory_value_entries (id,product_id,movement_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by) VALUES (?,?,NULL,'migration_opening_balance',?,?,?,?,'system_migration',?,?,'System migration')").bind(valueId,row.productId,row.onHand,row.standardCost,valueCents,row.method,referenceId,now),
      db.prepare("INSERT OR IGNORE INTO audit_events (id,entity_type,entity_id,action,summary,actor,metadata_json,created_at) VALUES (?,'product',?,'opening_valuation_backfilled','Opening valuation reconstructed from existing on-hand during schema upgrade.','System migration',?,?)").bind(`audit-migration-opening-${row.productId}`,row.productId,JSON.stringify({quantity:row.onHand,unitCostCents:row.standardCost,valueCents,source:"existing_inventory_balances"}),now),
      db.prepare("INSERT OR IGNORE INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES (?,'valuation.opening_backfilled','product',?,?,'pending',0,?,?)").bind(`outbox-migration-opening-${row.productId}`,row.productId,JSON.stringify({quantity:row.onHand,valueCents,referenceId}),now,now),
    );
  }
  await db.batch(statements);
}

export async function ensureDatabase() {
  if (!ready) {
    ready = (async () => {
      const db = getD1();
      await db.batch(schemaStatements.map((sql) => db.prepare(sql)));
      await ensureColumn(db, "purchase_orders", "project_reference", "TEXT");
      await ensureColumn(db, "purchase_orders", "revision_number", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "purchase_orders", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1");
      await ensureColumn(db, "purchase_orders", "base_total_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "purchase_orders", "payment_terms", "TEXT");
      await ensureColumn(db, "purchase_orders", "due_date", "TEXT");
      await ensureColumn(db, "sales_orders", "project_reference", "TEXT");
      await ensureColumn(db, "sales_orders", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1");
      await ensureColumn(db, "sales_orders", "base_total_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "sales_orders", "payment_terms", "TEXT");
      await ensureColumn(db, "sales_orders", "due_date", "TEXT");
      await ensureColumn(db, "products", "base_uom_id", "TEXT NOT NULL DEFAULT 'uom-each'");
      await ensureColumn(db, "products", "purchase_uom_id", "TEXT NOT NULL DEFAULT 'uom-each'");
      await ensureColumn(db, "products", "sales_uom_id", "TEXT NOT NULL DEFAULT 'uom-each'");
      await ensureColumn(db, "business_partners", "payment_terms", "TEXT");
      await ensureColumn(db, "business_partners", "currency", "TEXT NOT NULL DEFAULT 'CAD'");
      await ensureColumn(db, "business_partners", "active", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "business_partners", "version", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "products", "version", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "locations", "warehouse_id", "TEXT NOT NULL DEFAULT 'warehouse-main'");
      await ensureColumn(db, "locations", "parent_location_id", "TEXT");
      await ensureColumn(db, "locations", "active", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "locations", "version", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "warehouses", "version", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "returnable_asset_types", "version", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "purchase_order_lines", "fulfillment_route", "TEXT NOT NULL DEFAULT 'stock'");
      await ensureColumn(db, "purchase_order_lines", "source_sales_order_line_id", "TEXT");
      await ensureColumn(db, "sales_order_lines", "fulfillment_route", "TEXT NOT NULL DEFAULT 'stock'");
      await ensureColumn(db, "sales_order_lines", "project_reference", "TEXT");
      await ensureColumn(db, "sales_order_lines", "linked_purchase_order_line_id", "TEXT");
      await ensureColumn(db, "sales_order_lines", "discount_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "sales_order_lines", "taxable", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "sales_order_lines", "tax_rate_bps", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "inventory_transfer_lines", "received_qty", "REAL NOT NULL DEFAULT 0");
      await ensureColumn(db, "stock_movements", "lot_id", "TEXT");
      await ensureColumn(db, "stock_movements", "inventory_unit_id", "TEXT");
      await ensureColumn(db, "vendor_bills", "vendor_invoice_number", "TEXT");
      await ensureColumn(db, "vendor_bills", "invoice_date", "TEXT");
      await ensureColumn(db, "vendor_bills", "posted_at", "TEXT");
      await ensureColumn(db, "vendor_bills", "subtotal_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "vendor_bills", "tax_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "vendor_bills", "paid_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "vendor_bills", "hold_reason", "TEXT");
      await ensureColumn(db, "vendor_bills", "approved_at", "TEXT");
      await ensureColumn(db, "vendor_bills", "approved_by", "TEXT");
      await ensureColumn(db, "vendor_bills", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1");
      await ensureColumn(db, "vendor_bills", "base_total_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "vendor_bills", "tax_rate_bps", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "vendor_bills", "tax_code", "TEXT");
      await ensureColumn(db, "vendor_bills", "payment_terms", "TEXT");
      await ensureColumn(db, "document_charges", "tax_rate_bps", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "document_charges", "tax_amount_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "vendor_credits", "currency", "TEXT NOT NULL DEFAULT 'CAD'");
      await ensureColumn(db, "vendor_credits", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1");
      await ensureColumn(db, "vendor_credits", "base_amount_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "customer_invoices", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1");
      await ensureColumn(db, "customer_invoices", "base_total_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "customer_invoices", "tax_rate_bps", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "customer_invoices", "tax_code", "TEXT");
      await ensureColumn(db, "customer_invoices", "payment_terms", "TEXT");
      await ensureColumn(db, "customer_credits", "currency", "TEXT NOT NULL DEFAULT 'CAD'");
      await ensureColumn(db, "customer_credits", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1");
      await ensureColumn(db, "customer_credits", "base_amount_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "payments", "currency", "TEXT NOT NULL DEFAULT 'CAD'");
      await ensureColumn(db, "payments", "exchange_rate_to_base", "REAL NOT NULL DEFAULT 1");
      await ensureColumn(db, "payments", "base_amount_cents", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "audit_events", "actor_id", "TEXT");
      await ensureColumn(db, "audit_events", "actor_email", "TEXT");
      await ensureColumn(db, "command_log", "request_hash", "TEXT");
      await ensureColumn(db, "command_log", "claim_token", "TEXT");
      await ensureColumn(db, "app_users", "version", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "approvals", "consumed_at", "TEXT");
      await ensureColumn(db, "approvals", "consumed_by", "TEXT");
      await ensureColumn(db, "approvals", "consumed_entity_id", "TEXT");
      await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_bills_vendor_invoice ON vendor_bills(vendor_id, vendor_invoice_number)").run();
      if (demoBootstrapEnabled()) {
        await seedDatabase(db);
        await seedAdvancedDatabase(db);
      }
      await backfillOpeningValuation(db);
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
