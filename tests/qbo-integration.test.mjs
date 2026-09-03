import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let qboClient;
let qboCrypto;
let qboAdmin;
let qboSync;
let qboWebhook;

async function applyMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
  }
}

function run(sql, ...values) { return db.prepare(sql).bind(...values).run(); }

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  env.BOOTSTRAP_DEMO_DATA = "false";
  env.QBO_CLIENT_ID = "qbo-test-client";
  env.QBO_CLIENT_SECRET = "qbo-test-secret";
  env.QBO_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  env.QBO_REDIRECT_URI = "https://paneflow.example.test/api/integrations/qbo/callback";
  env.QBO_WEBHOOK_VERIFIER_TOKEN = "webhook-test-verifier";
  qboClient = await import("../lib/server/qbo-client.ts");
  qboCrypto = await import("../lib/server/qbo-crypto.ts");
  qboAdmin = await import("../lib/server/qbo-admin.ts");
  qboSync = await import("../lib/server/qbo-sync.ts");
  qboWebhook = await import("../lib/server/qbo-webhook.ts");
});

after(() => db.close());

test("QBO migration tables and constraints boot on a clean database", () => {
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'qbo_%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, [
    "qbo_account_mappings", "qbo_connections", "qbo_entity_links", "qbo_oauth_states", "qbo_reconciliation_runs",
    "qbo_reference_mappings", "qbo_sync_cursors", "qbo_sync_deliveries", "qbo_webhook_events",
  ]);
  assert.throws(() => db.sqlite.prepare("INSERT INTO qbo_connections (id,realm_id,environment,status,company_name,country,home_currency,scopes,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,sync_from,initial_sync_status,connected_by,connected_at,updated_at) VALUES ('bad','bad','live','connected','Bad','CA','CAD','scope','a','b','2099-01-01','2026-01-01','queued','test','2026-01-01','2026-01-01')").run(), /CHECK constraint failed/);
});

test("QBO configuration status reports credential presence separately from OAuth readiness", () => {
  const requestUrl = "https://paneflow.example.test/api/integrations/qbo";
  const ready = qboClient.qboConfigurationStatus(requestUrl);
  assert.equal(ready.configured, true);
  assert.equal(ready.credentialsConfigured, true);
  assert.equal(ready.tokenEncryptionConfigured, true);
  assert.deepEqual(ready.missing, []);
  assert.equal(ready.message, "QuickBooks credentials and OAuth settings are ready.");
  assert.equal(ready.redirectUri, "https://paneflow.example.test/api/integrations/qbo/callback");
  assert.equal(ready.expectedRedirectUri, ready.redirectUri);
  assert.equal(ready.redirectMatchesSite, true);
  assert.equal(ready.webhookConfigured, true);

  const encryptionKey = env.QBO_TOKEN_ENCRYPTION_KEY;
  const redirectUri = env.QBO_REDIRECT_URI;
  try {
    delete env.QBO_TOKEN_ENCRYPTION_KEY;
    const incomplete = qboClient.qboConfigurationStatus(requestUrl);
    assert.equal(incomplete.configured, false);
    assert.equal(incomplete.credentialsConfigured, true);
    assert.equal(incomplete.tokenEncryptionConfigured, false);
    assert.deepEqual(incomplete.missing, ["QBO_TOKEN_ENCRYPTION_KEY"]);
    assert.match(incomplete.message, /credentials are present/);

    env.QBO_TOKEN_ENCRYPTION_KEY = encryptionKey;
    env.QBO_REDIRECT_URI = "https://different.example.test/api/integrations/qbo/callback";
    assert.throws(() => qboClient.qboConfig(requestUrl), /must exactly match/);
    const mismatchedCallback = qboClient.qboConfigurationStatus(requestUrl);
    assert.equal(mismatchedCallback.configured, false);
    assert.equal(mismatchedCallback.credentialsConfigured, true);
    assert.deepEqual(mismatchedCallback.missing, ["QBO_REDIRECT_URI"]);
    assert.match(mismatchedCallback.message, /credentials are present/);
  } finally {
    env.QBO_TOKEN_ENCRYPTION_KEY = encryptionKey;
    env.QBO_REDIRECT_URI = redirectUri;
  }
});

test("QBO company-connection UI shows credentials present before full OAuth readiness", async () => {
  const source = await readFile(new URL("../app/components/operations-suite.tsx", import.meta.url), "utf8");
  assert.match(source, /credentialsReady \? "Credentials present"/);
  assert.match(source, /status=\{credentialsReady \? "complete" : "action"\}/);
  assert.match(source, /credentialsReady \? "Credentials present — finish OAuth setup"/);
});

