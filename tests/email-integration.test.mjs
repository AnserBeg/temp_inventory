import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let emailClient;
let documentEmail;

async function applyMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
  }
}

function run(sql, ...values) { return db.prepare(sql).bind(...values).run(); }

const operator = { id: "email-operator", email: "operator@paneflow.test", name: "Email Operator", role: "operator", label: "Email Operator <operator@paneflow.test>", localDevelopment: false };
const accountant = { id: "email-accountant", email: "accountant@paneflow.test", name: "Email Accountant", role: "accounting", label: "Email Accountant <accountant@paneflow.test>", localDevelopment: false };
const now = "2026-08-24T18:00:00.000Z";

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.BOOTSTRAP_DEMO_DATA = "false";
  env.EMAIL_TOKEN_ENCRYPTION_KEY = "email-test-key-0123456789abcdef0123456789";
  env.EMAIL_GOOGLE_CLIENT_ID = "google-email-test-client";
  env.EMAIL_GOOGLE_CLIENT_SECRET = "google-email-test-secret";
  env.EMAIL_GOOGLE_REDIRECT_URI = "https://paneflow.example.test/api/integrations/email/callback/google";
  env.EMAIL_MICROSOFT_CLIENT_ID = "microsoft-email-test-client";
  env.EMAIL_MICROSOFT_CLIENT_SECRET = "microsoft-email-test-secret";
  env.EMAIL_MICROSOFT_TENANT_ID = "organizations";
  env.EMAIL_MICROSOFT_REDIRECT_URI = "https://paneflow.example.test/api/integrations/email/callback/microsoft";
  emailClient = await import("../lib/server/email-client.ts");
  documentEmail = await import("../lib/server/document-email.ts");

  await run("INSERT INTO app_users (user_id,email,full_name,role,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)", operator.id, operator.email, operator.name, operator.role, now, now);
  await run("INSERT INTO app_users (user_id,email,full_name,role,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)", accountant.id, accountant.email, accountant.name, accountant.role, now, now);
  await run("INSERT INTO business_partners (id,code,name,partner_type,email,address_line_1,city,region,postal_code,country,currency,active,version,created_at) VALUES ('email-vendor','V-EMAIL','Email Vendor','vendor','vendor@example.test','1 Vendor Way','Calgary','AB','T1T 1T1','CA','CAD',1,1,?)", now);
  await run("INSERT INTO business_partners (id,code,name,partner_type,email,address_line_1,city,region,postal_code,country,currency,active,version,created_at) VALUES ('email-customer','C-EMAIL','Email Customer','customer','customer@example.test','2 Customer Road','Edmonton','AB','T2T 2T2','CA','CAD',1,1,?)", now);
  await run("INSERT INTO products (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at) VALUES ('email-product','EMAIL-1','Email Test Window','window','vinyl','24 x 36','white','quantity','stocked',10000,15000,0,'uom-each','uom-each','uom-each',1,1,?)", now);
  await run("INSERT INTO purchase_orders (id,number,vendor_id,lifecycle_status,billing_status,expected_date,currency,total_cents,buyer_name,version,created_at) VALUES ('email-po','PO-EMAIL','email-vendor','approved','not_billed','2026-09-01','CAD',21000,'Email Operator',1,?)", now);
  await run("INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,ordered_qty,unit_cost_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_cost_cents,discount_cents,taxable,tax_rate_bps,version) VALUES ('email-pol','email-po','email-product',2,10000,'uom-each',2,10000,0,1,500,1)");
  await run("INSERT INTO sales_orders (id,number,customer_id,lifecycle_status,billing_status,requested_date,currency,total_cents,owner_name,version,created_at) VALUES ('email-so','SO-EMAIL','email-customer','confirmed','invoiced','2026-09-02','CAD',31500,'Email Operator',1,?)", now);
  await run("INSERT INTO sales_order_lines (id,sales_order_id,product_id,ordered_qty,unit_price_cents,ordered_uom_id,ordered_uom_qty,ordered_uom_unit_price_cents,discount_cents,taxable,tax_rate_bps) VALUES ('email-sol','email-so','email-product',2,15000,'uom-each',2,15000,0,1,500)");
  await run("INSERT INTO customer_invoices (id,number,customer_id,sales_order_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,posted_at,posted_by,version) VALUES ('email-invoice','INV-EMAIL','email-customer','email-so','posted','2026-08-24','2026-09-23',30000,1500,31500,0,'CAD',1,31500,500,'GST','Net 30',?,'Email Accountant',1)", now);
  await run("INSERT INTO customer_invoice_lines (id,customer_invoice_id,sales_order_line_id,product_id,quantity,unit_price_cents,line_total_cents) VALUES ('email-cil','email-invoice','email-sol','email-product',2,15000,30000)");
});

