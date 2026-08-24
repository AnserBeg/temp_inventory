import { performance } from "node:perf_hooks";
import { readFile, readdir } from "node:fs/promises";

import { env } from "../tests/cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "../tests/d1-sqlite.mjs";

const scale = Math.max(1, Number(process.env.PANEFLOW_BENCH_SCALE ?? 1_000));
const db = new D1SqliteDatabase();

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

function seedScaledFixture() {
  db.exec(`
    INSERT INTO business_partners (id,code,name,partner_type,created_at)
      VALUES ('bench-vendor','BENCH-V','Benchmark Vendor','vendor','2026-01-01T00:00:00Z'),
             ('bench-customer','BENCH-C','Benchmark Customer','customer','2026-01-01T00:00:00Z');
    INSERT INTO products (id,sku,name,category,material,dimensions,finish,standard_cost_cents,selling_price_cents,created_at)
      VALUES ('bench-product','BENCH-SKU','Benchmark Window','Window','Vinyl','36 x 48','White',10000,16000,'2026-01-01T00:00:00Z');
    INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
      VALUES ('bench-product','loc-a01',1000000,0,1);
    CREATE TEMP TABLE bench_sequence (n INTEGER PRIMARY KEY);
    WITH digits(n) AS (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9))
      INSERT INTO bench_sequence(n)
      SELECT ones.n + tens.n*10 + hundreds.n*100 + thousands.n*1000 + 1
      FROM digits ones CROSS JOIN digits tens CROSS JOIN digits hundreds CROSS JOIN digits thousands
      WHERE ones.n + tens.n*10 + hundreds.n*100 + thousands.n*1000 < ${scale};

    INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,total_cents,base_total_cents,created_at)
      SELECT printf('bench-po-%06d',n),printf('BENCH-PO-%06d',n),'bench-vendor','approved',
             CASE WHEN n%3=0 THEN 'fully_billed' WHEN n%3=1 THEN 'partially_billed' ELSE 'not_billed' END,
             date('2026-09-01',printf('+%d days',n%30)),100000,100000,'2026-01-01T00:00:00Z'
      FROM bench_sequence;
    INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,closed_qty,unit_cost_cents)
      SELECT printf('bench-pol-%06d',n),printf('bench-po-%06d',n),'bench-product',10,0,10000 FROM bench_sequence;
    INSERT INTO stock_movements (id,movement_type,product_id,quantity,to_location_id,inventory_status,source_document_type,source_document_id,purchase_order_line_id,posted_at,posted_by,idempotency_key)
      SELECT printf('bench-receipt-movement-%06d',n),'purchase_receipt','bench-product',5,'loc-a01','usable','receipt',
             printf('bench-receipt-%06d',n),printf('bench-pol-%06d',n),'2026-02-01T00:00:00Z','Benchmark',printf('bench-po-movement-%06d',n)
      FROM bench_sequence WHERE n%2=0;

    INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,total_cents,base_total_cents,created_at)
      SELECT printf('bench-so-%06d',n),printf('BENCH-SO-%06d',n),'bench-customer','confirmed',
             CASE WHEN n%2=0 THEN 'partially_invoiced' ELSE 'not_invoiced' END,
             date('2026-09-01',printf('+%d days',n%30)),160000,160000,'2026-01-01T00:00:00Z'
      FROM bench_sequence;
    INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,canceled_qty,unit_price_cents)
      SELECT printf('bench-sol-%06d',n),printf('bench-so-%06d',n),'bench-product',10,0,16000 FROM bench_sequence;
    INSERT INTO stock_movements (id,movement_type,product_id,quantity,from_location_id,inventory_status,source_document_type,source_document_id,sales_order_line_id,posted_at,posted_by,idempotency_key)
      SELECT printf('bench-shipment-movement-%06d',n),'sales_shipment','bench-product',-4,'loc-a01','usable','shipment',
             printf('bench-shipment-%06d',n),printf('bench-sol-%06d',n),'2026-03-01T00:00:00Z','Benchmark',printf('bench-so-movement-%06d',n)
      FROM bench_sequence WHERE n%2=0;
    INSERT INTO reservations (id,sales_order_line_id,product_id,location_id,quantity,status,created_at)
      SELECT printf('bench-reservation-%06d',n),printf('bench-sol-%06d',n),'bench-product','loc-a01',3,'active','2026-03-01T00:00:00Z'
      FROM bench_sequence WHERE n%2=1;

    INSERT INTO vendor_bills (id,number,vendor_invoice_number,vendor_id,purchase_order_id,status,match_status,invoice_date,due_date,subtotal_cents,total_cents,base_total_cents,posted_at)
      SELECT printf('bench-bill-%06d',n),printf('BENCH-BILL-%06d',n),printf('BENCH-VENDOR-%06d',n),'bench-vendor',printf('bench-po-%06d',n),
             CASE WHEN n%4=0 THEN 'paid' ELSE 'open' END,CASE WHEN n%5=0 THEN 'exception' ELSE 'matched' END,
             '2026-04-01',date('2026-05-01',printf('+%d days',n%30)),50000,50000,50000,'2026-04-01T00:00:00Z'
      FROM bench_sequence;
    INSERT INTO vendor_bill_lines (id,vendor_bill_id,purchase_order_line_id,product_id,quantity,unit_cost_cents,line_total_cents,match_status)
      SELECT printf('bench-vbl-%06d',n),printf('bench-bill-%06d',n),printf('bench-pol-%06d',n),'bench-product',5,10000,50000,'matched'
      FROM bench_sequence;

    INSERT INTO customer_invoices (id,number,customer_id,sales_order_id,status,invoice_date,due_date,subtotal_cents,total_cents,base_total_cents,posted_at,posted_by)
      SELECT printf('bench-invoice-%06d',n),printf('BENCH-INV-%06d',n),'bench-customer',printf('bench-so-%06d',n),'posted',
             '2026-04-01','2026-05-01',64000,64000,64000,'2026-04-01T00:00:00Z','Benchmark'
      FROM bench_sequence WHERE n%2=0;
    INSERT INTO customer_invoice_lines (id,customer_invoice_id,sales_order_line_id,product_id,quantity,unit_price_cents,line_total_cents)
      SELECT printf('bench-cil-%06d',n),printf('bench-invoice-%06d',n),printf('bench-sol-%06d',n),'bench-product',4,16000,64000
      FROM bench_sequence WHERE n%2=0;
    INSERT INTO payments (id,number,direction,partner_id,document_type,document_id,amount_cents,payment_date,method,posted_at,posted_by,base_amount_cents)
      SELECT printf('bench-payment-%06d',n),printf('BENCH-PAY-%06d',n),'inbound','bench-customer','customer_invoice',
             printf('bench-invoice-%06d',n),1000,'2026-04-15','electronic','2026-04-15T00:00:00Z','Benchmark',1000
      FROM bench_sequence WHERE n%10=0;
    INSERT INTO customer_credits (id,number,customer_id,customer_invoice_id,sales_order_id,amount_cents,reason,status,posted_at,posted_by,base_amount_cents)
      SELECT printf('bench-customer-credit-%06d',n),printf('BENCH-CC-%06d',n),'bench-customer',printf('bench-invoice-%06d',n),
             printf('bench-so-%06d',n),500,'Benchmark credit','posted','2026-04-20T00:00:00Z','Benchmark',500
      FROM bench_sequence WHERE n%20=0;
    INSERT INTO vendor_credits (id,number,vendor_id,vendor_bill_id,purchase_order_id,amount_cents,reason,status,posted_at,posted_by,base_amount_cents)
      SELECT printf('bench-vendor-credit-%06d',n),printf('BENCH-VC-%06d',n),'bench-vendor',printf('bench-bill-%06d',n),
             printf('bench-po-%06d',n),500,'Benchmark credit','posted','2026-04-20T00:00:00Z','Benchmark',500
      FROM bench_sequence WHERE n%20=0;
    PRAGMA optimize;
  `);
}