test("OAuth state is one-use and QBO tokens are encrypted at rest", async () => {
  const actor = { id: "admin-qbo", email: "admin@example.test", name: "Admin", role: "administrator", label: "Admin <admin@example.test>", localDevelopment: false };
  const authorization = await qboClient.createQboAuthorizationUrl(actor, "https://paneflow.example.test/api/integrations/qbo/connect", {
    environment: "sandbox", syncFrom: "2026-08-01T00:00:00.000Z", returnTo: "/?view=reports&tab=integrations",
  });
  const authorizationUrl = new URL(authorization.authorizationUrl);
  assert.equal(authorizationUrl.origin, "https://appcenter.intuit.com");
  assert.equal(authorizationUrl.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  const state = authorizationUrl.searchParams.get("state");
  assert.ok(state);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/tokens/bearer")) {
        assert.match(String(init.headers.Authorization), /^Basic /);
        return Response.json({ access_token: "plain-access-token", refresh_token: "plain-refresh-token", expires_in: 3600, x_refresh_token_expires_in: 8_000_000 });
      }
      if (url.includes("/companyinfo/realm-test")) return Response.json({ CompanyInfo: { CompanyName: "PaneFlow QBO Sandbox", Country: "CA", Currency: "CAD" } });
      throw new Error(`Unexpected OAuth fetch ${url}`);
    };
    const completed = await qboClient.completeQboAuthorization("https://paneflow.example.test/api/integrations/qbo/callback", { state, code: "authorization-code", realmId: "realm-test" });
    assert.equal(completed.connectionId, "qbo-realm-test");
    const stored = db.sqlite.prepare("SELECT encrypted_access_token AS accessToken,encrypted_refresh_token AS refreshToken,status,company_name AS companyName FROM qbo_connections WHERE id='qbo-realm-test'").get();
    assert.equal(stored.status, "connected");
    assert.equal(stored.companyName, "PaneFlow QBO Sandbox");
    assert.match(stored.accessToken, /^v1\./);
    assert.doesNotMatch(stored.accessToken, /plain-access-token/);
    assert.doesNotMatch(stored.refreshToken, /plain-refresh-token/);
    await assert.rejects(qboClient.completeQboAuthorization("https://paneflow.example.test/api/integrations/qbo/callback", { state, code: "authorization-code", realmId: "realm-test" }), /expired or was already used/);

    await run("INSERT INTO qbo_sync_deliveries (id,connection_id,dedupe_key,local_entity_type,local_entity_id,operation,payload_json,status,attempts,available_at,last_error,created_at,processed_at) VALUES ('qbo-canceled-on-disconnect','qbo-realm-test','reconnect:test','product','not-needed','upsert','{}','canceled',1,?,'Connection disconnected.',?,?)", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
    const reconnect = await qboClient.createQboAuthorizationUrl(actor, "https://paneflow.example.test/api/integrations/qbo/connect", {
      environment: "sandbox", syncFrom: "2026-08-01T00:00:00.000Z", returnTo: "/?view=reports&tab=integrations",
    });
    const reconnectState = new URL(reconnect.authorizationUrl).searchParams.get("state");
    await qboClient.completeQboAuthorization("https://paneflow.example.test/api/integrations/qbo/callback", { state: reconnectState, code: "reconnect-code", realmId: "realm-test" });
    assert.equal(db.sqlite.prepare("SELECT status FROM qbo_sync_deliveries WHERE id='qbo-canceled-on-disconnect'").get().status, "pending");
    await run("DELETE FROM qbo_sync_deliveries WHERE id='qbo-canceled-on-disconnect'");
  } finally { globalThis.fetch = originalFetch; }
});

test("expired and early-revoked access tokens refresh once without exposing credentials", async () => {
  const originalFetch = globalThis.fetch;
  const originalCiphertext = db.sqlite.prepare("SELECT encrypted_access_token AS token FROM qbo_connections WHERE id='qbo-realm-test'").get().token;
  await run("UPDATE qbo_connections SET access_token_expires_at='2020-01-01T00:00:00.000Z' WHERE id='qbo-realm-test'");
  let refreshes = 0;
  let apiCalls = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.includes("/tokens/bearer")) {
        refreshes += 1;
        assert.match(String(init.body), /grant_type=refresh_token/);
        return Response.json({ access_token: `refreshed-access-${refreshes}`, refresh_token: `rotated-refresh-${refreshes}`, expires_in: 3600, x_refresh_token_expires_in: 8_000_000 });
      }
      if (url.includes("/query")) {
        apiCalls += 1;
        assert.equal(init.headers.Authorization, `Bearer refreshed-access-${refreshes}`);
        if (apiCalls === 1) return Response.json({ Fault: { Error: [{ code: "3200", Message: "AuthenticationFailed" }] } }, { status: 401 });
        return Response.json({ QueryResponse: {} });
      }
      throw new Error(`Unexpected refresh fetch ${url}`);
    };
    await qboClient.qboQuery("qbo-realm-test", "select * from CompanyInfo maxresults 1");
    assert.equal(refreshes, 2, "one expiry refresh plus one forced refresh after an early 401");
    assert.equal(apiCalls, 2);
    const stored = db.sqlite.prepare("SELECT encrypted_access_token AS token,status,token_lock_owner AS lockOwner FROM qbo_connections WHERE id='qbo-realm-test'").get();
    assert.equal(stored.status, "connected");
    assert.equal(stored.lockOwner, null);
    assert.notEqual(stored.token, originalCiphertext);
    assert.doesNotMatch(stored.token, /refreshed-access/);

    await run("UPDATE qbo_connections SET access_token_expires_at='2020-01-01T00:00:00.000Z',token_lock_owner='other-worker',token_lock_until='2099-01-01T00:00:00.000Z' WHERE id='qbo-realm-test'");
    await assert.rejects(qboClient.qboQuery("qbo-realm-test", "select * from Account maxresults 1"), /Another request is refreshing/);
    await run("UPDATE qbo_connections SET token_lock_owner=NULL,token_lock_until=NULL,access_token_expires_at='2099-01-01T00:00:00.000Z' WHERE id='qbo-realm-test'");
  } finally { globalThis.fetch = originalFetch; }
});

