import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let emailClient;
let documentEmail;
let advancedDomain;
let outbox;
let smtpClient;

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
  advancedDomain = await import("../lib/server/advanced-domain.ts");
  outbox = await import("../lib/server/outbox.ts");
  smtpClient = await import("../lib/server/smtp-client.ts");

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
  await run("INSERT INTO vendor_bills (id,number,vendor_invoice_number,vendor_id,purchase_order_id,status,match_status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,version,posted_at) VALUES ('email-bill','VB-EMAIL','SUP-EMAIL','email-vendor','email-po','approved','matched','2026-08-24','2026-09-23',20000,1000,21000,0,'CAD',1,21000,1,?)", now);
  await run("INSERT INTO vendor_bill_lines (id,vendor_bill_id,purchase_order_line_id,product_id,quantity,unit_cost_cents,line_total_cents,match_status,match_details_json) VALUES ('email-vbl','email-bill','email-pol','email-product',2,10000,20000,'matched','{}')");
  await run("INSERT INTO work_orders (id,number,title,status,partner_id,notes,created_by_id,created_by_name,version,created_at,updated_at) VALUES ('email-work-order','WO-EMAIL','Install Email Test Window','open','email-customer','Confirm the final fit and operation.','email-operator','Email Operator',1,?,?)", now, now);
  await run("INSERT INTO work_order_document_links (id,work_order_id,document_type,document_id,document_number,created_at) VALUES ('email-work-order-link','email-work-order','sales_order','email-so','SO-EMAIL',?)", now);
  await run("INSERT INTO labour_items (id,work_order_id,title,status,created_by_id,version,created_at,updated_at) VALUES ('email-labour','email-work-order','Install and test window','completed','email-operator',1,?,?)", now, now);
  await run("INSERT INTO time_entries (id,labour_item_id,worker_user_id,worker_name,worker_email,started_at,ended_at,tech_story,version,created_at,updated_at) VALUES ('email-time','email-labour','email-operator','Email Operator','operator@paneflow.test','2026-08-24T18:00:00.000Z','2026-08-24T20:30:00.000Z','Installed, sealed, and tested the unit.',1,?,?)", now, now);
});

after(() => db.close());