after(() => db.close());

test("email migration creates constrained per-user connections and delivery history", () => {
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_connections','email_oauth_states','document_email_deliveries') ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["document_email_deliveries", "email_connections", "email_oauth_states"]);
  assert.throws(() => db.sqlite.prepare("INSERT INTO email_connections (user_id,provider,email_address,status,scopes,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,connected_at,updated_at) VALUES ('bad','imap','bad@example.test','connected','send','a','b','2099-01-01','2026-01-01','2026-01-01')").run(), /CHECK constraint failed/);
});

test("Google OAuth is user-bound, one-use, and encrypts mailbox tokens at rest", async () => {
  const authorization = await emailClient.createEmailAuthorizationUrl(operator, "https://paneflow.example.test/api/integrations/email/connect", { provider: "google", returnTo: "/?view=purchase-orders" });
  const url = new URL(authorization.authorizationUrl);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.match(url.searchParams.get("scope"), /gmail\.send/);
  assert.equal(url.searchParams.get("access_type"), "offline");
  const state = url.searchParams.get("state");
  assert.ok(state);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const target = String(input);
      if (target === "https://oauth2.googleapis.com/token") {
        assert.match(String(init.body), /grant_type=authorization_code/);
        return Response.json({ access_token: "google-plain-access", refresh_token: "google-plain-refresh", expires_in: 3600, scope: "gmail.send" });
      }
      if (target.includes("/oauth2/v3/userinfo")) {
        assert.equal(init.headers.authorization, "Bearer google-plain-access");
        return Response.json({ email: "operator-mailbox@example.test" });
      }
      throw new Error(`Unexpected OAuth request ${target}`);
    };
    const completed = await emailClient.completeEmailAuthorization("https://paneflow.example.test/api/integrations/email/callback/google", { provider: "google", state, code: "google-code" });
    assert.equal(completed.emailAddress, "operator-mailbox@example.test");
    const stored = db.sqlite.prepare("SELECT encrypted_access_token AS accessToken,encrypted_refresh_token AS refreshToken,status FROM email_connections WHERE user_id=?").get(operator.id);
    assert.equal(stored.status, "connected");
    assert.match(stored.accessToken, /^v1\./);
    assert.doesNotMatch(stored.accessToken, /google-plain-access/);
    assert.doesNotMatch(stored.refreshToken, /google-plain-refresh/);
    await assert.rejects(emailClient.completeEmailAuthorization("https://paneflow.example.test/api/integrations/email/callback/google", { provider: "google", state, code: "again" }), /expired or was already used/);
  } finally { globalThis.fetch = originalFetch; }
});

test("authoritative previews default to partner email and reject unapproved documents", async () => {
  const po = await documentEmail.getDocumentEmailPreview("purchase_order", "email-po");
  assert.equal(po.defaultRecipient, "vendor@example.test");
  assert.equal(po.fileName, "PO-EMAIL.pdf");
  const invoice = await documentEmail.getDocumentEmailPreview("customer_invoice", "email-invoice");
  assert.equal(invoice.defaultRecipient, "customer@example.test");
  await run("UPDATE purchase_orders SET lifecycle_status='draft' WHERE id='email-po'");
  await assert.rejects(documentEmail.getDocumentEmailPreview("purchase_order", "email-po"), /Only an approved purchase order/);
  await run("UPDATE purchase_orders SET lifecycle_status='approved' WHERE id='email-po'");
  assert.equal(documentEmail.emailDocumentCapability("customer_invoice"), "financialWrite");
  assert.equal(documentEmail.emailDocumentCapability("sales_order"), "operationalWrite");
});