test("only one QuickBooks company can be active at a time", async () => {
  const actor = { id: "admin-qbo", email: "admin@example.test", name: "Admin", role: "administrator", label: "Admin <admin@example.test>", localDevelopment: false };
  const authorization = await qboClient.createQboAuthorizationUrl(actor, "https://paneflow.example.test/api/integrations/qbo/connect", {
    environment: "sandbox", syncFrom: "2026-08-01T00:00:00.000Z", returnTo: "/?view=reports&tab=integrations",
  });
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls += 1; throw new Error("OAuth exchange must not run while another company is active."); };
    await assert.rejects(
      qboClient.completeQboAuthorization("https://paneflow.example.test/api/integrations/qbo/callback", { state, code: "other-code", realmId: "other-realm" }),
      (error) => error?.code === "QBO_CONNECTION_ALREADY_ACTIVE" && error?.status === 409,
    );
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("durable QBO sync orders dependencies, posts native documents and prevents duplicates", async () => {
  const timestamp = "2026-08-10T12:00:00.000Z";
  await run("INSERT INTO business_partners (id,code,name,partner_type,email,country,payment_terms,currency,active,version,created_at) VALUES ('qbo-customer','C-QBO','QBO Customer','customer','customer@example.test','CA','Net 30','CAD',1,1,?)", timestamp);
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('qbo-product','QBO-SKU','QBO Product','test','test','test','test','quantity','stocked',6000,10000,0,'uom-each','uom-each','uom-each',1,1,?)", timestamp);
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,currency,exchange_rate_to_base,base_total_cents,total_cents,version,created_at) VALUES ('qbo-so','SO-QBO','qbo-customer','fulfilled','invoiced','CAD',1,10500,10500,1,?)", timestamp);
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,unit_price_cents,fulfillment_route,taxable,tax_code,tax_rate_bps) VALUES ('qbo-sol','qbo-so','qbo-product',1,10000,'stock',1,'GST',500)");
  await run("INSERT INTO customer_invoices (id,number,customer_id,sales_order_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,posted_at,posted_by,version) VALUES ('qbo-invoice','INV-QBO','qbo-customer','qbo-so','posted','2026-08-10','2026-09-09',10000,500,10500,0,'CAD',1,10500,500,'GST','Net 30',?,'Tester',1)", timestamp);
  await run("INSERT INTO customer_invoice_lines (id,customer_invoice_id,sales_order_line_id,product_id,quantity,unit_price_cents,line_total_cents) VALUES ('qbo-invoice-line','qbo-invoice','qbo-sol','qbo-product',1,10000,10000)");
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('qbo-outbox-partner','master.business_partner_created','business_partner','qbo-customer','{}','pending',0,?,?)", timestamp, timestamp);
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('qbo-outbox-product','master.product_created','product','qbo-product','{}','pending',0,?,?)", timestamp, timestamp);
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('qbo-outbox-invoice','customer_invoice.posted','customer_invoice','qbo-invoice','{}','pending',0,?,?)", timestamp, timestamp);

  const accountRoles = {
    accounts_receivable: "Accounts Receivable", accounts_payable: "Accounts Payable", cash: "Bank", inventory: "Other Current Asset",
    inventory_clearing: "Other Current Asset", cost_of_goods_sold: "Cost of Goods Sold", sales_revenue: "Income",
    distribution_fees_revenue: "Income", sales_returns: "Income", purchase_returns: "Expense", credit_card: "Credit Card",
    landed_cost_accrual: "Other Current Liability",
  };
  for (const [key, type] of Object.entries(accountRoles)) await run("INSERT INTO qbo_account_mappings (connection_id,logical_key,qbo_account_id,qbo_account_name,qbo_account_type,active,updated_by,updated_at) VALUES ('qbo-realm-test',?,?,?,?,1,'Tester',?)", key, `account-${key}`, key, type, timestamp);
  await run("INSERT INTO qbo_reference_mappings (connection_id,mapping_type,local_value,qbo_entity_id,qbo_entity_name,metadata_json,active,updated_by,updated_at) VALUES ('qbo-realm-test','tax_code','GST','tax-gst','GST','{}',1,'Tester',?)", timestamp);
  await run("INSERT INTO qbo_reference_mappings (connection_id,mapping_type,local_value,qbo_entity_id,qbo_entity_name,metadata_json,active,updated_by,updated_at) VALUES ('qbo-realm-test','term','Net 30','term-30','Net 30','{}',1,'Tester',?)", timestamp);

  const originalFetch = globalThis.fetch;
  const creates = [];
  let nextId = 1;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/query")) {
        const query = url.searchParams.get("query") ?? "";
        if (query.includes("from BillPayment")) {
          assert.match(query, /where TxnDate =/);
          assert.doesNotMatch(query, /where DocNumber =/);
        }
        return Response.json({ QueryResponse: {} });
      }
      const entity = url.pathname.split("/").at(-1);
      const names = { customer: "Customer", item: "Item", invoice: "Invoice" };
      const type = names[entity];
      if (!type) throw new Error(`Unexpected sync fetch ${url}`);
      const body = JSON.parse(init.body);
      creates.push({ type, body, requestId: url.searchParams.get("requestid") });
      const total = type === "Invoice" ? 105 : undefined;
      return Response.json({ [type]: { ...body, Id: `${entity}-${nextId++}`, SyncToken: "0", ...(total == null ? {} : { TotalAmt: total }), MetaData: { LastUpdatedTime: "2026-08-10T12:01:00.000Z" } } });
    };
    const firstRun = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 50 });
    assert.ok(firstRun.succeeded >= 7, JSON.stringify(firstRun));
    assert.equal(firstRun.conflicts, 0);
    const invoiceCreate = creates.find((item) => item.type === "Invoice");
    assert.equal(invoiceCreate.body.CustomerRef.value.startsWith("customer-"), true);
    assert.equal(invoiceCreate.body.Line[0].SalesItemLineDetail.ItemRef.value.startsWith("item-"), true);
    assert.equal(invoiceCreate.body.TxnTaxDetail.TxnTaxCodeRef.value, "tax-gst");
    assert.equal(creates.every((item) => /^qbo-delivery-[0-9a-f-]{36}$/u.test(item.requestId ?? "")), true);
    assert.equal(new Set(creates.map((item) => item.requestId)).size, creates.length);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM qbo_entity_links WHERE local_entity_id='qbo-invoice' AND qbo_entity_type='Invoice'").get().count, 1);
    const createCount = creates.length;
    const secondRun = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 50 });
    assert.equal(secondRun.attempted, 0);
    assert.equal(creates.length, createCount);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM qbo_sync_deliveries WHERE connection_id='qbo-realm-test' AND status='conflict'").get().count, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("purchasing and payables post vendor, PO, bill, payment, credit, and credit application natively", async () => {
  const timestamp = "2026-08-10T14:00:00.000Z";
  await run("INSERT INTO business_partners (id,code,name,partner_type,email,country,payment_terms,currency,active,version,created_at) VALUES ('qbo-vendor','V-QBO','QBO Vendor','vendor','vendor@example.test','CA','Net 30','CAD',1,1,?)", timestamp);
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,payment_terms,due_date,total_cents,version,created_at) VALUES ('qbo-draft-po','PO-QBO-DRAFT','qbo-vendor','draft','unbilled','2026-08-25','CAD',1,10500,'Net 30','2026-09-14',10500,1,?)", timestamp);
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,unit_cost_cents,taxable,tax_code,tax_rate_bps) VALUES ('qbo-draft-pol','qbo-draft-po','qbo-product',1,10000,1,'GST',500)");
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,exchange_rate_to_base,base_total_cents,payment_terms,due_date,total_cents,buyer_name,project_reference,revision_number,version,created_at) VALUES ('qbo-po','PO-QBO','qbo-vendor','approved','billed','2026-08-20','CAD',1,10500,'Net 30','2026-09-09',10500,'Tester','QBO coverage',1,1,?)", timestamp);
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,unit_cost_cents,discount_cents,taxable,tax_code,tax_rate_bps) VALUES ('qbo-pol','qbo-po','qbo-product',1,10000,500,1,'GST',500)");
  await run("INSERT INTO document_charges (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at) VALUES ('qbo-po-freight','purchase_order','qbo-po','freight','Inbound freight',500,'add',1,0,'GST',500,25,?)", timestamp);
  await run("INSERT INTO vendor_bills (id,number,vendor_id,purchase_order_id,status,match_status,total_cents,due_date,currency,vendor_invoice_number,invoice_date,posted_at,subtotal_cents,tax_cents,paid_cents,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,version) VALUES ('qbo-bill','BILL-QBO','qbo-vendor','qbo-po','approved','matched',10500,'2026-09-09','CAD','V-INV-QBO','2026-08-10',?,10000,500,3050,1,10500,500,'GST','Net 30',1)", timestamp);
  await run("INSERT INTO vendor_bill_lines (id,vendor_bill_id,purchase_order_line_id,product_id,quantity,unit_cost_cents,line_total_cents,match_status,match_details_json) VALUES ('qbo-bill-line','qbo-bill','qbo-pol','qbo-product',1,9500,9500,'matched','{}')");
  await run("INSERT INTO vendor_bills (id,number,vendor_id,purchase_order_id,status,match_status,total_cents,due_date,currency,vendor_invoice_number,invoice_date,posted_at,subtotal_cents,tax_cents,paid_cents,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,version) VALUES ('qbo-held-bill','BILL-QBO-HOLD','qbo-vendor','qbo-po','on_hold','exception',10500,'2026-09-09','CAD','V-INV-HOLD','2026-08-10',?,10000,500,0,1,10500,500,'GST','Net 30',1)", timestamp);
  await run("INSERT INTO vendor_bill_lines (id,vendor_bill_id,purchase_order_line_id,product_id,quantity,unit_cost_cents,line_total_cents,match_status,match_details_json) VALUES ('qbo-held-bill-line','qbo-held-bill','qbo-pol','qbo-product',1,10000,10000,'exception','{}')");
  await run("INSERT INTO document_charges (id,document_type,document_id,charge_type,description,amount_cents,direction,taxable,refundable,tax_code,tax_rate_bps,tax_amount_cents,created_at) VALUES ('qbo-bill-freight','vendor_bill','qbo-bill','freight','Inbound freight',500,'add',1,0,'GST',500,25,?)", timestamp);
  await run("INSERT INTO payments (id,number,direction,partner_id,document_type,document_id,amount_cents,payment_date,method,reference,posted_at,posted_by,currency,exchange_rate_to_base,base_amount_cents) VALUES ('qbo-vendor-payment','PAY-QBO','outbound','qbo-vendor','vendor_bill','qbo-bill',2000,'2026-08-11','cheque','CHK-QBO',?,'Tester','CAD',1,2000)", timestamp);
  await run("INSERT INTO payments (id,number,direction,partner_id,document_type,document_id,amount_cents,payment_date,method,reference,posted_at,posted_by,currency,exchange_rate_to_base,base_amount_cents) VALUES ('qbo-vendor-card-payment','PAY-QBO-CARD','outbound','qbo-vendor','vendor_bill','qbo-bill',1000,'2026-08-12','Visa credit card','CARD-QBO',?,'Tester','CAD',1,1000)", timestamp);
  await run("INSERT INTO vendor_credits (id,number,vendor_id,vendor_bill_id,purchase_order_id,amount_cents,reason,status,posted_at,posted_by,version,currency,exchange_rate_to_base,base_amount_cents) VALUES ('qbo-vendor-credit','VC-QBO','qbo-vendor','qbo-bill','qbo-po',1050,'Returned damaged item','posted',?,'Tester',1,'CAD',1,1050)", timestamp);
  const events = [
    ["qbo-outbox-vendor", "master.business_partner_created", "business_partner", "qbo-vendor"],
    ["qbo-outbox-draft-po", "purchase_order.draft_created", "purchase_order", "qbo-draft-po"],
    ["qbo-outbox-po", "purchase_order.approved", "purchase_order", "qbo-po"],
    ["qbo-outbox-bill", "vendor_bill.posted", "vendor_bill", "qbo-bill"],
    ["qbo-outbox-held-bill", "vendor_bill.posted", "vendor_bill", "qbo-held-bill"],
    ["qbo-outbox-vendor-payment", "payment.posted", "payment", "qbo-vendor-payment"],
    ["qbo-outbox-vendor-card-payment", "payment.posted", "payment", "qbo-vendor-card-payment"],
    ["qbo-outbox-vendor-credit", "vendor_credit.posted", "vendor_credit", "qbo-vendor-credit"],
  ];
  for (const [id, eventType, aggregateType, aggregateId] of events) {
    await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES (?,?,?,?, '{}','pending',0,?,?)", id, eventType, aggregateType, aggregateId, timestamp, timestamp);
  }

  const originalFetch = globalThis.fetch;
  const creates = [];
  let nextId = 1;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/query")) {
        const query = url.searchParams.get("query") ?? "";
        if (query.includes("from BillPayment")) {
          assert.match(query, /where TxnDate =/);
          assert.doesNotMatch(query, /where DocNumber =/);
        }
        return Response.json({ QueryResponse: {} });
      }
      const endpoint = url.pathname.split("/").at(-1);
      const names = { vendor: "Vendor", purchaseorder: "PurchaseOrder", bill: "Bill", billpayment: "BillPayment", vendorcredit: "VendorCredit" };
      const type = names[endpoint];
      if (!type) throw new Error(`Unexpected payable sync fetch ${url}`);
      const body = JSON.parse(init.body);
      creates.push({ type, body });
      const totals = { PurchaseOrder: 105, Bill: 105, VendorCredit: 10.5, BillPayment: body.TotalAmt };
      return Response.json({ [type]: { ...body, Id: `${endpoint}-${nextId++}`, SyncToken: "0", ...(totals[type] == null ? {} : { TotalAmt: totals[type] }), MetaData: { LastUpdatedTime: timestamp } } });
    };
    const result = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 30 });
    assert.equal(result.conflicts, 0, JSON.stringify(result));

    const vendorIndex = creates.findIndex((item) => item.type === "Vendor");
    const poIndex = creates.findIndex((item) => item.type === "PurchaseOrder");
    const billIndex = creates.findIndex((item) => item.type === "Bill");
    assert.ok(vendorIndex >= 0 && vendorIndex < poIndex && poIndex < billIndex, JSON.stringify(creates.map((item) => item.type)));
    assert.equal(creates.filter((item) => item.type === "PurchaseOrder").length, 1);
    assert.equal(creates.filter((item) => item.type === "Bill").length, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM qbo_sync_deliveries WHERE local_entity_id IN ('qbo-draft-po','qbo-held-bill')").get().count, 0);
    const po = creates[poIndex].body;
    assert.equal(po.VendorRef.value.startsWith("vendor-"), true);
    assert.equal(po.SalesTermRef.value, "term-30");
    assert.equal(po.DueDate, "2026-09-09");
    assert.equal(po.ExpectedDate, "2026-08-20");
    assert.equal("Memo" in po, false);
    assert.equal(po.Line.length, 2);
    assert.equal(po.TxnTaxDetail.TotalTax, 5);
    assert.equal(po.TxnTaxDetail.TxnTaxCodeRef.value, "tax-gst");

    const bill = creates[billIndex].body;
    assert.equal(bill.Line[0].LinkedTxn[0].TxnType, "PurchaseOrder");
    assert.equal(bill.Line[0].LinkedTxn[0].TxnId.startsWith("purchaseorder-"), true);
    assert.equal(bill.Line[1].ItemBasedExpenseLineDetail.ItemRef.value.startsWith("item-"), true);
    assert.notEqual(bill.Line[1].ItemBasedExpenseLineDetail.ItemRef.value, po.Line[1].ItemBasedExpenseLineDetail.ItemRef.value);
    assert.equal(bill.TxnTaxDetail.TotalTax, 5);

    const credit = creates.find((item) => item.type === "VendorCredit").body;
    assert.equal(credit.Line[0].Amount, 10);
    assert.equal(credit.TxnTaxDetail.TotalTax, 0.5);
    const billPayments = creates.filter((item) => item.type === "BillPayment");
    assert.equal(billPayments.length, 3);
    const cashPayment = billPayments.find((item) => item.body.TotalAmt === 20).body;
    assert.equal(cashPayment.Line[0].LinkedTxn[0].TxnType, "Bill");
    assert.equal(cashPayment.PayType, "Check");
    assert.equal(cashPayment.CheckPayment.BankAccountRef.value, "account-cash");
    const cardPayment = billPayments.find((item) => item.body.TotalAmt === 10).body;
    assert.equal(cardPayment.PayType, "CreditCard");
    assert.equal(cardPayment.CreditCardPayment.CCAccountRef.value, "account-credit_card");
    assert.equal("CheckPayment" in cardPayment, false);
    const creditApplication = billPayments.find((item) => item.body.TotalAmt === 0).body;
    assert.deepEqual(creditApplication.Line[0].LinkedTxn.map((item) => item.TxnType), ["Bill", "VendorCredit"]);

    const syncedTypes = db.sqlite.prepare("SELECT qbo_entity_type AS type FROM qbo_entity_links WHERE local_entity_id IN ('qbo-vendor','qbo-po','qbo-bill','qbo-vendor-payment','qbo-vendor-card-payment','qbo-vendor-credit') AND status='synced' ORDER BY qbo_entity_type").all().map((row) => row.type);
    assert.deepEqual(syncedTypes, ["Bill", "BillPayment", "BillPayment", "BillPayment", "PurchaseOrder", "Vendor", "VendorCredit"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a dual-role partner uses distinct QBO display names for customer and vendor", async () => {
  const timestamp = "2026-08-10T16:00:00.000Z";
  await run("INSERT INTO business_partners (id,code,name,partner_type,country,currency,active,version,created_at) VALUES ('qbo-both','BOTH-QBO','Dual Role Partner','both','CA','CAD',1,1,?)", timestamp);
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('qbo-outbox-both','master.business_partner_created','business_partner','qbo-both','{}','pending',0,?,?)", timestamp, timestamp);
  const originalFetch = globalThis.fetch;
  const names = [];
  let nextId = 1;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/query")) return Response.json({ QueryResponse: {} });
      const endpoint = url.pathname.split("/").at(-1);
      const type = endpoint === "customer" ? "Customer" : endpoint === "vendor" ? "Vendor" : "";
      if (!type) throw new Error(`Unexpected dual-role sync fetch ${url}`);
      const body = JSON.parse(init.body);
      names.push(body.DisplayName);
      return Response.json({ [type]: { ...body, Id: `${endpoint}-both-${nextId++}`, SyncToken: "0", MetaData: { LastUpdatedTime: timestamp } } });
    };
    const result = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 10 });
    assert.equal(result.conflicts, 0, JSON.stringify(result));
    assert.deepEqual(names.sort(), ["C · Dual Role Partner · BOTH-QBO", "V · Dual Role Partner · BOTH-QBO"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("landed cost posts once through its allocation and clears the landed-cost accrual", async () => {
  const timestamp = "2026-08-11T10:00:00.000Z";
  await run("INSERT INTO landed_cost_allocations (id,number,source_document_type,source_document_id,amount_cents,allocation_basis,posted_at,posted_by) VALUES ('qbo-landed','LC-QBO','vendor_bill','qbo-bill',500,'purchase_value',?,'Tester')", timestamp);
  await run("INSERT INTO inventory_value_entries (id,product_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by) VALUES ('qbo-landed-value','qbo-product','landed_cost',0,500,500,'fifo','landed_cost','qbo-landed',?,'Tester')", timestamp);
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('qbo-outbox-landed','valuation.landed_cost_allocated','landed_cost','qbo-landed','{}','pending',0,?,?)", timestamp, timestamp);
  const originalFetch = globalThis.fetch;
  let journalCreates = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/query")) return Response.json({ QueryResponse: {} });
      assert.ok(url.pathname.endsWith("/journalentry"));
      const body = JSON.parse(init.body);
      journalCreates += 1;
      assert.equal(body.Line[0].JournalEntryLineDetail.AccountRef.value, "account-inventory");
      assert.equal(body.Line[1].JournalEntryLineDetail.AccountRef.value, "account-landed_cost_accrual");
      assert.deepEqual(body.Line.map((line) => line.Amount), [5, 5]);
      return Response.json({ JournalEntry: { ...body, Id: "journal-landed", SyncToken: "0", MetaData: { LastUpdatedTime: timestamp } } });
    };
    const result = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 10 });
    assert.equal(result.conflicts, 0, JSON.stringify(result));
    assert.equal(journalCreates, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM qbo_sync_deliveries WHERE local_entity_id='qbo-landed-value'").get().count, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("a historical QBO invoice is safely adopted before PaneFlow voids it", async () => {
  const timestamp = "2026-08-11T11:00:00.000Z";
  await run("INSERT INTO customer_invoices (id,number,customer_id,sales_order_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,posted_at,posted_by,version) VALUES ('qbo-invoice-to-void','INV-QBO-VOID','qbo-customer','qbo-so','voided','2026-08-10','2026-09-09',10000,500,10500,0,'CAD',1,10500,500,'GST','Net 30',?,'Tester',2)", timestamp);
  await run("INSERT INTO customer_invoice_lines (id,customer_invoice_id,sales_order_line_id,product_id,quantity,unit_price_cents,line_total_cents) VALUES ('qbo-invoice-void-line','qbo-invoice-to-void','qbo-sol','qbo-product',1,10000,10000)");
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('qbo-outbox-void','customer_invoice.voided','customer_invoice','qbo-invoice-to-void','{}','pending',0,?,?)", timestamp, timestamp);
  const originalFetch = globalThis.fetch;
  let voids = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/query")) {
        assert.match(url.searchParams.get("query") ?? "", /DocNumber = 'INV-QBO-VOID'/);
        return Response.json({ QueryResponse: { Invoice: [{ Id: "invoice-historical", SyncToken: "3", DocNumber: "INV-QBO-VOID", TxnDate: "2026-08-10", TotalAmt: 105, CustomerRef: { value: db.sqlite.prepare("SELECT qbo_entity_id AS id FROM qbo_entity_links WHERE local_entity_id='qbo-customer' AND qbo_entity_type='Customer'").get().id }, MetaData: { LastUpdatedTime: timestamp } }] } });
      }
      assert.ok(url.pathname.endsWith("/invoice"));
      assert.equal(url.searchParams.get("operation"), "void");
      assert.match(url.searchParams.get("requestid") ?? "", /^qbo-delivery-/u);
      const body = JSON.parse(init.body);
      assert.deepEqual(body, { Id: "invoice-historical", SyncToken: "3" });
      voids += 1;
      return Response.json({ Invoice: { Id: "invoice-historical", SyncToken: "4", TotalAmt: 0, MetaData: { LastUpdatedTime: timestamp } } });
    };
    const result = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 10 });
    assert.equal(result.conflicts, 0, JSON.stringify(result));
    assert.equal(voids, 1);
    assert.deepEqual({ ...db.sqlite.prepare("SELECT qbo_entity_id AS id,qbo_sync_token AS token,status FROM qbo_entity_links WHERE local_entity_id='qbo-invoice-to-void'").get() }, { id: "invoice-historical", token: "4", status: "synced" });
  } finally { globalThis.fetch = originalFetch; }
});