async function time(label, operation) {
  const started = performance.now();
  const result = await operation();
  const durationMs = performance.now() - started;
  return { label, durationMs: Math.round(durationMs * 10) / 10, rows: result };
}

try {
  await applyMigrations();
  env.DB = db;
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  env.BOOTSTRAP_DEMO_DATA = "true";
  const inventoryDb = await import("../lib/server/inventory-db.ts");
  const inventoryDomain = await import("../lib/server/inventory-domain.ts");
  const advancedDomain = await import("../lib/server/advanced-domain.ts");
  const reports = await import("../lib/server/reports.ts");
  await inventoryDb.ensureDatabase();
  seedScaledFixture();

  const queryTimings = [];
  const originalPrepare = db.prepare.bind(db);
  const wrapStatement = (statement, sql) => ({
    bind: (...values) => wrapStatement(statement.bind(...values), sql),
    execute: () => statement.execute(),
    run: () => statement.run(),
    raw: (options) => statement.raw(options),
    first: (columnName) => {
      const started = performance.now();
      try { return statement.first(columnName); }
      finally { queryTimings.push({ sql, durationMs: performance.now() - started }); }
    },
    all: () => {
      const started = performance.now();
      try { return statement.all(); }
      finally { queryTimings.push({ sql, durationMs: performance.now() - started }); }
    },
  });
  db.prepare = (sql) => wrapStatement(originalPrepare(sql), sql);

  const scopes = [
    "home", "purchase-orders", "expected-receipts", "vendor-returns", "sales-orders",
    "fulfillment", "customer-returns", "customer-invoices", "stock", "products", "counts",
    "movements", "vendor-bills", "partners", "reports", "warehouse",
  ];
  const timings = [];
  let aggregatePlan;
  for (const scope of scopes) {
    queryTimings.length = 0;
    timings.push(await time(scope, async () => {
      const snapshot = await inventoryDomain.getInventorySnapshot({ scope, page: 1, pageSize: 50 });
      return {
        rows: snapshot.purchaseOrders.length + snapshot.salesOrders.length + snapshot.bills.length + snapshot.products.length + snapshot.movements.length,
        slowestQueries: [...queryTimings]
          .sort((left, right) => right.durationMs - left.durationMs)
          .slice(0, 4)
          .map((entry) => ({
            durationMs: Math.round(entry.durationMs * 10) / 10,
            sql: entry.sql.replace(/\s+/g, " ").trim().slice(0, 120),
          })),
      };
    }));
    if (!aggregatePlan && process.env.PANEFLOW_BENCH_PLAN === "true") {
      const aggregateSql = queryTimings.find((entry) => entry.sql.trimStart().startsWith("WITH po_line_state AS"))?.sql;
      if (aggregateSql) aggregatePlan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${aggregateSql}`).all("", "");
    }
  }
  const workflowTimings = [];
  for (const scope of ["purchasing", "sales", "inventory", "vendor-billing", "customer-billing", "controls"]) {
    queryTimings.length = 0;
    workflowTimings.push(await time(scope, async () => {
      const result = await advancedDomain.getWorkflowSnapshot(undefined, { scope, page: 1, pageSize: 100 });
      const advanced = result.advanced;
      return {
        rows: Object.values(advanced).filter(Array.isArray).reduce((sum, rows) => sum + rows.length, 0),
        slowestQueries: [...queryTimings]
          .sort((left, right) => right.durationMs - left.durationMs)
          .slice(0, 4)
          .map((entry) => ({ durationMs: Math.round(entry.durationMs * 10) / 10, sql: entry.sql.replace(/\s+/g, " ").trim().slice(0, 120) })),
      };
    }));
  }
  const reportTimings = [];
  for (const [label, operation] of [
    ["ar-aging", () => reports.arAging("2026-12-31")],
    ["customer-statement", () => reports.customerStatement("bench-customer", "2026-12-31")],
    ["open-orders", () => reports.openOrdersByCustomer()],
    ["replenishment", () => reports.replenishmentWorklist("")],
  ]) {
    reportTimings.push(await time(label, async () => (await operation()).rows.length));
  }
  const compactTiming = ({ label, durationMs, rows }) => ({
    label,
    durationMs,
    rows: typeof rows === "number" ? rows : rows?.rows,
  });
  const output = process.env.PANEFLOW_BENCH_COMPACT === "true"
    ? {
        scale,
        timings: timings.map(compactTiming),
        workflowTimings: workflowTimings.map(compactTiming),
        reportTimings: reportTimings.map(compactTiming),
      }
    : { scale, timings, workflowTimings, reportTimings, ...(aggregatePlan ? { aggregatePlan } : {}) };
  console.log(JSON.stringify(output, null, 2));
} finally {
  db.close();
}