test("email migration creates constrained sender connections and delivery history", () => {
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_connections','email_oauth_states','smtp_email_connections','document_email_deliveries') ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["document_email_deliveries", "email_connections", "email_oauth_states", "smtp_email_connections"]);
  assert.ok(db.sqlite.prepare("PRAGMA table_info(email_oauth_states)").all().some((column) => column.name === "connection_type"));
  assert.ok(db.sqlite.prepare("PRAGMA table_info(document_email_deliveries)").all().some((column) => column.name === "sender_type"));
  assert.throws(() => db.sqlite.prepare("INSERT INTO email_connections (user_id,provider,email_address,status,scopes,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,connected_at,updated_at) VALUES ('bad','imap','bad@example.test','connected','send','a','b','2099-01-01','2026-01-01','2026-01-01')").run(), /CHECK constraint failed/);
  assert.throws(() => db.sqlite.prepare("INSERT INTO smtp_email_connections (user_id,email_address,host,port,username,encrypted_password,connected_at,updated_at) VALUES ('bad','bad@example.test','smtp.example.test',25,'bad','secret','2026-01-01','2026-01-01')").run(), /CHECK constraint failed/);
  assert.throws(() => db.sqlite.prepare("INSERT INTO document_email_deliveries (id,user_id,provider,sender_type,sender_email,document_type,document_id,document_number,recipients_json,subject,status,created_at) VALUES ('bad-delivery','bad','smtp','personal','bad@example.test','packing_slip','bad','BAD','[]','Bad','pending','2026-01-01')").run(), /CHECK constraint failed/);
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
  const purchaseOrderPdf = await documentEmail.getDocumentPdf("purchase_order", "email-po");
  const purchaseOrderSource = Buffer.from(purchaseOrderPdf.body).toString("latin1");
  assert.match(purchaseOrderSource, /PURCHASE ORDER/);
  assert.match(purchaseOrderSource, /ITEM \/ DESCRIPTION/);
  assert.match(purchaseOrderSource, /ITEMS SUBTOTAL/);
  const salesOrderPdf = await documentEmail.getDocumentPdf("sales_order", "email-so");
  const salesOrderSource = Buffer.from(salesOrderPdf.body).toString("latin1");
  assert.match(salesOrderSource, /SALES ORDER/);
  assert.match(salesOrderSource, /CUSTOMER \/ SHIP TO/);
  const invoice = await documentEmail.getDocumentEmailPreview("customer_invoice", "email-invoice");
  assert.equal(invoice.defaultRecipient, "customer@example.test");
  await run("UPDATE customer_invoices SET status='paid',paid_cents=total_cents WHERE id='email-invoice'");
  const printable = await documentEmail.getDocumentPdf("customer_invoice", "email-invoice");
  assert.equal(printable.fileName, "INV-EMAIL.pdf");
  assert.match(Buffer.from(printable.body).subarray(0, 12).toString("ascii"), /^%PDF-1\.4/);
  const invoiceSource = Buffer.from(printable.body).toString("latin1");
  assert.match(invoiceSource, /BALANCE DUE/);
  assert.match(invoiceSource, /Page 1 of 1/);
  const vendorBill = await documentEmail.getDocumentPdf("vendor_bill", "email-bill");
  assert.equal(vendorBill.fileName, "VB-EMAIL.pdf");
  assert.match(Buffer.from(vendorBill.body).subarray(0, 12).toString("ascii"), /^%PDF-1\.4/);
  const vendorBillPreview = await documentEmail.getDocumentEmailPreview("vendor_bill", "email-bill");
  assert.equal(vendorBillPreview.defaultRecipient, "vendor@example.test");
  const workOrderPreview = await documentEmail.getDocumentEmailPreview("work_order", "email-work-order");
  assert.equal(workOrderPreview.defaultRecipient, "customer@example.test");
  assert.equal(workOrderPreview.fileName, "WO-EMAIL.pdf");
  const workOrderPdf = await documentEmail.getDocumentPdf("work_order", "email-work-order");
  const workOrderSource = Buffer.from(workOrderPdf.body).toString("latin1");
  assert.match(workOrderSource, /WORK ORDER/);
  assert.match(workOrderSource, /LABOUR ITEM \/ DETAILS/);
  assert.match(workOrderSource, /Install and test window/);
  assert.match(workOrderSource, /2\.50 hours/);
  await run("UPDATE purchase_orders SET lifecycle_status='draft' WHERE id='email-po'");
  await assert.rejects(documentEmail.getDocumentEmailPreview("purchase_order", "email-po"), /Only an approved purchase order/);
  await run("UPDATE purchase_orders SET lifecycle_status='approved' WHERE id='email-po'");
  assert.equal(documentEmail.emailDocumentCapability("customer_invoice"), "financialWrite");
  assert.equal(documentEmail.emailDocumentCapability("vendor_bill"), "financialWrite");
  assert.equal(documentEmail.emailDocumentCapability("work_order"), "operationalWrite");
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

    gmailRaw = "";
    const billSent = await documentEmail.sendDocumentEmail(operator, {
      documentType: "vendor_bill", documentId: "email-bill", recipients: ["vendor@example.test"],
      subject: "Vendor bill VB-EMAIL", message: "The bill is attached.",
    });
    const billMime = Buffer.from(gmailRaw.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(gmailRaw.length / 4) * 4, "="), "base64").toString("utf8");
    assert.match(billMime, /filename="VB-EMAIL\.pdf"/);
    assert.equal(db.sqlite.prepare("SELECT document_type AS documentType,status FROM document_email_deliveries WHERE id=?").get(billSent.deliveryId).documentType, "vendor_bill");

    gmailRaw = "";
    const workOrderSent = await documentEmail.sendDocumentEmail(operator, {
      documentType: "work_order", documentId: "email-work-order", recipients: ["customer@example.test"],
      subject: "Work order WO-EMAIL", message: "The work order is attached.",
    });
    const workOrderMime = Buffer.from(gmailRaw.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(gmailRaw.length / 4) * 4, "="), "base64").toString("utf8");
    assert.match(workOrderMime, /filename="WO-EMAIL\.pdf"/);
    assert.equal(db.sqlite.prepare("SELECT document_type AS documentType,status FROM document_email_deliveries WHERE id=?").get(workOrderSent.deliveryId).documentType, "work_order");
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