test("signed QBO webhooks are durable and external edits become conflicts", async () => {
  const payload = JSON.stringify({ eventNotifications: [{ realmId: "realm-test", dataChangeEvent: { lastUpdated: "2026-08-11T12:00:00.000Z", entities: [{ name: "Invoice", id: db.sqlite.prepare("SELECT qbo_entity_id AS id FROM qbo_entity_links WHERE local_entity_id='qbo-invoice'").get().id, operation: "Update", lastUpdated: "2026-08-11T12:00:00.000Z" }] } }] });
  const bytes = new TextEncoder().encode(payload);
  const signature = await qboCrypto.hmacSha256Base64(env.QBO_WEBHOOK_VERIFIER_TOKEN, bytes);
  const invalid = await qboWebhook.recordQboWebhook(new Request("https://paneflow.example.test/api/integrations/qbo/webhook", { method: "POST", headers: { "intuit-signature": "bad" }, body: payload }));
  assert.equal(invalid.status, 401);
  const valid = await qboWebhook.recordQboWebhook(new Request("https://paneflow.example.test/api/integrations/qbo/webhook", { method: "POST", headers: { "intuit-signature": signature }, body: payload }));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { accepted: 1 });
  const processed = await qboWebhook.processQboWebhookBatch(10);
  assert.equal(processed.processed, 1);
  assert.equal(processed.conflicts, 1);
  const link = db.sqlite.prepare("SELECT status,last_error AS lastError FROM qbo_entity_links WHERE local_entity_id='qbo-invoice'").get();
  assert.equal(link.status, "conflict");
  assert.match(link.lastError, /external Update/);
  const conflict = db.sqlite.prepare("SELECT id,status,last_error_code AS code,qbo_entity_type AS type FROM qbo_sync_deliveries WHERE local_entity_id='qbo-invoice' AND last_error_code='QBO_EXTERNAL_EDIT'").get();
  assert.deepEqual({ status: conflict.status, code: conflict.code, type: conflict.type }, { status: "conflict", code: "QBO_EXTERNAL_EDIT", type: "Invoice" });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (/\/invoice\/[^/]+$/u.test(url.pathname)) {
        return Response.json({ Invoice: { Id: url.pathname.split("/").at(-1), SyncToken: "9", TotalAmt: 105, MetaData: { LastUpdatedTime: "2026-08-11T12:01:00.000Z" } } });
      }
      assert.ok(url.pathname.endsWith("/invoice"));
      assert.equal(url.searchParams.get("requestid"), conflict.id);
      const body = JSON.parse(init.body);
      assert.equal(body.SyncToken, "9");
      return Response.json({ Invoice: { ...body, Id: body.Id, SyncToken: "10", TotalAmt: 105, MetaData: { LastUpdatedTime: "2026-08-11T12:02:00.000Z" } } });
    };
    await qboSync.retryQboDelivery(conflict.id, { id: "admin", email: "admin@example.test", label: "Admin", role: "administrator" });
    const overwrite = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 1, project: false });
    assert.equal(overwrite.succeeded, 1);
    assert.deepEqual({ ...db.sqlite.prepare("SELECT status,qbo_sync_token AS token FROM qbo_entity_links WHERE local_entity_id='qbo-invoice'").get() }, { status: "synced", token: "10" });
  } finally { globalThis.fetch = originalFetch; }
});

