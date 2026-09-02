import { env } from "cloudflare:workers";
import type { ActorIdentity } from "./auth";
import { executeWorkflow, WorkflowError } from "./advanced-domain";
import { ensureDatabase, first, getD1, newId } from "./inventory-db";
import { processOutboxBatch } from "./outbox";
import {
  constantTimeEqual,
  decryptHelcimSecret,
  encryptHelcimSecret,
  randomUrlSafeString,
  sha256Hex,
  verifyHelcimWebhookSignature,
} from "./helcim-crypto";

const HELCIM_API_BASE = "https://api.helcim.com/v2";
const checkoutLifetimeMs = 60 * 60 * 1_000;
const webhookClockToleranceSeconds = 24 * 60 * 60;

type Row = Record<string, unknown>;
type HelcimMethod = "card" | "eft";

type InvoiceForPayment = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  creditedCents: number;
  outstandingCents: number;
  currency: string;
  version: number;
};

type CheckoutSession = {
  id: string;
  paymentLinkId: string;
  customerInvoiceId: string;
  checkoutToken: string;
  encryptedSecretToken: string;
  amountCents: number;
  currency: string;
  status: string;
  providerTransactionId: string | null;
  providerMethod: string | null;
  paymentId: string | null;
  expiresAt: string;
};

export class HelcimPaymentError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryable = false) {
    super(message);
    this.name = "HelcimPaymentError";
  }
}

function runtimeEnv() {
  return env as unknown as Record<string, string | undefined>;
}

export function getHelcimConfigurationStatus() {
  const runtime = runtimeEnv();
  const checkoutMode = runtime.HELCIM_CHECKOUT_MODE?.trim().toLowerCase() === "embedded" ? "embedded" : "hosted";
  const configuredInvoiceHost = text(runtime.HELCIM_INVOICE_HOST).replace(/^https?:\/\//iu, "").replace(/\/+$/u, "").toLowerCase();
  const invoiceHost = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.myhelcim\.com$/u.test(configuredInvoiceHost) ? configuredInvoiceHost : "";
  const missing = [
    ["HELCIM_API_TOKEN", runtime.HELCIM_API_TOKEN],
    ["HELCIM_TOKEN_ENCRYPTION_KEY", runtime.HELCIM_TOKEN_ENCRYPTION_KEY],
    ...(checkoutMode === "hosted" ? [["HELCIM_INVOICE_HOST", invoiceHost]] : []),
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  const requestedMethod = runtime.HELCIM_CHECKOUT_PAYMENT_METHODS?.trim().toLowerCase();
  const paymentMethod = requestedMethod === "cc" || requestedMethod === "ach" || requestedMethod === "cc-ach" ? requestedMethod : "cc-ach";
  return {
    configured: missing.length === 0,
    missing,
    paymentMethod,
    checkoutMode,
    invoiceHost,
    webhookConfigured: Boolean(runtime.HELCIM_WEBHOOK_VERIFIER_TOKEN?.trim()),
    message: missing.length ? `Add ${missing.join(", ")} before issuing live payment links.` : "Helcim payment collection is configured.",
  };
}

function requiredConfiguration() {
  const status = getHelcimConfigurationStatus();
  if (!status.configured) throw new HelcimPaymentError("HELCIM_NOT_CONFIGURED", status.message, 503);
  const runtime = runtimeEnv();
  return {
    apiToken: runtime.HELCIM_API_TOKEN!,
    verifierToken: runtime.HELCIM_WEBHOOK_VERIFIER_TOKEN?.trim() ?? "",
    encryptionKey: runtime.HELCIM_TOKEN_ENCRYPTION_KEY!,
    paymentMethod: status.paymentMethod,
    checkoutMode: status.checkoutMode,
    invoiceHost: status.invoiceHost,
  };
}

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function cents(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
}

function safeProviderJson(value: Row) {
  const blocked = new Set(["cardnumber", "cardholdername", "cardtoken", "bankaccountnumber", "banktoken"]);
  const clean = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(clean);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item as Row)
      .filter(([key]) => !blocked.has(key.toLowerCase()))
      .map(([key, nested]) => [key, clean(nested)]));
    return item;
  };
  return JSON.stringify(clean(value));
}

function providerErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as Row;
  if (typeof body.errors === "string") return body.errors.slice(0, 500);
  if (body.errors && typeof body.errors === "object") return Object.values(body.errors as Row).map(text).filter(Boolean).join("; ").slice(0, 500) || fallback;
  return text(body.message || body.error).slice(0, 500) || fallback;
}