test("an administrator can connect one company sender that is the simple default for every user", async () => {
  await assert.rejects(
    emailClient.createEmailAuthorizationUrl(operator, "https://paneflow.example.test/api/integrations/email/connect", { provider: "google", senderType: "company" }),
    /Only a company administrator/,
  );
  const administrator = { ...operator, role: "administrator" };
  const authorization = await emailClient.createEmailAuthorizationUrl(administrator, "https://paneflow.example.test/api/integrations/email/connect", {
    provider: "google", senderType: "company", returnTo: "/?view=sales-orders",
  });
  const authorizationUrl = new URL(authorization.authorizationUrl);
  assert.equal(authorizationUrl.searchParams.has("login_hint"), false);
  const state = authorizationUrl.searchParams.get("state");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const target = String(input);
      if (target === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "company-access", refresh_token: "company-refresh", expires_in: 3600, scope: "gmail.send" });
      if (target.includes("/oauth2/v3/userinfo")) return Response.json({ email: "office@paneflow.test" });
      if (target.includes("gmail.googleapis.com")) {
        assert.equal(init.headers.authorization, "Bearer company-access");
        return Response.json({ id: "gmail-company-message" });
      }
      throw new Error(`Unexpected company email request ${target}`);
    };
    const completed = await emailClient.completeEmailAuthorization("https://paneflow.example.test/api/integrations/email/callback/google", { provider: "google", state, code: "company-code" });
    assert.equal(completed.senderType, "company");
    const connectionState = await emailClient.getEmailConnectionState(accountant, "https://paneflow.example.test/");
    assert.equal(connectionState.companyConnection.emailAddress, "office@paneflow.test");
    assert.equal(connectionState.personalConnection.emailAddress, "accountant-mailbox@example.test");
    assert.equal(connectionState.defaultSender, "company");
    assert.equal(connectionState.connection.emailAddress, "office@paneflow.test");

    const sent = await documentEmail.sendDocumentEmail(operator, {
      documentType: "sales_order", documentId: "email-so", recipients: ["customer@example.test"], subject: "SO-EMAIL", message: "Attached",
    });
    assert.equal(sent.senderType, "company");
    assert.equal(sent.senderEmail, "office@paneflow.test");
    const delivery = db.sqlite.prepare("SELECT sender_type AS senderType,sender_email AS senderEmail FROM document_email_deliveries WHERE id=?").get(sent.deliveryId);
    assert.equal(delivery.senderType, "company");
    assert.equal(delivery.senderEmail, "office@paneflow.test");
  } finally { globalThis.fetch = originalFetch; }
});

test("submitting a purchase order emails the configured approver with a direct link", async () => {
  const administrator = { ...operator, role: "administrator" };
  await emailClient.setPurchaseOrderApprovalEmail(administrator, " APPROVALS@PANEFLOW.TEST ");
  const connectionState = await emailClient.getEmailConnectionState(operator, "https://paneflow.example.test/");
  assert.equal(connectionState.purchaseOrderApprovalEmail, "approvals@paneflow.test");

  const created = await advancedDomain.executeWorkflow({
    command: "createPurchaseOrderDraft",
    idempotencyKey: "email-submitted-po-create",
    actor: operator,
    appOrigin: "https://paneflow.example.test",
    payload: {
      vendorId: "email-vendor",
      expectedDate: "2026-09-12",
      lines: [{ productId: "email-product", quantity: 1, unitCostCents: 10000 }],
    },
  });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE event_type IN ('purchase_order.draft_approval_email_requested','purchase_order.approval_email_requested') AND aggregate_id=?").get(created.recordId).count, 0);
  await advancedDomain.executeWorkflow({
    command: "submitPurchaseOrder", entityId: created.recordId, version: 1,
    idempotencyKey: "email-submitted-po-alert", actor: operator, appOrigin: "https://paneflow.example.test",
    payload: { reason: "Ready for approval" },
  });
  const queued = db.sqlite.prepare("SELECT id,status,payload_json AS payload FROM outbox_events WHERE event_type='purchase_order.approval_email_requested' AND aggregate_id=?").get(created.recordId);
  assert.equal(queued.status, "pending");
  assert.equal(JSON.parse(queued.payload).recipient, "approvals@paneflow.test");

  const originalFetch = globalThis.fetch;
  let gmailRaw = "";
  try {
    globalThis.fetch = async (input, init = {}) => {
      const target = String(input);
      if (target.includes("gmail.googleapis.com")) {
        assert.equal(init.headers.authorization, "Bearer company-access");
        gmailRaw = JSON.parse(String(init.body)).raw;
        return Response.json({ id: "gmail-submitted-po-alert" });
      }
      throw new Error(`Unexpected draft alert request ${target}`);
    };
    const processed = await outbox.processOutboxBatch({ limit: 10 });
    assert.equal(processed.failed, 0);
    const normalized = gmailRaw.replaceAll("-", "+").replaceAll("_", "/");
    const mime = Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64").toString("utf8");
    assert.doesNotMatch(mime, /application\/pdf/);
    const encodedHtml = mime.split("\r\n\r\n")[1].replace(/\s/gu, "");
    const html = Buffer.from(encodedHtml, "base64").toString("utf8");
    assert.match(html, /ready for your approval/);
    assert.match(html, new RegExp(`po=${created.recordId}`));
    assert.match(html, /view=purchase-orders/);
    assert.equal(db.sqlite.prepare("SELECT status FROM outbox_events WHERE id=?").get(queued.id).status, "processed");
  } finally { globalThis.fetch = originalFetch; }
});