test("reconciliation advances round-robin instead of starving later QBO links", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const endpointTypes = { bill: "Bill", billpayment: "BillPayment", creditmemo: "CreditMemo", customer: "Customer", invoice: "Invoice", item: "Item", journalentry: "JournalEntry", payment: "Payment", purchaseorder: "PurchaseOrder", vendor: "Vendor", vendorcredit: "VendorCredit" };
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      const segments = url.pathname.split("/");
      const endpoint = segments.at(-2);
      const type = endpointTypes[endpoint];
      assert.ok(type, `Unexpected reconciliation endpoint ${url}`);
      const id = segments.at(-1);
      const stored = db.sqlite.prepare("SELECT qbo_sync_token AS token FROM qbo_entity_links WHERE qbo_entity_type=? AND qbo_entity_id=?").get(type, id);
      return Response.json({ [type]: { Id: id, SyncToken: stored.token, MetaData: { LastUpdatedTime: "2026-08-14T00:00:00.000Z" } } });
    };
    await qboSync.reconcileQboConnection("qbo-realm-test", 1);
    const firstCursor = db.sqlite.prepare("SELECT last_changed_at AS id FROM qbo_sync_cursors WHERE connection_id='qbo-realm-test' AND entity_type='reconciliation'").get().id;
    await qboSync.reconcileQboConnection("qbo-realm-test", 1);
    const secondCursor = db.sqlite.prepare("SELECT last_changed_at AS id FROM qbo_sync_cursors WHERE connection_id='qbo-realm-test' AND entity_type='reconciliation'").get().id;
    assert.notEqual(secondCursor, firstCursor);
  } finally { globalThis.fetch = originalFetch; }
});