async function helcimRequest(path: string, init: RequestInit = {}, idempotencyKey?: string) {
  const config = requiredConfiguration();
  const response = await fetch(`${HELCIM_API_BASE}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "api-token": config.apiToken,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    throw new HelcimPaymentError(
      response.status === 401 || response.status === 403 ? "HELCIM_AUTHORIZATION_FAILED" : "HELCIM_API_ERROR",
      providerErrorMessage(payload, `Helcim returned HTTP ${response.status}.`),
      response.status === 429 || response.status >= 500 ? 503 : 502,
      response.status === 429 || response.status >= 500,
    );
  }
  return payload as Row;
}

async function invoiceById(invoiceId: string): Promise<InvoiceForPayment | null> {
  return first<InvoiceForPayment>(`SELECT ci.id,ci.number,bp.name AS customerName,ci.status,ci.invoice_date AS invoiceDate,ci.due_date AS dueDate,
    ci.subtotal_cents AS subtotalCents,ci.tax_cents AS taxCents,ci.total_cents AS totalCents,ci.paid_cents AS paidCents,
    COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS creditedCents,
    ci.total_cents-ci.paid_cents-COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS outstandingCents,
    ci.currency,ci.version FROM customer_invoices ci JOIN business_partners bp ON bp.id=ci.customer_id WHERE ci.id=?`, invoiceId);
}

function assertCollectible(invoice: InvoiceForPayment | null) {
  if (!invoice || /^void/iu.test(invoice.status)) throw new HelcimPaymentError("INVOICE_NOT_FOUND", "This invoice is not available for online payment.", 404);
  if (invoice.outstandingCents <= 0 || ["paid", "credited"].includes(invoice.status.toLowerCase())) {
    throw new HelcimPaymentError("INVOICE_SETTLED", "This invoice no longer has an outstanding balance.", 409);
  }
  if (!['CAD', 'USD'].includes(invoice.currency.toUpperCase())) throw new HelcimPaymentError("CURRENCY_NOT_SUPPORTED", "Helcim checkout supports CAD or USD invoices.", 409);
  return invoice;
}

function paymentLinkTtlDays() {
  const configured = Number(runtimeEnv().HELCIM_PAYMENT_LINK_TTL_DAYS ?? 90);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 90;
}

function publicOrigin(requestUrl: string) {
  const url = new URL(requestUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new HelcimPaymentError("HTTPS_REQUIRED", "Customer payment links require an HTTPS site origin.", 503);
  }
  return url.origin;
}

export async function createInvoicePaymentLink(invoiceId: string, actor: ActorIdentity, requestUrl: string, source = "staff") {
  await ensureDatabase();
  requiredConfiguration();
  const invoice = assertCollectible(await invoiceById(invoiceId));
  const configuration = requiredConfiguration();
  const token = randomUrlSafeString(32);
  const mirror = configuration.checkoutMode === "hosted" ? await ensureHelcimInvoice(invoice) : null;
  if (configuration.checkoutMode === "hosted" && !mirror?.helcimInvoiceToken) {
    throw new HelcimPaymentError("HELCIM_INVOICE_LINK_UNAVAILABLE", "Helcim did not return the public token for this invoice.", 502);
  }
  const tokenHash = await sha256Hex(configuration.checkoutMode === "hosted" ? `${mirror!.helcimInvoiceToken}:${token}` : token);
  const id = newId("payment-link");
  const now = new Date();
  const expires = new Date(now.getTime() + paymentLinkTtlDays() * 86_400_000);
  const url = configuration.checkoutMode === "hosted"
    ? `https://${configuration.invoiceHost}/order/?token=${encodeURIComponent(mirror!.helcimInvoiceToken!)}`
    : `${publicOrigin(requestUrl)}/pay/${token}`;
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO invoice_payment_links (id,customer_invoice_id,token_hash,status,created_by,created_at,expires_at)
      VALUES (?,?,?,'active',?,?,?)`).bind(id, invoice.id, tokenHash, actor.label, now.toISOString(), expires.toISOString()),
    db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      VALUES (?,'customer_invoice',?,'payment_link_created',?,?,?,?,?,?)`)
      .bind(newId("audit"), invoice.id, `Secure Helcim payment link created for ${invoice.number}.`, actor.label, actor.id, actor.email, JSON.stringify({ paymentLinkId: id, source, checkoutMode: configuration.checkoutMode, expiresAt: expires.toISOString() }), now.toISOString()),
  ]);
  return { id, invoiceId: invoice.id, invoiceNumber: invoice.number, url, checkoutMode: configuration.checkoutMode, expiresAt: expires.toISOString() };
}

export async function maybeCreateInvoicePaymentLink(invoiceId: string, actor: ActorIdentity, requestUrl: string, source = "invoice_email") {
  if (!getHelcimConfigurationStatus().configured) return null;
  try { return await createInvoicePaymentLink(invoiceId, actor, requestUrl, source); }
  catch (error) {
    if (error instanceof HelcimPaymentError && ["INVOICE_SETTLED", "INVOICE_NOT_FOUND"].includes(error.code)) return null;
    throw error;
  }
}

async function paymentLinkByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/u.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  return first<InvoiceForPayment & { paymentLinkId: string; linkStatus: string; expiresAt: string }>(`SELECT l.id AS paymentLinkId,l.status AS linkStatus,l.expires_at AS expiresAt,
    ci.id,ci.number,bp.name AS customerName,ci.status,ci.invoice_date AS invoiceDate,ci.due_date AS dueDate,
    ci.subtotal_cents AS subtotalCents,ci.tax_cents AS taxCents,ci.total_cents AS totalCents,ci.paid_cents AS paidCents,
    COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS creditedCents,
    ci.total_cents-ci.paid_cents-COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0) AS outstandingCents,
    ci.currency,ci.version FROM invoice_payment_links l JOIN customer_invoices ci ON ci.id=l.customer_invoice_id
    JOIN business_partners bp ON bp.id=ci.customer_id WHERE l.token_hash=? LIMIT 1`, tokenHash);
}