test("approving a draft emails its creator's current account and the configured extra recipients", async () => {
  const administrator = { ...accountant, role: "administrator" };
  await assert.rejects(emailClient.setPurchaseOrderApprovedEmails(operator, "purchasing@example.test"), /Only a company administrator/);
  await emailClient.setPurchaseOrderApprovalEmail(administrator, "");
  const saved = await emailClient.setPurchaseOrderApprovedEmails(administrator,
    " PURCHASING@EXAMPLE.TEST; creator-current@example.test, owner@example.test, purchasing@example.test ");
  assert.equal(saved.purchaseOrderApprovedEmails, "purchasing@example.test, creator-current@example.test, owner@example.test");

  const created = await advancedDomain.executeWorkflow({
    command: "createPurchaseOrderDraft",
    idempotencyKey: "email-approved-po-create",
    actor: operator,
    appOrigin: "https://paneflow.example.test",
    payload: {
      vendorId: "email-vendor",
      expectedDate: "2026-09-14",
      lines: [{ productId: "email-product", quantity: 1, unitCostCents: 12000 }],
    },
  });
  await run("UPDATE app_users SET email='creator-current@example.test' WHERE user_id=?", operator.id);
  await advancedDomain.executeWorkflow({
    command: "submitPurchaseOrder", entityId: created.recordId, version: 1,
    idempotencyKey: "email-approved-po-submit", actor: operator, payload: { reason: "Ready for approval" },
  });
  await advancedDomain.executeWorkflow({
    command: "approvePurchaseOrder", entityId: created.recordId, version: 2,
    idempotencyKey: "email-approved-po-decide", actor: administrator,
    appOrigin: "https://paneflow.example.test", payload: { reason: "Approved" },
  });

  const queued = db.sqlite.prepare("SELECT id,status,payload_json AS payload FROM outbox_events WHERE event_type='purchase_order.approved_email_requested' AND aggregate_id=?").get(created.recordId);
  assert.equal(queued.status, "pending");
  const payload = JSON.parse(queued.payload);
  assert.deepEqual(payload.recipients, ["creator-current@example.test", "purchasing@example.test", "owner@example.test"]);

  const originalFetch = globalThis.fetch;
  let gmailRaw = "";
  try {
    globalThis.fetch = async (input, init = {}) => {
      const target = String(input);
      if (target.includes("gmail.googleapis.com")) {
        assert.equal(init.headers.authorization, "Bearer company-access");
        gmailRaw = JSON.parse(String(init.body)).raw;
        return Response.json({ id: "gmail-approved-po-alert" });
      }
      throw new Error(`Unexpected approved PO alert request ${target}`);
    };
    const processed = await outbox.processOutboxBatch({ limit: 10 });
    assert.equal(processed.failed, 0);
    const normalized = gmailRaw.replaceAll("-", "+").replaceAll("_", "/");
    const mime = Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64").toString("utf8");
    assert.match(mime, /To: creator-current@example\.test, purchasing@example\.test, owner@example\.test/);
    const encodedHtml = mime.split("\r\n\r\n")[1].replace(/\s/gu, "");
    const html = Buffer.from(encodedHtml, "base64").toString("utf8");
    assert.match(html, /has been approved/);
    assert.match(html, new RegExp(`po=${created.recordId}`));
    assert.equal(db.sqlite.prepare("SELECT status FROM outbox_events WHERE id=?").get(queued.id).status, "processed");
  } finally { globalThis.fetch = originalFetch; }
});