test("CloudEvents v1.0 webhooks are accepted and normalized", async () => {
  const vendorLink = db.sqlite.prepare("SELECT qbo_entity_id AS id FROM qbo_entity_links WHERE local_entity_id='qbo-vendor' AND qbo_entity_type='Vendor'").get();
  const payload = JSON.stringify([{ specversion: "1.0", id: "cloud-event-1", source: "intuit.test", type: "qbo.vendor.updated.v1", datacontenttype: "application/json", time: "2026-08-15T12:00:00.000Z", intuitentityid: vendorLink.id, intuitaccountid: "realm-test", data: {} }]);
  const bytes = new TextEncoder().encode(payload);
  const signature = await qboCrypto.hmacSha256Base64(env.QBO_WEBHOOK_VERIFIER_TOKEN, bytes);
  const response = await qboWebhook.recordQboWebhook(new Request("https://paneflow.example.test/api/integrations/qbo/webhook", { method: "POST", headers: { "intuit-signature": signature }, body: payload }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: 1 });
  const processed = await qboWebhook.processQboWebhookBatch(10);
  assert.equal(processed.conflicts, 1);
  const conflict = db.sqlite.prepare("SELECT status,last_error_code AS code FROM qbo_sync_deliveries WHERE local_entity_id='qbo-vendor' AND qbo_entity_type='Vendor' AND last_error_code='QBO_EXTERNAL_EDIT'").get();
  assert.deepEqual({ ...conflict }, { status: "conflict", code: "QBO_EXTERNAL_EDIT" });
});