test("document send refreshes expired access, attaches a PDF, and writes delivery and audit records", async () => {
  await run("UPDATE email_connections SET access_token_expires_at='2020-01-01T00:00:00.000Z' WHERE user_id=?", operator.id);
  const originalFetch = globalThis.fetch;
  let gmailRaw = "";
  try {
    globalThis.fetch = async (input, init = {}) => {
      const target = String(input);
      if (target === "https://oauth2.googleapis.com/token") {
        assert.match(String(init.body), /grant_type=refresh_token/);
        assert.match(String(init.body), /refresh_token=google-plain-refresh/);
        return Response.json({ access_token: "google-refreshed-access", refresh_token: "google-rotated-refresh", expires_in: 3600, scope: "gmail.send" });
      }
      if (target.includes("gmail.googleapis.com")) {
        assert.equal(init.headers.authorization, "Bearer google-refreshed-access");
        gmailRaw = JSON.parse(String(init.body)).raw;
        return Response.json({ id: "gmail-message-email-po" });
      }
      throw new Error(`Unexpected send request ${target}`);
    };
    const sent = await documentEmail.sendDocumentEmail(operator, {
      documentType: "purchase_order", documentId: "email-po", recipients: ["vendor@example.test"],
      subject: "Approved PO-EMAIL", message: "Please process this order.",
    });
    assert.equal(sent.senderEmail, "operator-mailbox@example.test");
    const normalized = gmailRaw.replaceAll("-", "+").replaceAll("_", "/");
    const mime = Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64").toString("utf8");
    assert.match(mime, /Content-Type: application\/pdf/);
    assert.match(mime, /filename="PO-EMAIL\.pdf"/);
    assert.match(mime, /JVBERi0xLjQ/); // Base64-encoded %PDF-1.4 attachment.
    const delivery = db.sqlite.prepare("SELECT status,provider_message_id AS messageId,recipients_json AS recipients FROM document_email_deliveries WHERE id=?").get(sent.deliveryId);
    assert.equal(delivery.status, "sent");
    assert.equal(delivery.messageId, "gmail-message-email-po");
    assert.deepEqual(JSON.parse(delivery.recipients), ["vendor@example.test"]);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_type='purchase_order' AND entity_id='email-po' AND action='document_emailed'").get().count, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("Microsoft 365 connection sends invoices through Graph with the same PDF contract", async () => {
  const authorization = await emailClient.createEmailAuthorizationUrl(accountant, "https://paneflow.example.test/api/integrations/email/connect", { provider: "microsoft", returnTo: "/?view=customer-invoices" });
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const target = String(input);
      if (target.includes("login.microsoftonline.com") && target.endsWith("/token")) return Response.json({ access_token: "ms-access", refresh_token: "ms-refresh", expires_in: 3600, scope: "Mail.Send User.Read" });
      if (target.startsWith("https://graph.microsoft.com/v1.0/me?")) return Response.json({ mail: "accountant-mailbox@example.test" });
      if (target === "https://graph.microsoft.com/v1.0/me/sendMail") {
        const payload = JSON.parse(String(init.body));
        assert.equal(payload.message.toRecipients[0].emailAddress.address, "customer@example.test");
        assert.equal(payload.message.attachments[0].name, "INV-EMAIL.pdf");
        assert.match(payload.message.attachments[0].contentBytes, /^JVBERi0xLjQ/);
        return new Response(null, { status: 202, headers: { "request-id": "graph-invoice-message" } });
      }
      throw new Error(`Unexpected Microsoft request ${target}`);
    };
    await emailClient.completeEmailAuthorization("https://paneflow.example.test/api/integrations/email/callback/microsoft", { provider: "microsoft", state, code: "ms-code" });
    const sent = await documentEmail.sendDocumentEmail(accountant, {
      documentType: "customer_invoice", documentId: "email-invoice", recipients: "customer@example.test",
      subject: "Invoice INV-EMAIL", message: "Your invoice is attached.",
    });
    assert.equal(sent.senderEmail, "accountant-mailbox@example.test");
    assert.equal(db.sqlite.prepare("SELECT provider,status FROM document_email_deliveries WHERE id=?").get(sent.deliveryId).provider, "microsoft");
  } finally { globalThis.fetch = originalFetch; }
});

test("recipient validation rejects header injection and records provider failures", async () => {
  await assert.rejects(documentEmail.sendDocumentEmail(operator, {
    documentType: "sales_order", documentId: "email-so", recipients: ["customer@example.test\r\nBcc: attacker@example.test"], subject: "SO-EMAIL", message: "Attached",
  }), /not a valid email address/);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => String(input).includes("gmail.googleapis.com") ? Response.json({ error: { message: "provider down" } }, { status: 503 }) : (() => { throw new Error(`Unexpected request ${String(input)}`); })();
    await assert.rejects(documentEmail.sendDocumentEmail(operator, {
      documentType: "sales_order", documentId: "email-so", recipients: ["customer@example.test"], subject: "SO-EMAIL", message: "Attached",
    }), /Gmail send failed/);
    assert.equal(db.sqlite.prepare("SELECT status FROM document_email_deliveries WHERE document_id='email-so' ORDER BY created_at DESC LIMIT 1").get().status, "failed");
  } finally { globalThis.fetch = originalFetch; }
});