test("SMTP setup verifies before replacing the sender, encrypts the password, and sends documents", async () => {
  const administrator = { ...operator, role: "administrator" };
  await assert.rejects(emailClient.saveSmtpConnection(operator, "company", {
    emailAddress: "smtp@paneflow.test", host: "smtp.example.test", port: 587, username: "smtp-user", password: "smtp-password",
  }), /Only a company administrator/);

  smtpClient.setSmtpTransportFactoryForTests(() => ({
    async verify() { throw new Error("Invalid SMTP login"); },
    async sendMail() { throw new Error("send should not run"); },
  }));
  await assert.rejects(emailClient.saveSmtpConnection(administrator, "company", {
    emailAddress: "smtp@paneflow.test", host: "smtp.example.test", port: 587, username: "smtp-user", password: "smtp-password",
  }), /could not be verified/);
  assert.equal(db.sqlite.prepare("SELECT provider FROM email_connections WHERE user_id='__company__'").get().provider, "google");

  let verified;
  let mail;
  smtpClient.setSmtpTransportFactoryForTests((options) => ({
    async verify() { verified = options; return true; },
    async sendMail(input) { mail = input; return { messageId: "smtp-message-email-so" }; },
  }));
  try {
    const connected = await emailClient.saveSmtpConnection(administrator, "company", {
      emailAddress: " SMTP@PANEFLOW.TEST ", host: "SMTP.EXAMPLE.TEST", port: 587, username: "smtp-user", password: "smtp-password",
    });
    assert.deepEqual(connected, { emailAddress: "smtp@paneflow.test", provider: "smtp", senderType: "company" });
    assert.equal(verified.host, "smtp.example.test");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM email_connections WHERE user_id='__company__'").get().count, 0);
    const stored = db.sqlite.prepare("SELECT encrypted_password AS password,status FROM smtp_email_connections WHERE user_id='__company__'").get();
    assert.equal(stored.status, "connected");
    assert.match(stored.password, /^v1\./);
    assert.doesNotMatch(stored.password, /smtp-password/);
    const state = await emailClient.getEmailConnectionState(operator, "https://paneflow.example.test/");
    assert.equal(state.companyConnection.provider, "smtp");
    assert.equal(state.companyConnection.providerLabel, "SMTP");

    const sent = await documentEmail.sendDocumentEmail(operator, {
      documentType: "sales_order", documentId: "email-so", recipients: ["customer@example.test"], subject: "SO-EMAIL via SMTP", message: "Attached",
    });
    assert.equal(sent.senderEmail, "smtp@paneflow.test");
    assert.deepEqual(mail.to, ["customer@example.test"]);
    assert.equal(mail.attachments[0].filename, "SO-EMAIL.pdf");
    assert.match(mail.attachments[0].content.subarray(0, 8).toString("ascii"), /^%PDF-1/);
    const delivery = db.sqlite.prepare("SELECT provider,provider_message_id AS messageId FROM document_email_deliveries WHERE id=?").get(sent.deliveryId);
    assert.equal(delivery.provider, "smtp");
    assert.equal(delivery.messageId, "smtp-message-email-so");

    await emailClient.saveSmtpConnection(operator, "personal", {
      emailAddress: "operator-smtp@paneflow.test", host: "smtp.example.test", port: 465, username: "operator-smtp", password: "personal-password",
    });
    const personalState = await emailClient.getEmailConnectionState(operator, "https://paneflow.example.test/");
    assert.equal(personalState.personalConnection.provider, "smtp");
    assert.equal(personalState.personalConnection.emailAddress, "operator-smtp@paneflow.test");
    assert.equal(personalState.companyConnection.emailAddress, "smtp@paneflow.test");
    const personalSend = await documentEmail.sendDocumentEmail(operator, {
      documentType: "sales_order", documentId: "email-so", recipients: ["customer@example.test"], subject: "Personal SMTP", message: "Attached", senderType: "personal",
    });
    assert.equal(personalSend.senderType, "personal");
    assert.equal(personalSend.senderEmail, "operator-smtp@paneflow.test");
  } finally { smtpClient.setSmtpTransportFactoryForTests(null); }
});