test("mapping conflicts remain durable and become retryable after configuration is corrected", async () => {
  const timestamp = "2026-08-12T12:00:00.000Z";
  await run("INSERT INTO inventory_value_entries (id,product_id,entry_type,quantity,unit_cost_cents,value_cents,cost_method,reference_type,reference_id,posted_at,posted_by) VALUES ('qbo-value-scrap','qbo-product','scrap',-1,6000,-6000,'fifo','scrap','qbo-scrap',?,'Tester')", timestamp);
  const projected = await qboSync.projectQboDeliveries({ connectionId: "qbo-realm-test" });
  assert.ok(projected >= 1);
  const conflictRun = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 10, project: false });
  assert.equal(conflictRun.conflicts, 1);
  const delivery = db.sqlite.prepare("SELECT id,status,last_error_code AS code FROM qbo_sync_deliveries WHERE local_entity_id='qbo-value-scrap'").get();
  assert.equal(delivery.status, "conflict");
  assert.equal(delivery.code, "QBO_MAPPING_REQUIRED");

  await run("INSERT INTO qbo_account_mappings (connection_id,logical_key,qbo_account_id,qbo_account_name,qbo_account_type,active,updated_by,updated_at) VALUES ('qbo-realm-test','inventory_scrap_expense','account-scrap','Inventory scrap expense','Expense',1,'Tester',?)", timestamp);
  await qboSync.retryQboDelivery(delivery.id, { id: "admin", email: "admin@example.test", label: "Admin", role: "administrator" });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/query")) return Response.json({ QueryResponse: {} });
      assert.ok(url.pathname.endsWith("/journalentry"));
      const body = JSON.parse(init.body);
      assert.equal(body.Line[0].JournalEntryLineDetail.AccountRef.value, "account-scrap");
      assert.equal(body.Line[1].JournalEntryLineDetail.AccountRef.value, "account-inventory");
      return Response.json({ JournalEntry: { ...body, Id: "journal-scrap", SyncToken: "0", MetaData: { LastUpdatedTime: timestamp } } });
    };
    const retryRun = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 10, project: false });
    assert.equal(retryRun.succeeded, 1);
    assert.equal(db.sqlite.prepare("SELECT status FROM qbo_sync_deliveries WHERE id=?").get(delivery.id).status, "succeeded");
  } finally { globalThis.fetch = originalFetch; }
});

