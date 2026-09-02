import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
const now = "2026-09-02T18:00:00.000Z";
const accountant = { id: "helcim-accountant", email: "billing@paneflow.test", name: "Billing", role: "accounting", label: "Billing <billing@paneflow.test>", localDevelopment: false };
let helcim;
let helcimCrypto;
let qboTransform;

async function applyMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}.*\.sql$/u.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
  }
}

function run(sql, ...values) { return db.prepare(sql).bind(...values).run(); }

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.BOOTSTRAP_DEMO_DATA = "false";
  env.HELCIM_API_TOKEN = "helcim-test-api-token";
  env.HELCIM_WEBHOOK_VERIFIER_TOKEN = Buffer.from("helcim webhook signing material").toString("base64");
  env.HELCIM_TOKEN_ENCRYPTION_KEY = "helcim-test-encryption-key-0123456789abcdef";
  env.HELCIM_CHECKOUT_PAYMENT_METHODS = "cc-ach";
  env.HELCIM_CHECKOUT_MODE = "embedded";
  helcim = await import("../lib/server/helcim-payments.ts");
  helcimCrypto = await import("../lib/server/helcim-crypto.ts");
  qboTransform = await import("../lib/server/qbo-transform.ts");
  await run("INSERT INTO app_users (user_id,email,full_name,role,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)", accountant.id, accountant.email, accountant.name, accountant.role, now, now);
  await run("INSERT INTO business_partners (id,code,name,partner_type,email,country,currency,active,version,created_at) VALUES ('helcim-customer','C-HELCIM','Helcim Customer','customer','customer@example.test','CA','CAD',1,1,?)", now);
  await run("INSERT INTO customer_invoices (id,number,customer_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,posted_at,posted_by,version) VALUES ('helcim-invoice','INV-HELCIM','helcim-customer','posted','2026-09-01','2026-10-01',10000,500,10500,0,'CAD',1,10500,500,'GST','Net 30',?,'Billing',1)", now);
  await run("INSERT INTO customer_invoices (id,number,customer_id,status,invoice_date,due_date,subtotal_cents,tax_cents,total_cents,paid_cents,currency,exchange_rate_to_base,base_total_cents,tax_rate_bps,tax_code,payment_terms,posted_at,posted_by,version) VALUES ('helcim-hosted-invoice','INV-HOSTED','helcim-customer','posted','2026-09-01','2026-10-01',2000,100,2100,0,'CAD',1,2100,500,'GST','Net 30',?,'Billing',1)", now);
});

after(() => db.close());

test("Helcim migration creates constrained durable collection tables", () => {
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%helcim%' OR name='invoice_payment_links' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["helcim_checkout_sessions", "helcim_invoice_mirrors", "helcim_webhook_events", "invoice_payment_links"]);
  assert.throws(() => db.sqlite.prepare("INSERT INTO invoice_payment_links (id,customer_invoice_id,token_hash,status,created_by,created_at,expires_at) VALUES ('bad','helcim-invoice','bad','unknown','test','2026-01-01','2027-01-01')").run(), /CHECK constraint failed/u);
});