export async function getPublicInvoiceForPayment(token: string) {
  await ensureDatabase();
  const link = await paymentLinkByToken(token);
  if (!link || link.linkStatus === "revoked") return { available: false as const, reason: "not_found" as const };
  if (link.linkStatus === "expired" || link.expiresAt <= new Date().toISOString()) return { available: false as const, reason: "expired" as const };
  if (link.outstandingCents <= 0 || link.linkStatus === "paid" || ["paid", "credited"].includes(link.status.toLowerCase())) {
    return { available: false as const, reason: "paid" as const, invoiceNumber: link.number, customerName: link.customerName };
  }
  if (/^void/iu.test(link.status)) return { available: false as const, reason: "void" as const };
  const configuration = getHelcimConfigurationStatus();
  return {
    available: configuration.configured,
    reason: configuration.configured ? null : "configuration" as const,
    invoiceId: link.id,
    invoiceNumber: link.number,
    customerName: link.customerName,
    invoiceDate: link.invoiceDate,
    dueDate: link.dueDate,
    outstandingCents: link.outstandingCents,
    currency: link.currency,
    paymentMethods: link.currency.toUpperCase() === "CAD" ? configuration.paymentMethod : "cc",
  };
}

function helcimInvoiceNumber(invoice: InvoiceForPayment) {
  return `PF-${invoice.number}`.replaceAll(/[^A-Za-z0-9._-]/gu, "-").slice(0, 50);
}

function invoicePayload(invoice: InvoiceForPayment) {
  return {
    currency: invoice.currency.toUpperCase(),
    invoiceNumber: helcimInvoiceNumber(invoice),
    lineItems: [{
      sku: invoice.number.slice(0, 50),
      description: `PaneFlow invoice ${invoice.number}`,
      quantity: 1,
      price: invoice.subtotalCents / 100,
      taxAmount: invoice.taxCents / 100,
    }],
    type: "INVOICE",
    notes: `PaneFlow receivable ${invoice.number}. PaneFlow remains the accounting system of record.`,
  };
}

function unwrappedInvoice(payload: Row) {
  const candidate = (payload.invoice && typeof payload.invoice === "object" ? payload.invoice : payload.data && typeof payload.data === "object" ? payload.data : payload) as Row;
  return {
    id: text(candidate.invoiceId || candidate.id),
    number: text(candidate.invoiceNumber),
    token: text(candidate.token) || null,
  };
}

async function findRemoteInvoice(invoiceNumber: string) {
  const payload = await helcimRequest(`/invoices?invoiceNumber=${encodeURIComponent(invoiceNumber)}`);
  const candidates = Array.isArray(payload.invoices) ? payload.invoices : Array.isArray(payload.data) ? payload.data : [];
  const matching = (candidates as Row[]).find((item) => text(item.invoiceNumber) === invoiceNumber);
  return matching ? unwrappedInvoice(matching) : null;
}