test("QBO total mismatches create a linked conflict instead of duplicating on retry", async () => {
  const timestamp = "2026-08-13T12:00:00.000Z";
  await run("UPDATE qbo_entity_links SET status='synced',last_error=NULL WHERE local_entity_id='qbo-invoice'");
  await run("INSERT INTO customer_credits (id,number,customer_id,customer_invoice_id,sales_order_id,amount_cents,reason,status,posted_at,posted_by,version,currency,exchange_rate_to_base,base_amount_cents) VALUES ('qbo-credit-mismatch','CM-QBO','qbo-customer','qbo-invoice','qbo-so',2500,'Test total control','posted',?,'Tester',1,'CAD',1,2500)", timestamp);
  await run("INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES ('qbo-outbox-credit','customer_credit.posted','customer_credit','qbo-credit-mismatch','{}','pending',0,?,?)", timestamp, timestamp);
  const originalFetch = globalThis.fetch;
  let creates = 0;
  let applications = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/query")) return Response.json({ QueryResponse: {} });
      const body = JSON.parse(init.body);
      if (url.pathname.endsWith("/payment")) {
        applications += 1;
        assert.equal(body.TotalAmt, 0);
        assert.deepEqual(body.Line[0].LinkedTxn.map((item) => item.TxnType), ["Invoice", "CreditMemo"]);
        return Response.json({ Payment: { ...body, Id: "credit-application-remote", SyncToken: "0", TotalAmt: 0, MetaData: { LastUpdatedTime: timestamp } } });
      }
      assert.ok(url.pathname.endsWith("/creditmemo"));
      creates += 1;
      return Response.json({ CreditMemo: { ...body, Id: "credit-remote", SyncToken: "4", TotalAmt: creates === 1 ? 20 : 25, MetaData: { LastUpdatedTime: timestamp } } });
    };
    const mismatch = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 10 });
    assert.equal(mismatch.conflicts, 1);
    const delivery = db.sqlite.prepare("SELECT id,status,last_error_code AS code FROM qbo_sync_deliveries WHERE local_entity_id='qbo-credit-mismatch'").get();
    assert.equal(delivery.code, "QBO_TOTAL_MISMATCH");
    const link = db.sqlite.prepare("SELECT qbo_entity_id AS id,status FROM qbo_entity_links WHERE local_entity_id='qbo-credit-mismatch'").get();
    assert.deepEqual({ ...link }, { id: "credit-remote", status: "conflict" });
    await qboSync.retryQboDelivery(delivery.id, { id: "admin", email: "admin@example.test", label: "Admin", role: "administrator" });
    const corrected = await qboSync.processQboSyncBatch({ connectionId: "qbo-realm-test", limit: 10, project: false });
    assert.equal(corrected.succeeded, 2);
    assert.equal(creates, 2);
    assert.equal(applications, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM qbo_entity_links WHERE local_entity_id='qbo-credit-mismatch' AND qbo_entity_type='CreditMemo'").get().count, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("mapping saves replace prior selections and reject duplicate keys", async () => {
  const actor = { id: "admin", email: "admin@example.test", label: "Admin", role: "administrator" };
  await qboAdmin.saveQboAccountMappings("qbo-realm-test", [{ logicalKey: "sales_revenue", qboAccountId: "account-new-sales", qboAccountName: "New sales", qboAccountType: "Income" }], actor);
  assert.deepEqual(db.sqlite.prepare("SELECT logical_key AS key FROM qbo_account_mappings WHERE connection_id='qbo-realm-test' AND active=1 ORDER BY logical_key").all().map((item) => item.key), ["sales_revenue"]);
  await qboAdmin.saveQboReferenceMappings("qbo-realm-test", [{ mappingType: "tax_code", localValue: "GST", qboEntityId: "tax-new-gst", qboEntityName: "GST" }], actor);
  assert.deepEqual(db.sqlite.prepare("SELECT mapping_type AS type,local_value AS value FROM qbo_reference_mappings WHERE connection_id='qbo-realm-test' AND active=1 ORDER BY mapping_type,local_value").all().map((item) => [item.type, item.value]), [["tax_code", "GST"]]);
  await assert.rejects(qboAdmin.saveQboAccountMappings("qbo-realm-test", [
    { logicalKey: "sales_revenue", qboAccountId: "one", qboAccountName: "One", qboAccountType: "Income" },
    { logicalKey: "sales_revenue", qboAccountId: "two", qboAccountName: "Two", qboAccountType: "Income" },
  ], actor), /supplied more than once/);
});