test("webhook verification uses Helcim's base64 HMAC signing contract", async () => {
  const webhookId = "msg_helcim_test";
  const timestamp = "1788372000";
  const rawBody = '{"id":"7001","type":"cardTransaction"}';
  const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey("raw", Buffer.from("helcim webhook signing material"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = Buffer.from(await crypto.subtle.sign("HMAC", key, Buffer.from(signedContent))).toString("base64");
  assert.equal(await helcimCrypto.verifyHelcimWebhookSignature({ verifierToken: env.HELCIM_WEBHOOK_VERIFIER_TOKEN, webhookId, timestamp, rawBody, signatureHeader: `v1,${signed}` }), true);
  assert.equal(await helcimCrypto.verifyHelcimWebhookSignature({ verifierToken: env.HELCIM_WEBHOOK_VERIFIER_TOKEN, webhookId, timestamp, rawBody: `${rawBody} `, signatureHeader: `v1,${signed}` }), false);
});

test("card posts once, ACH waits for clearing, and QBO uses Helcim clearing", async () => {
  const originalFetch = globalThis.fetch;
  let checkoutCount = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      if (url.pathname === "/v2/invoices" && method === "POST") {
        const body = JSON.parse(init.body);
        if (body.invoiceNumber === "PF-INV-HELCIM") {
          assert.equal(body.lineItems[0].price, 100);
          assert.equal(body.lineItems[0].taxAmount, 5);
          return Response.json({ invoiceId: 9001, invoiceNumber: body.invoiceNumber, token: "remote-invoice-token" });
        }
        assert.equal(body.invoiceNumber, "PF-INV-HOSTED");
        return Response.json({ invoiceId: 9002, invoiceNumber: body.invoiceNumber, token: "hosted-invoice-token" });
      }
      if (url.pathname === "/v2/invoices/9001" && method === "PUT") {
        const body = JSON.parse(init.body);
        return Response.json({ invoiceId: 9001, invoiceNumber: body.invoiceNumber, token: "remote-invoice-token" });
      }
      if (url.pathname === "/v2/helcim-pay/initialize" && method === "POST") {
        checkoutCount += 1;
        const body = JSON.parse(init.body);
        assert.equal(body.invoiceNumber, "PF-INV-HELCIM");
        assert.equal(body.paymentMethod, "cc-ach");
        return Response.json({ checkoutToken: `checkout-${checkoutCount}`, secretToken: `checkout-secret-${checkoutCount}` });
      }
      if (url.pathname === "/v2/ach/transactions/7002") {
        return Response.json({ transaction: { id: 7002, dateCreated: "2026-09-02 13:00:00", statusAuth: 1, statusClearing: 1, transactionType: 1, amount: 55, currency: 1 } });
      }
      if (url.pathname === "/v2/card-transactions/7003") {
        return Response.json({ id: 7003, dateCreated: "2026-09-02 14:00:00", status: "APPROVED", type: "purchase", amount: 21, currency: "CAD", invoiceNumber: "PF-INV-HOSTED" });
      }
      throw new Error(`Unexpected Helcim fetch ${method} ${url}`);
    };

    const link = await helcim.createInvoicePaymentLink("helcim-invoice", accountant, "https://paneflow.example.test/api/payments/helcim/links");
    const token = new URL(link.url).pathname.split("/").at(-1);
    assert.ok(token);
    assert.equal(db.sqlite.prepare("SELECT token_hash AS tokenHash FROM invoice_payment_links WHERE id=?").get(link.id).tokenHash.includes(token), false);

    const cardCheckout = await helcim.createHelcimCheckout({ paymentLinkToken: token, amountCents: 5000 });
    const stored = db.sqlite.prepare("SELECT encrypted_secret_token AS secret FROM helcim_checkout_sessions WHERE checkout_token=?").get(cardCheckout.checkoutToken);
    assert.match(stored.secret, /^v1\./u);
    assert.doesNotMatch(stored.secret, /checkout-secret/u);
    const cardTransaction = {
      transactionId: "7001", dateCreated: "2026-09-02 12:00:00", status: "APPROVED", type: "purchase",
      amount: "50.00", currency: "CAD", invoiceNumber: "PF-INV-HELCIM", cardNumber: "5454545454", cardToken: "must-not-persist",
    };
    const cardHash = await helcimCrypto.sha256Hex(`${JSON.stringify(cardTransaction)}checkout-secret-1`);
    const completed = await helcim.completeHelcimCheckout({ paymentLinkToken: token, checkoutToken: cardCheckout.checkoutToken, eventMessage: { data: cardTransaction, hash: cardHash } });
    assert.equal(completed.status, "paid");
    assert.equal(db.sqlite.prepare("SELECT paid_cents AS paid FROM customer_invoices WHERE id='helcim-invoice'").get().paid, 5000);
    const cardPayment = db.sqlite.prepare("SELECT id,method,reference FROM payments WHERE document_id='helcim-invoice'").get();
    assert.equal(cardPayment.method, "helcim_card");
    assert.equal(db.sqlite.prepare("SELECT provider_response_json AS json FROM helcim_checkout_sessions WHERE checkout_token='checkout-1'").get().json.includes("5454545454"), false);
    assert.equal((await helcim.completeHelcimCheckout({ paymentLinkToken: token, checkoutToken: cardCheckout.checkoutToken, eventMessage: { data: cardTransaction, hash: cardHash } })).status, "paid");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM payments WHERE document_id='helcim-invoice'").get().count, 1);

    const context = {
      accounts: new Map([["helcim_clearing", { qboAccountId: "qbo-helcim-clearing", qboAccountName: "Helcim Clearing", active: 1 }]]),
      references: new Map([["payment_method:helcim_card", { qboEntityId: "qbo-method-card", qboEntityName: "Credit Card", active: 1 }]]),
      links: new Map([
        ["business_partner_customer:helcim-customer:Customer", { qboEntityId: "qbo-customer", status: "synced" }],
        ["customer_invoice:helcim-invoice:Invoice", { qboEntityId: "qbo-invoice", status: "synced" }],
      ]),
    };
    const qboPayment = await qboTransform.mapQboDelivery({ localEntityType: "payment", localEntityId: cardPayment.id }, context);
    assert.equal(qboPayment.body.DepositToAccountRef.value, "qbo-helcim-clearing");
    assert.equal(qboPayment.body.PaymentType, "CreditCard");

    const achCheckout = await helcim.createHelcimCheckout({ paymentLinkToken: token, amountCents: 5500 });
    const achTransaction = {
      transactionId: "7002", dateCreated: "2026-09-02 13:00:00", statusAuth: "PENDING", statusClearing: "OPENED", type: "WITHDRAWAL",
      amount: "55.00", currency: "CAD", invoiceNumber: "PF-INV-HELCIM", bankAccountNumber: "100200300", bankToken: "must-not-persist",
    };
    const achHash = await helcimCrypto.sha256Hex(`${JSON.stringify(achTransaction)}checkout-secret-2`);
    const pending = await helcim.completeHelcimCheckout({ paymentLinkToken: token, checkoutToken: achCheckout.checkoutToken, eventMessage: { data: achTransaction, hash: achHash } });
    assert.equal(pending.status, "processing");
    assert.equal(db.sqlite.prepare("SELECT paid_cents AS paid FROM customer_invoices WHERE id='helcim-invoice'").get().paid, 5000);
    await helcim.processHelcimIntegrationBatch(10);
    const invoice = db.sqlite.prepare("SELECT status,paid_cents AS paid FROM customer_invoices WHERE id='helcim-invoice'").get();
    assert.equal(invoice.status, "paid");
    assert.equal(invoice.paid, 10500);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM payments WHERE document_id='helcim-invoice'").get().count, 2);
    assert.equal(db.sqlite.prepare("SELECT status FROM invoice_payment_links WHERE id=?").get(link.id).status, "paid");

    env.HELCIM_CHECKOUT_MODE = "hosted";
    env.HELCIM_INVOICE_HOST = "paneflow-tests.myhelcim.com";
    const hostedLink = await helcim.createInvoicePaymentLink("helcim-hosted-invoice", accountant, "https://private-paneflow.example.test/api/payments/helcim/links");
    assert.equal(hostedLink.checkoutMode, "hosted");
    assert.equal(hostedLink.url, "https://paneflow-tests.myhelcim.com/order/?token=hosted-invoice-token");
    const webhookBody = JSON.stringify({ id: "7003", type: "cardTransaction" });
    const webhookId = "msg_hosted_card_7003";
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const webhookKey = await crypto.subtle.importKey("raw", Buffer.from("helcim webhook signing material"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const webhookSignature = Buffer.from(await crypto.subtle.sign("HMAC", webhookKey, Buffer.from(`${webhookId}.${timestamp}.${webhookBody}`))).toString("base64");
    const accepted = await helcim.recordHelcimWebhook(new Request("https://private-paneflow.example.test/api/integrations/helcim/webhook", {
      method: "POST", body: webhookBody, headers: { "content-type": "application/json", "webhook-id": webhookId, "webhook-timestamp": timestamp, "webhook-signature": `v1,${webhookSignature}` },
    }));
    assert.equal(accepted.duplicate, false);
    await helcim.processHelcimIntegrationBatch(10);
    const hostedInvoice = db.sqlite.prepare("SELECT status,paid_cents AS paid FROM customer_invoices WHERE id='helcim-hosted-invoice'").get();
    assert.equal(hostedInvoice.status, "paid");
    assert.equal(hostedInvoice.paid, 2100);
    assert.equal(db.sqlite.prepare("SELECT status FROM helcim_webhook_events WHERE webhook_id=?").get(webhookId).status, "processed");
  } finally { globalThis.fetch = originalFetch; }
});