async function ensureHelcimInvoice(invoice: InvoiceForPayment) {
  const existing = await first<{ helcimInvoiceId: string; helcimInvoiceNumber: string; helcimInvoiceToken: string | null; localVersion: number }>(
    `SELECT helcim_invoice_id AS helcimInvoiceId,helcim_invoice_number AS helcimInvoiceNumber,helcim_invoice_token AS helcimInvoiceToken,
      local_version AS localVersion FROM helcim_invoice_mirrors WHERE customer_invoice_id=?`, invoice.id,
  );
  if (existing && Number(existing.localVersion) === Number(invoice.version)) return existing;
  const payload = invoicePayload(invoice);
  let remote: ReturnType<typeof unwrappedInvoice>;
  if (existing) {
    remote = unwrappedInvoice(await helcimRequest(`/invoices/${encodeURIComponent(existing.helcimInvoiceId)}`, { method: "PUT", body: JSON.stringify(payload) }, `paneflow-${invoice.id}-v${invoice.version}`));
  } else {
    try {
      remote = unwrappedInvoice(await helcimRequest("/invoices", { method: "POST", body: JSON.stringify({ ...payload, status: "DUE" }) }, `paneflow-${invoice.id}-v${invoice.version}`));
    } catch (error) {
      if (!(error instanceof HelcimPaymentError) || error.retryable) throw error;
      remote = await findRemoteInvoice(payload.invoiceNumber) ?? (() => { throw error; })();
    }
  }
  if (!remote.id || !remote.number) throw new HelcimPaymentError("HELCIM_INVALID_RESPONSE", "Helcim did not return an invoice identity.", 502);
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO helcim_invoice_mirrors
    (customer_invoice_id,helcim_invoice_id,helcim_invoice_number,helcim_invoice_token,local_version,synced_at,last_error)
    VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(customer_invoice_id) DO UPDATE SET helcim_invoice_id=excluded.helcim_invoice_id,
    helcim_invoice_number=excluded.helcim_invoice_number,helcim_invoice_token=excluded.helcim_invoice_token,
    local_version=excluded.local_version,synced_at=excluded.synced_at,last_error=NULL`)
    .bind(invoice.id, remote.id, remote.number, remote.token, invoice.version, now).run();
  return { helcimInvoiceId: remote.id, helcimInvoiceNumber: remote.number, helcimInvoiceToken: remote.token, localVersion: invoice.version };
}

export async function createHelcimCheckout(input: { paymentLinkToken: string; amountCents?: unknown }) {
  await ensureDatabase();
  const config = requiredConfiguration();
  const link = await paymentLinkByToken(input.paymentLinkToken);
  if (!link || link.linkStatus !== "active" || link.expiresAt <= new Date().toISOString()) throw new HelcimPaymentError("PAYMENT_LINK_INVALID", "This payment link is invalid or has expired.", 404);
  const invoice = assertCollectible(await invoiceById(link.id));
  const requestedAmount = input.amountCents == null ? invoice.outstandingCents : Number(input.amountCents);
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount < 100) throw new HelcimPaymentError("INVALID_AMOUNT", "Enter a payment amount of at least 1.00.");
  if (requestedAmount > invoice.outstandingCents) throw new HelcimPaymentError("OVERPAYMENT", "The payment amount exceeds the current invoice balance.", 409);
  const mirror = await ensureHelcimInvoice(invoice);
  const id = newId("helcim-checkout");
  const paymentMethod = invoice.currency.toUpperCase() === "CAD" ? config.paymentMethod : "cc";
  const response = await helcimRequest("/helcim-pay/initialize", {
    method: "POST",
    body: JSON.stringify({
      paymentType: "purchase",
      amount: requestedAmount / 100,
      currency: invoice.currency.toUpperCase(),
      invoiceNumber: mirror.helcimInvoiceNumber,
      paymentMethod,
      allowPartial: 0,
      confirmationScreen: true,
      displayContactFields: 1,
      language: "en",
    }),
  }, id);
  const checkoutToken = text(response.checkoutToken);
  const secretToken = text(response.secretToken);
  if (!checkoutToken || !secretToken) throw new HelcimPaymentError("HELCIM_INVALID_RESPONSE", "Helcim did not return a checkout session.", 502);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + checkoutLifetimeMs);
  const encryptedSecret = await encryptHelcimSecret(secretToken, config.encryptionKey, id);
  await getD1().batch([
    getD1().prepare(`INSERT INTO helcim_checkout_sessions
      (id,payment_link_id,customer_invoice_id,checkout_token,encrypted_secret_token,amount_cents,currency,status,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,'initialized',?,?)`)
      .bind(id, link.paymentLinkId, invoice.id, checkoutToken, encryptedSecret, requestedAmount, invoice.currency.toUpperCase(), createdAt.toISOString(), expiresAt.toISOString()),
    getD1().prepare("UPDATE invoice_payment_links SET last_viewed_at=? WHERE id=?").bind(createdAt.toISOString(), link.paymentLinkId),
  ]);
  return { checkoutToken, amountCents: requestedAmount, currency: invoice.currency.toUpperCase(), expiresAt: expiresAt.toISOString() };
}

function jsonForHelcimHash(value: Row) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function parsedEventMessage(value: unknown) {
  let root = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!root || typeof root !== "object") throw new HelcimPaymentError("INVALID_HELCIM_RESPONSE", "The Helcim response was not valid JSON.");
  const record = root as Row;
  if (record.status && record.data && typeof record.data === "object" && (record.data as Row).data) root = record.data;
  const envelope = root as Row;
  if (!envelope.data || typeof envelope.data !== "object" || !text(envelope.hash)) throw new HelcimPaymentError("INVALID_HELCIM_RESPONSE", "The Helcim transaction response was incomplete.");
  return { transaction: envelope.data as Row, hash: text(envelope.hash) };
}

function transactionId(transaction: Row) {
  return text(transaction.transactionId || transaction.id);
}

function transactionCurrency(transaction: Row) {
  const value = transaction.currency;
  if (Number(value) === 1) return "CAD";
  if (Number(value) === 2) return "USD";
  return text(value).toUpperCase();
}

function transactionMethod(transaction: Row): HelcimMethod {
  return transaction.statusAuth != null || transaction.statusClearing != null || /withdraw|ach|bank/iu.test(text(transaction.type || transaction.transactionType)) ? "eft" : "card";
}

function transactionDecision(transaction: Row, method: HelcimMethod) {
  if (method === "card") {
    const status = text(transaction.status).toUpperCase();
    return /^APPROV/iu.test(status) ? "settled" : /DECLIN|VOID|CANCEL|REFUND|REVERSE/iu.test(status) ? "failed" : "pending";
  }
  const auth = transaction.statusAuth;
  const clearing = transaction.statusClearing;
  if (Number(auth) === 2 || Number(auth) === 4 || Number(clearing) === 4 || /DECLIN|CANCEL|REJECT|RETURN|CONTEST/iu.test(`${text(auth)} ${text(clearing)}`)) return "failed";
  if ((Number(auth) === 1 && Number(clearing) === 1) || /CLEARED/iu.test(text(clearing))) return "settled";
  return "pending";
}

function providerStatus(transaction: Row) {
  return [transaction.status, transaction.statusAuth, transaction.statusClearing].map(text).filter(Boolean).join("/") || "unknown";
}

async function checkoutSession(checkoutToken: string, paymentLinkToken?: string) {
  const linkHash = paymentLinkToken ? await sha256Hex(paymentLinkToken) : null;
  return first<CheckoutSession>(`SELECT s.id,s.payment_link_id AS paymentLinkId,s.customer_invoice_id AS customerInvoiceId,
    s.checkout_token AS checkoutToken,s.encrypted_secret_token AS encryptedSecretToken,s.amount_cents AS amountCents,
    s.currency,s.status,s.provider_transaction_id AS providerTransactionId,s.provider_method AS providerMethod,
    s.payment_id AS paymentId,s.expires_at AS expiresAt FROM helcim_checkout_sessions s
    ${linkHash ? "JOIN invoice_payment_links l ON l.id=s.payment_link_id" : ""}
    WHERE s.checkout_token=? ${linkHash ? "AND l.token_hash=?" : ""} LIMIT 1`, ...(linkHash ? [checkoutToken, linkHash] : [checkoutToken]));
}

function validateTransaction(session: CheckoutSession, transaction: Row) {
  const id = transactionId(transaction);
  if (!/^\d{1,30}$/u.test(id)) throw new HelcimPaymentError("INVALID_TRANSACTION", "Helcim did not return a valid transaction identifier.");
  if (cents(transaction.amount) !== Number(session.amountCents)) throw new HelcimPaymentError("PAYMENT_MISMATCH", "The Helcim amount does not match this checkout session.", 409);
  if (transactionCurrency(transaction) !== session.currency.toUpperCase()) throw new HelcimPaymentError("PAYMENT_MISMATCH", "The Helcim currency does not match this checkout session.", 409);
  return id;
}

async function settleSession(session: CheckoutSession, transaction: Row, method: HelcimMethod) {
  if (session.status === "settled" && session.paymentId) return { status: "paid" as const, paymentId: session.paymentId };
  const id = validateTransaction(session, transaction);
  const transactionDate = text(transaction.dateCreated).slice(0, 10);
  const paymentDate = /^\d{4}-\d{2}-\d{2}$/u.test(transactionDate) ? transactionDate : new Date().toISOString().slice(0, 10);
  const actor: ActorIdentity = {
    id: "integration-helcim",
    email: "payments@integration.paneflow",
    name: "Helcim integration",
    role: "accounting",
    label: "Helcim integration",
    localDevelopment: false,
  };
  try {
    const result = await executeWorkflow({
      command: "recordPayment",
      entityId: session.customerInvoiceId,
      idempotencyKey: `helcim-${method}-${id}-settlement`,
      actor,
      payload: {
        documentType: "customer_invoice",
        amountCents: session.amountCents,
        paymentDate,
        method: method === "card" ? "helcim_card" : "helcim_eft",
        reference: `Helcim ${id}`,
      },
    });
    const now = new Date().toISOString();
    await getD1().batch([
      getD1().prepare(`UPDATE helcim_checkout_sessions SET status='settled',provider_transaction_id=?,provider_method=?,provider_status=?,
        payment_id=?,completed_at=COALESCE(completed_at,?),reconciled_at=?,last_error=NULL WHERE id=?`)
        .bind(id, method, providerStatus(transaction), result.recordId ?? null, now, now, session.id),
      getD1().prepare(`UPDATE invoice_payment_links SET status='paid' WHERE customer_invoice_id=? AND status='active'
        AND NOT EXISTS (SELECT 1 FROM customer_invoices ci WHERE ci.id=? AND ci.total_cents-ci.paid_cents-
          COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0)>0)`)
        .bind(session.customerInvoiceId, session.customerInvoiceId),
    ]);
    try { await processOutboxBatch({ limit: 10 }); } catch { /* the durable outbox will retry */ }
    return { status: "paid" as const, paymentId: result.recordId ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : "PaneFlow could not apply the payment.";
    await getD1().prepare("UPDATE helcim_checkout_sessions SET status='review',last_error=?,reconciled_at=? WHERE id=?")
      .bind(message, new Date().toISOString(), session.id).run();
    if (error instanceof WorkflowError) throw new HelcimPaymentError("PAYMENT_REQUIRES_REVIEW", `Helcim accepted the payment, but PaneFlow could not apply it automatically: ${error.message}`, 409);
    throw error;
  }
}

async function recordTransaction(session: CheckoutSession, transaction: Row) {
  const id = validateTransaction(session, transaction);
  const method = transactionMethod(transaction);
  const decision = transactionDecision(transaction, method);
  const now = new Date().toISOString();
  const duplicate = await first<{ id: string }>("SELECT id FROM helcim_checkout_sessions WHERE provider_transaction_id=? AND id<>?", id, session.id);
  if (duplicate) throw new HelcimPaymentError("DUPLICATE_TRANSACTION", "This Helcim transaction is already linked to another checkout.", 409);
  await getD1().prepare(`UPDATE helcim_checkout_sessions SET provider_transaction_id=?,provider_method=?,provider_status=?,provider_response_json=?,
    status=?,completed_at=COALESCE(completed_at,?),reconciled_at=?,last_error=NULL WHERE id=?`)
    .bind(id, method, providerStatus(transaction), safeProviderJson(transaction), decision === "settled" ? "pending" : decision, now, now, session.id).run();
  const refreshed = await checkoutSession(session.checkoutToken);
  if (!refreshed) throw new HelcimPaymentError("CHECKOUT_NOT_FOUND", "The checkout session could not be reloaded.", 404);
  if (decision === "settled") return settleSession(refreshed, transaction, method);
  if (decision === "failed") return { status: "failed" as const, message: "Helcim did not approve this payment." };
  return { status: "processing" as const, message: method === "eft" ? "Your bank payment is processing. The invoice will be updated after bank clearing completes." : "Helcim is still processing this payment." };
}

export async function completeHelcimCheckout(input: { paymentLinkToken: string; checkoutToken: string; eventMessage: unknown }) {
  await ensureDatabase();
  const config = requiredConfiguration();
  const session = await checkoutSession(input.checkoutToken, input.paymentLinkToken);
  if (!session) throw new HelcimPaymentError("CHECKOUT_NOT_FOUND", "This checkout session does not match the payment link.", 404);
  if (session.status === "settled") return { status: "paid" as const, paymentId: session.paymentId };
  if (["failed", "expired", "review"].includes(session.status)) throw new HelcimPaymentError("CHECKOUT_CLOSED", "This checkout session is closed. Refresh the page before trying again.", 409);
  const { transaction, hash } = parsedEventMessage(input.eventMessage);
  const secret = await decryptHelcimSecret(session.encryptedSecretToken, config.encryptionKey, session.id);
  const expectedHash = await sha256Hex(`${jsonForHelcimHash(transaction)}${secret}`);
  if (!constantTimeEqual(hash.toLowerCase(), expectedHash.toLowerCase())) throw new HelcimPaymentError("INVALID_HELCIM_SIGNATURE", "The Helcim response signature could not be verified.", 403);
  const mirror = await first<{ helcimInvoiceNumber: string }>("SELECT helcim_invoice_number AS helcimInvoiceNumber FROM helcim_invoice_mirrors WHERE customer_invoice_id=?", session.customerInvoiceId);
  if (text(transaction.invoiceNumber) && text(transaction.invoiceNumber) !== mirror?.helcimInvoiceNumber) throw new HelcimPaymentError("PAYMENT_MISMATCH", "The Helcim invoice does not match this checkout session.", 409);
  return recordTransaction(session, transaction);
}

function unwrappedTransaction(payload: Row) {
  if (payload.transaction && typeof payload.transaction === "object") return payload.transaction as Row;
  if (payload.data && typeof payload.data === "object") return payload.data as Row;
  return payload;
}

async function fetchProviderTransaction(id: string, method: HelcimMethod) {
  return unwrappedTransaction(await helcimRequest(method === "eft" ? `/ach/transactions/${encodeURIComponent(id)}` : `/card-transactions/${encodeURIComponent(id)}`));
}

function providerTransactions(payload: Row) {
  const collection = Array.isArray(payload.transactions) ? payload.transactions : Array.isArray(payload.data) ? payload.data : [];
  return (collection as unknown[]).map((item) => item && typeof item === "object" ? unwrappedTransaction(item as Row) : null).filter((item): item is Row => Boolean(item));
}

async function matchSessionForTransaction(transaction: Row, method: HelcimMethod) {
  const id = transactionId(transaction);
  const direct = await first<{ checkoutToken: string }>("SELECT checkout_token AS checkoutToken FROM helcim_checkout_sessions WHERE provider_transaction_id=?", id);
  if (direct) return checkoutSession(direct.checkoutToken);
  const invoiceNumber = text(transaction.invoiceNumber);
  const amountCents = cents(transaction.amount);
  const currency = transactionCurrency(transaction);
  if (!invoiceNumber || !Number.isSafeInteger(amountCents) || !currency) return null;
  const candidates = await getD1().prepare(`SELECT s.checkout_token AS checkoutToken FROM helcim_checkout_sessions s
    JOIN helcim_invoice_mirrors m ON m.customer_invoice_id=s.customer_invoice_id
    WHERE m.helcim_invoice_number=? AND s.amount_cents=? AND s.currency=? AND s.status IN ('initialized','pending')
    ORDER BY s.created_at DESC LIMIT 2`).bind(invoiceNumber, amountCents, currency).all<{ checkoutToken: string }>();
  if (candidates.results.length === 0) return hostedInvoiceSession(transaction, method);
  if (candidates.results.length !== 1) return null;
  const matched = await checkoutSession(candidates.results[0].checkoutToken);
  if (matched) await getD1().prepare("UPDATE helcim_checkout_sessions SET provider_transaction_id=?,provider_method=? WHERE id=? AND provider_transaction_id IS NULL")
    .bind(id, method, matched.id).run();
  return matched ? checkoutSession(matched.checkoutToken) : null;
}

async function hostedInvoiceSession(transaction: Row, method: HelcimMethod) {
  const id = transactionId(transaction);
  const invoiceNumber = text(transaction.invoiceNumber);
  const amountCents = cents(transaction.amount);
  const currency = transactionCurrency(transaction);
  if (!invoiceNumber || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !currency) return null;
  const source = await first<{ paymentLinkId: string; customerInvoiceId: string }>(`SELECT l.id AS paymentLinkId,m.customer_invoice_id AS customerInvoiceId
    FROM helcim_invoice_mirrors m JOIN invoice_payment_links l ON l.customer_invoice_id=m.customer_invoice_id
    WHERE m.helcim_invoice_number=? ORDER BY l.created_at DESC LIMIT 1`, invoiceNumber);
  if (!source) return null;
  const sessionId = newId("helcim-hosted");
  const checkoutToken = `hosted-${method}-${id}`;
  const encryptedSecret = await encryptHelcimSecret("hosted-invoice-view", requiredConfiguration().encryptionKey, sessionId);
  const createdAt = new Date();
  await getD1().prepare(`INSERT OR IGNORE INTO helcim_checkout_sessions
    (id,payment_link_id,customer_invoice_id,checkout_token,encrypted_secret_token,amount_cents,currency,status,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,'initialized',?,?)`)
    .bind(sessionId, source.paymentLinkId, source.customerInvoiceId, checkoutToken, encryptedSecret, amountCents, currency, createdAt.toISOString(), new Date(createdAt.getTime() + 365 * 86_400_000).toISOString()).run();
  return checkoutSession(checkoutToken);
}

export async function recordHelcimWebhook(request: Request) {
  await ensureDatabase();
  const config = requiredConfiguration();
  if (!config.verifierToken) throw new HelcimPaymentError("HELCIM_WEBHOOK_NOT_CONFIGURED", "Helcim webhook verification is not configured for this deployment.", 503);
  const webhookId = text(request.headers.get("webhook-id"));
  const timestamp = text(request.headers.get("webhook-timestamp"));
  const signatureHeader = text(request.headers.get("webhook-signature"));
  const rawBody = await request.text();
  const timestampNumber = Number(timestamp);
  if (!webhookId || !signatureHeader || !Number.isFinite(timestampNumber) || Math.abs(Date.now() / 1_000 - timestampNumber) > webhookClockToleranceSeconds) {
    throw new HelcimPaymentError("INVALID_WEBHOOK", "The Helcim webhook headers are missing or stale.", 403);
  }
  if (!await verifyHelcimWebhookSignature({ verifierToken: config.verifierToken, webhookId, timestamp, rawBody, signatureHeader })) {
    throw new HelcimPaymentError("INVALID_WEBHOOK_SIGNATURE", "The Helcim webhook signature is invalid.", 403);
  }
  let body: Row;
  try { body = JSON.parse(rawBody) as Row; }
  catch { throw new HelcimPaymentError("INVALID_WEBHOOK", "The Helcim webhook body is not valid JSON."); }
  const webhookType = text(body.type) || "unknown";
  const data = body.data && typeof body.data === "object" ? body.data as Row : body;
  const objectId = text(body.id || data.id || data.transactionId) || null;
  const result = await getD1().prepare(`INSERT OR IGNORE INTO helcim_webhook_events
    (webhook_id,webhook_type,object_id,body_json,status,attempts,received_at) VALUES (?,?,?,?, 'pending',0,?)`)
    .bind(webhookId, webhookType, objectId, rawBody, new Date().toISOString()).run();
  return { accepted: true, duplicate: !Number(result.meta?.changes ?? 0) };
}

async function processWebhookEvent(event: { webhookId: string; webhookType: string; objectId: string | null; bodyJson: string; attempts: number }) {
  if (!event.objectId) {
    await getD1().prepare("UPDATE helcim_webhook_events SET status='ignored',processed_at=?,last_error='No transaction id in event.' WHERE webhook_id=?")
      .bind(new Date().toISOString(), event.webhookId).run();
    return;
  }
  const lowerType = event.webhookType.toLowerCase();
  if (!lowerType.includes("transaction")) {
    await getD1().prepare("UPDATE helcim_webhook_events SET status='ignored',processed_at=?,last_error=NULL WHERE webhook_id=?")
      .bind(new Date().toISOString(), event.webhookId).run();
    return;
  }
  const method: HelcimMethod = /ach|bank/iu.test(lowerType) ? "eft" : "card";
  const transaction = await fetchProviderTransaction(event.objectId, method);
  const session = await matchSessionForTransaction(transaction, method);
  if (!session) {
    await getD1().prepare("UPDATE helcim_webhook_events SET status='ignored',processed_at=?,last_error='No unambiguous PaneFlow checkout matched this transaction.' WHERE webhook_id=?")
      .bind(new Date().toISOString(), event.webhookId).run();
    return;
  }
  await recordTransaction(session, transaction);
  await getD1().prepare("UPDATE helcim_webhook_events SET status='processed',processed_at=?,last_error=NULL WHERE webhook_id=?")
    .bind(new Date().toISOString(), event.webhookId).run();
}

async function reconcilePendingSession(session: CheckoutSession) {
  if (!session.providerTransactionId || (session.providerMethod !== "eft" && session.providerMethod !== "card")) return;
  const transaction = await fetchProviderTransaction(session.providerTransactionId, session.providerMethod);
  await recordTransaction(session, transaction);
}

type HostedInvoiceMirror = {
  customerInvoiceId: string;
  helcimInvoiceId: string;
  helcimInvoiceNumber: string;
};

async function pollHostedInvoiceMirror(mirror: HostedInvoiceMirror) {
  const configuration = requiredConfiguration();
  const transactions: Array<{ transaction: Row; method: HelcimMethod }> = [];
  if (configuration.paymentMethod.includes("cc")) {
    const payload = await helcimRequest(`/card-transactions?invoiceNumber=${encodeURIComponent(mirror.helcimInvoiceNumber)}&limit=100&page=1`);
    for (const transaction of providerTransactions(payload)) {
      const type = text(transaction.type).toLowerCase();
      if (text(transaction.invoiceNumber) !== mirror.helcimInvoiceNumber || (type && !/purchase|capture/iu.test(type))) continue;
      transactions.push({ transaction, method: "card" });
    }
  }
  if (configuration.paymentMethod.includes("ach")) {
    const payload = await helcimRequest(`/ach/transactions?search=${encodeURIComponent(mirror.helcimInvoiceId)}&limit=125&page=1`);
    for (const transaction of providerTransactions(payload)) {
      if (text(transaction.orderId) !== mirror.helcimInvoiceId || Number(transaction.originalTransactionId ?? 0) !== 0) continue;
      transactions.push({ transaction, method: "eft" });
    }
  }
  transactions.sort((left, right) => text(left.transaction.dateCreated).localeCompare(text(right.transaction.dateCreated)));
  for (const candidate of transactions) {
    const session = await matchSessionForTransaction(candidate.transaction, candidate.method);
    if (session) await recordTransaction(session, candidate.transaction);
  }
}

export async function processHelcimIntegrationBatch(limit = 50) {
  const configuration = getHelcimConfigurationStatus();
  if (!configuration.configured) return { configured: false, webhooks: 0, mirrors: 0, sessions: 0 };
  await ensureDatabase();
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const events = await getD1().prepare(`SELECT webhook_id AS webhookId,webhook_type AS webhookType,object_id AS objectId,body_json AS bodyJson,attempts
    FROM helcim_webhook_events WHERE status='pending' AND attempts<20 ORDER BY received_at LIMIT ?`).bind(bounded).all<{
      webhookId: string; webhookType: string; objectId: string | null; bodyJson: string; attempts: number;
    }>();
  let processedEvents = 0;
  for (const event of events.results) {
    try {
      await getD1().prepare("UPDATE helcim_webhook_events SET attempts=attempts+1 WHERE webhook_id=?").bind(event.webhookId).run();
      await processWebhookEvent(event);
      processedEvents += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : "Webhook processing failed.";
      await getD1().prepare(`UPDATE helcim_webhook_events SET status=CASE WHEN attempts>=20 THEN 'failed' ELSE 'pending' END,last_error=? WHERE webhook_id=?`)
        .bind(message, event.webhookId).run();
    }
  }
  const mirrors = configuration.checkoutMode === "hosted"
    ? await getD1().prepare(`SELECT m.customer_invoice_id AS customerInvoiceId,m.helcim_invoice_id AS helcimInvoiceId,
        m.helcim_invoice_number AS helcimInvoiceNumber FROM helcim_invoice_mirrors m
        JOIN customer_invoices ci ON ci.id=m.customer_invoice_id
        WHERE ci.status NOT IN ('paid','credited','void') AND ci.total_cents-ci.paid_cents-
          COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id=ci.id AND cc.status='posted'),0)>0
        ORDER BY m.synced_at,m.customer_invoice_id LIMIT ?`).bind(bounded).all<HostedInvoiceMirror>()
    : { results: [] as HostedInvoiceMirror[] };
  let processedMirrors = 0;
  for (const mirror of mirrors.results) {
    const reconciledAt = new Date().toISOString();
    try {
      await pollHostedInvoiceMirror(mirror);
      await getD1().prepare("UPDATE helcim_invoice_mirrors SET synced_at=?,last_error=NULL WHERE customer_invoice_id=?")
        .bind(reconciledAt, mirror.customerInvoiceId).run();
      processedMirrors += 1;
    } catch (error) {
      await getD1().prepare("UPDATE helcim_invoice_mirrors SET synced_at=?,last_error=? WHERE customer_invoice_id=?")
        .bind(reconciledAt, error instanceof Error ? error.message.slice(0, 1_000) : "Hosted invoice reconciliation failed.", mirror.customerInvoiceId).run();
    }
  }
  const pending = await getD1().prepare(`SELECT id,payment_link_id AS paymentLinkId,customer_invoice_id AS customerInvoiceId,
    checkout_token AS checkoutToken,encrypted_secret_token AS encryptedSecretToken,amount_cents AS amountCents,currency,status,
    provider_transaction_id AS providerTransactionId,provider_method AS providerMethod,payment_id AS paymentId,expires_at AS expiresAt
    FROM helcim_checkout_sessions WHERE status='pending' AND provider_transaction_id IS NOT NULL ORDER BY reconciled_at,created_at LIMIT ?`)
    .bind(bounded).all<CheckoutSession>();
  let processedSessions = 0;
  for (const session of pending.results) {
    try { await reconcilePendingSession(session); processedSessions += 1; }
    catch (error) {
      await getD1().prepare("UPDATE helcim_checkout_sessions SET last_error=?,reconciled_at=? WHERE id=?")
        .bind(error instanceof Error ? error.message.slice(0, 1_000) : "Reconciliation failed.", new Date().toISOString(), session.id).run();
    }
  }
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare("UPDATE helcim_checkout_sessions SET status='expired' WHERE status='initialized' AND expires_at<=?").bind(now),
    getD1().prepare("UPDATE invoice_payment_links SET status='expired' WHERE status='active' AND expires_at<=?").bind(now),
  ]);
  return { configured: true, webhooks: processedEvents, mirrors: processedMirrors, sessions: processedSessions };
}

export async function getHelcimAdminState() {
  await ensureDatabase();
  const [sessionCounts, activeLinks, recent] = await Promise.all([
    getD1().prepare("SELECT status,COUNT(*) AS count FROM helcim_checkout_sessions GROUP BY status").all<{ status: string; count: number }>(),
    first<{ count: number }>("SELECT COUNT(*) AS count FROM invoice_payment_links WHERE status='active' AND expires_at>?", new Date().toISOString()),
    getD1().prepare(`SELECT s.id,ci.number AS invoiceNumber,s.amount_cents AS amountCents,s.currency,s.status,
      s.provider_transaction_id AS transactionId,s.provider_method AS method,s.provider_status AS providerStatus,
      s.last_error AS lastError,s.created_at AS createdAt,s.reconciled_at AS reconciledAt
      FROM helcim_checkout_sessions s JOIN customer_invoices ci ON ci.id=s.customer_invoice_id
      WHERE s.status IN ('pending','review','failed') ORDER BY COALESCE(s.reconciled_at,s.created_at) DESC LIMIT 25`).all<Row>(),
  ]);
  return {
    configuration: getHelcimConfigurationStatus(),
    activeLinks: Number(activeLinks?.count ?? 0),
    counts: Object.fromEntries(sessionCounts.results.map((item) => [item.status, Number(item.count)])),
    recent: recent.results,
  };
}
