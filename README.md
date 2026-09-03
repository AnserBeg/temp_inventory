# PaneFlow Operations

PaneFlow is a distributor operations system for purchasing, inventory, sales fulfillment, vendor billing, customer billing, traceability, returnable cores/empties, and audit-ready exports. It is designed for window and building-material distributors, but its document model works for other stocked, special-order, serialized, and lot-controlled products.

## Operational model

PaneFlow deliberately separates three kinds of state:

- Commercial commitments: approved purchase orders, confirmed sales orders, reservations, and open quantities.
- Physical custody: receipts, shipments, transfers, returns, counts, status changes, scrap, lots, serials, and location balances.
- Financial subledgers: vendor bills/credits/payments, customer invoices/credits/payments, taxes, charges, refundable deposits, inventory value, COGS, and landed cost.

Changing one document never silently fabricates another. Reopening a PO restores incoming supply but does not add on-hand stock. A customer return can restore stock without issuing credit. Returning a core or empty restores custody, while its deposit remains refundable until an explicit refund is posted.

## Included workflows

- Multi-line purchase and sales drafts with frozen configurations, fulfillment route, currency/FX, terms, tax, discounts, freight, fees, and refundable deposits.
- PO revision, approval, rejection, close-short, reopen, partial receipt, approved over-receipt, receipt reversal, vendor return, and price-only credit.
- SO confirmation/cancellation, reservation/reallocation/release, shipment, shipment reversal, customer return, invoice, credit, and payment.
- Stock, special-order, and drop-ship routes; multi-warehouse locations; usable, quarantine, damaged, return-pending, and in-transit status.
- One-step internal transfers and dispatch/receipt of inter-warehouse transfers.
- Quantity, lot, and serial tracking with immutable movement lineage.
- FIFO, moving-average, and standard valuation policies; receipt layers, COGS, reversal restoration, scrap, count variance, and landed-cost allocation.
- Vendor bill duplicate protection and PO/receipt/bill matching with tolerances, holds, approvals, and cumulative billed-quantity controls.
- Returnable rack, core, stillage, crate, and empty custody with issued, returned, forfeited, deposit-charged, and deposit-refunded events.
- Approval thresholds, period locks, negative-stock blocking, optimistic version checks, idempotency, actor identity, audit events, and transactional outbox records.
- R2-backed PDF/image attachments, a full accounting control export, and an audited QuickBooks Online journal CSV.
- Server-backed worklist search, status filtering, sorting, and pagination across the full product, partner, order, movement, and billing data set.
- Operational base/purchase/sales units of measure with precision enforcement and global or product-specific conversions applied to orders, receipts, reservations, shipments, and returns.
- Customer-assigned contract price lists with priorities, validity dates, UOMs, and quantity breaks; catalog cost/price remains the explicit fallback.
- Secure customer invoice links backed by HelcimPay.js, with partial amounts, card collection, pending Canadian bank-payment clearing, signed webhooks, and automatic receivable posting.
- Empty-database onboarding for products, units, conversions, vendors/customers, warehouses, locations, returnable types, customer pricing, and user roles.
- Missing-location reconciliation that restores the original historical ID; inventory and accounting exports remain blocked until every location reference resolves.

## Roles

The first authenticated user on an empty private deployment is recorded as the administrator. Later unknown users are read-only viewers until an administrator assigns a role.

- Viewer: read-only operations and permitted exports.
- Operator: operational documents and stock movement.
- Accounting: bills, invoices, credits, payments, and approved financial actions.
- Manager: operational approvals and exception decisions.
- Administrator: policy, period, user-access, and master-data administration.

Every write derives its actor from Sites authentication headers; client-supplied actor fields are ignored.

## Organization isolation

PaneFlow is multi-tenant at the database, request, integration, and object-storage boundaries. A global authenticated identity can hold a separate role in each organization. The organization selector only lists active memberships, and switching validates the membership on the server before setting an HTTP-only, same-site cookie. Administrators can create organizations, rename their current organization, and add or change registered members without granting access elsewhere.

Every company-owned D1 row carries `tenant_id`. The server's D1 facade injects the current tenant into inserts and scopes reads, updates, and deletes; tenant-aware unique indexes allow organizations to reuse business codes independently. Database triggers reject relationships whose parent belongs to another tenant. R2 attachment keys begin with `tenants/<tenant-id>/`, document sequences and idempotency keys are tenant-local, and generated provider invoice identifiers include a tenant namespace.

The Worker establishes the tenant context for the whole request using `AsyncLocalStorage.run()`. It accepts a requested tenant only when the authenticated user has an active membership; route authorization independently repeats that check. OAuth callbacks, payment links, and signed webhooks resolve their tenant from their one-time state or durable provider record rather than from a browser cookie. Scheduled outbox, QBO, and Helcim processing runs once per active organization in isolated contexts.

Migration `0030` creates the organization registry, assigns existing users and rows to the default organization, and replaces global business-key constraints with tenant-aware ones. Migration `0031` installs cross-tenant relationship guards. Apply the complete migration chain before deploying the matching Worker; do not run new application code against a database that has not reached both migrations.

### Document email

Each authenticated user can connect a Google Workspace/Gmail or Microsoft 365/Outlook mailbox from the account menu. Approved purchase orders, confirmed sales orders, and posted customer invoices can then be sent as PDF attachments from that user's own mailbox. PaneFlow reads the document from D1 at send time, enforces the same operational or financial role as the underlying document, and records the sender, recipients, document, provider result, and audit event without retaining the message body or attachment.

Configure one or both OAuth providers and a dedicated encryption secret of at least 32 characters:

- Google: `EMAIL_GOOGLE_CLIENT_ID`, `EMAIL_GOOGLE_CLIENT_SECRET`, and `EMAIL_GOOGLE_REDIRECT_URI`. Enable the Gmail API and register the callback URI; the app requests `gmail.send`, OpenID, and email identity scopes.
- Microsoft: `EMAIL_MICROSOFT_CLIENT_ID`, `EMAIL_MICROSOFT_CLIENT_SECRET`, `EMAIL_MICROSOFT_REDIRECT_URI`, and optionally `EMAIL_MICROSOFT_TENANT_ID` (defaults to `common`). Register the callback URI and allow delegated `User.Read` and `Mail.Send` permissions.
- Both providers use `EMAIL_TOKEN_ENCRYPTION_KEY`; keep it as a Worker secret and stable across deploys. OAuth access and refresh tokens are AES-GCM encrypted before being stored in D1.

For production, each redirect URI must be the exact public URL ending in `/api/integrations/email/callback/google` or `/api/integrations/email/callback/microsoft`.

In the app, open the account menu and choose **Email sending**:

- A company administrator can connect one **Company email**. It becomes the default sender for everyone in that company.
- The same administrator can set one **Draft PO approvals** address. Every new draft PO sends a brief approval-required alert from the company email with a direct link to the draft.
- An adjacent **Approved PO notifications** field accepts comma-separated addresses. When the draft is approved, PaneFlow emails its creator at their current account address plus those extra recipients, with duplicates removed.
- Any user can optionally connect **My email**. When both are available, the send dialog offers a small **From** choice; otherwise it uses the only available sender automatically.
- Connections use the provider's sign-in page. PaneFlow never asks users to enter or store an email password.

## Helcim customer payments

PaneFlow owns the customer invoice and payment ledger. Helcim provides the PCI-scoped checkout, processor transaction, and settlement state; it does not replace the PaneFlow invoice or write accounting entries directly to QBO. Accounting users can create a payment link from an open customer invoice, and invoice emails automatically include one while Helcim is configured. By default, that button opens Helcim's public Online Invoice View, which keeps a private PaneFlow deployment private. PaneFlow polls invoice-linked card and ACH transactions every five minutes so a private deployment does not depend on externally delivered webhooks. An optional embedded mode renders HelcimPay.js on a separately public HTTPS PaneFlow checkout origin. In both modes, card numbers and bank credentials never pass through PaneFlow.

PaneFlow mirrors each payable invoice into Helcim under a `PF-` invoice number. A signed Pay.js success response posts an approved card purchase immediately through the same idempotent payment workflow used by accounting staff. Canadian bank payments remain pending until the five-minute reconciliation job observes approved clearing. Every processor transaction ID is unique in D1; duplicate browser callbacks and webhook deliveries cannot post a second payment. Webhook response data persisted for audit is stripped of cardholder, card-token, and bank-account fields.

To configure Helcim:

Open **Reports & admin → Company connections** in PaneFlow. The Helcim card shows every missing deployment setting and provides a copyable setup request.

1. Start with a Helcim Developer Test account, then use an approved merchant account for production. In the API Access Configuration, enable invoice create/update/read and card/ACH transaction reads. Also enable HelcimPay.js checkout initialization if embedded mode will be used.
2. Set `HELCIM_API_TOKEN` and an independent random `HELCIM_TOKEN_ENCRYPTION_KEY` of at least 32 characters as Worker secrets. The last key encrypts each short-lived Pay.js validation secret before D1 storage and must remain stable across deploys.
3. The private Site uses scheduled API polling and does not require a webhook. If a separately public signed-ingress host is added later, it may forward Helcim card and ACH transaction events to `/api/integrations/helcim/webhook`; set its base64 verifier as `HELCIM_WEBHOOK_VERIFIER_TOKEN`. Do not point Helcim at an owner-only Site URL because private Sites require interactive sign-in.
4. Leave `HELCIM_CHECKOUT_MODE=hosted` for a private PaneFlow site and set `HELCIM_INVOICE_HOST` to the hostname shown by **Actions → View Online** on any Helcim invoice, for example `your-business.myhelcim.com`. To use PaneFlow's `/pay/...` page instead, set the mode to `embedded`, host that route on a public HTTPS origin, and whitelist the origin in Helcim; Pay.js does not render directly on localhost. `HELCIM_CHECKOUT_PAYMENT_METHODS` accepts `cc`, `ach`, or `cc-ach` and defaults to `cc-ach`; USD embedded checkouts are always limited to cards. `HELCIM_PAYMENT_LINK_TTL_DAYS` defaults to 90 and accepts 1–365 for embedded links.
5. In **Reports & admin → Integrations**, map **Helcim clearing** to a QBO Other Current Asset (or dedicated Bank-type clearing) account, and map local payment methods `helcim_card` and `helcim_eft` to the corresponding QBO methods. Do not map processor receipts directly to the operating bank account: Helcim payouts and fees should reconcile from the clearing account to the bank feed.
6. Send a low-value test invoice link, complete a card test and a bank-payment test, wait for the latter to clear, then verify the PaneFlow payment, QBO Payment, clearing-account deposit, and fee reconciliation before switching to production credentials.

The initial connection accepts purchase payments. Refunds, chargebacks, and ACH returns must be initiated in Helcim and handled as explicit accounting corrections in PaneFlow/QBO; they are never silently netted against an invoice by the collection callback.

## QuickBooks Online integration

PaneFlow is the operational and inventory source of truth; QuickBooks Online remains the general ledger and banking system. The native integration sends customers, vendors, non-inventory products, approved purchase orders, customer invoices, approved vendor bills, credits, and payments. Draft or pending purchase orders and match-held bills remain in PaneFlow until approval. Inventory receipts, COGS, returns, scrap, counts, landed cost, and returnable-deposit forfeitures are sent as balanced journal entries so QBO does not maintain a second, competing stock valuation. Lots, serials, bins, reservations, physical movements, and R2 attachments stay in PaneFlow.

The connection uses Intuit OAuth 2.0. Access and refresh tokens are AES-GCM encrypted before they are stored in D1; the encryption key remains a Worker secret. Delivery is durable and at least once, with local idempotency, stable QBO-ID links, `SyncToken` conflict detection, exponential retry, signed webhook ingestion, and reconciliation. PaneFlow never guesses a chart-of-accounts or Canadian tax mapping: missing mappings appear as administrator-visible conflicts.

To configure an Intuit app:

Open **Reports & admin → Company connections** in PaneFlow. The QuickBooks card shows the exact OAuth callback to register, identifies missing platform settings, and enables **Sign in & choose company** only when the Intuit app is ready.

1. Create an app in the Intuit Developer dashboard and enable the `com.intuit.quickbooks.accounting` scope. A QBO Plus or Advanced company is required when purchase orders are part of the workflow.
2. Register `https://YOUR_HOST/api/integrations/qbo/callback` as an OAuth redirect URI and `https://YOUR_HOST/api/integrations/qbo/webhook` as the webhook endpoint. Enable the current CloudEvents v1.0 webhook payload; the endpoint also accepts Intuit's legacy payload during migration. Use the equivalent localhost callback for sandbox development.
3. Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, and `QBO_WEBHOOK_VERIFIER_TOKEN` as Worker secrets. Set `QBO_TOKEN_ENCRYPTION_KEY` to an independent, randomly generated value of at least 32 characters. `QBO_MINOR_VERSION` defaults to `75`.
4. Open **Reports & admin → Integrations**, connect a sandbox company, load its reference lists, and map every applicable PaneFlow accounting role plus all local tax codes, payment terms, and payment methods. Map **Vendor payment credit card** if bills can be paid from a credit-card account, and **Helcim clearing** if online customer payments are enabled.
5. Run the initial sync from the chosen cutover date, resolve any worklist conflicts, reconcile, and only then repeat the connection process for production.

The same screen supports manual sync, retry, disconnect/revocation, delivery inspection, and round-robin reconciliation. The Worker also projects and delivers QBO work every five minutes. QBO webhook edits are treated as conflicts because the integration is intentionally one-way for PaneFlow-owned records; an administrator can retry the conflict to refresh its current `SyncToken` and overwrite it from PaneFlow.

The Reports workspace still provides an accounting control export and balanced QuickBooks journal CSV as an audited fallback and reconciliation artifact.

## Google address autocomplete

Customer, vendor, saved ship-to, and sales-order street-address fields use the current Google Places Autocomplete widget. Choosing a suggestion fills street line 1, address line 2 when Google returns a unit or floor, city, province/state, postal code, and the two-letter country code. Manual entry remains available if Google is not configured or cannot be reached.

Set `GOOGLE_MAPS_API_KEY` in `.dev.vars` for local development and as a hosted Worker secret for production. In the associated Google Cloud project, enable **Maps JavaScript API** and **Places API (New)**, enable billing, and restrict the browser key to the exact localhost and hosted HTTPS referrers that run PaneFlow. The key is delivered only to authenticated PaneFlow sessions, but it is a browser credential and must still use HTTP-referrer and API restrictions.

## Local development

Requirements: Node.js 22.13 or later.

```bash
npm install
npm run dev
```

The `predev` hook applies every pending migration to the project-local D1 database before the server starts. The local Sites configuration then provides the matching D1 and R2 bindings. Development-only sample records are gated from production; a hosted empty database starts with the authenticated administrator bootstrap and master-data setup flow.

Copy `.dev.vars.example` to `.dev.vars` for explicit local Cloudflare runtime flags. Set `ALLOW_LOCAL_DEV_AUTH=true` only for a private local process; host names and `Host` headers never enable authentication bypass. Set `BOOTSTRAP_DEMO_DATA=true` only for an isolated development database. Production deployments must keep both values `false`. No environment name implicitly seeds operational records.

`npm start` applies pending local migrations, creates a fresh production build, and serves that build through a project-local Wrangler process so Cloudflare bindings such as D1, R2, and scheduled outbox delivery behave like the deployed application. Wrangler state and diagnostics stay under `.wrangler/`, including in restricted development environments. `vinext start` alone is intentionally not used because Node cannot load the Cloudflare runtime modules directly.

## Transactional outbox delivery

Every externally useful business event is committed to `outbox_events` in the same durable database operation as the workflow change. To deliver those events, configure both `OUTBOX_WEBHOOK_URL` and `OUTBOX_WEBHOOK_SECRET`; leaving both blank keeps ordinary integration events queued and still allows local R2 attachment cleanup events to run. Configure neither or both—setting only one is treated as an error.

The Worker attempts queued delivery every five minutes and administrators can also retry it from **Reports & admin → Integrations**. Delivery is at least once. Failed calls use exponential backoff from 15 seconds up to one hour and retain their last error in the integration worklist. Consumers must deduplicate on the `id` field or `x-paneflow-event-id` header.

Webhook requests are JSON `POST`s with these headers:

- `x-paneflow-event-id`: immutable event identifier.
- `x-paneflow-event-type`: business event type.
- `x-paneflow-timestamp`: Unix time in seconds.
- `x-paneflow-signature`: `sha256=<hex HMAC-SHA256>` over `<timestamp>.<raw request body>` using `OUTBOX_WEBHOOK_SECRET`.

Consumers should verify the signature against the raw body with a constant-time comparison and reject stale timestamps before acknowledging with any 2xx response. Hosted deployments should use an HTTPS webhook URL.

## Database migrations

`db/schema.ts` and the ordered SQL files in `drizzle/` are the canonical schema. Runtime startup only verifies the migrated contract and never creates or alters tables. Generate a new migration with `npm run db:generate` whenever the Drizzle schema changes, review the SQL, and commit both the SQL and `drizzle/meta` updates. Sites applies the committed migration chain before starting the deployed application.

## Verification

```bash
npm run test:domain
npm test
npm run lint
npm run typecheck
```

`npm test` performs a production build and runs the full contract suite, including a clean migration bootstrap and production-module integration tests against a D1-compatible SQLite adapter.

## Deliberate boundaries

PaneFlow contains operational AP/AR and inventory-valuation subledgers plus balanced accounting exports. It is not a replacement for a full general ledger, bank reconciliation, payroll, tax filing, or statutory consolidation system. EDI, carrier/customer/vendor portals, demand forecasting, route optimization, manufacturing/MRP, and automated bank feeds are also outside this release. Those integrations can consume the transactional outbox and exports without weakening the operational audit trail.

The product master is an operational catalog rather than a full merchandising/PIM module. Vendor-product cross references and lead times, per-warehouse replenishment policy, barcode/UPC, and dimensional weight remain explicit follow-up work. Customer contract prices and volume tiers are supported; the product selling price and global reorder/min-max levels remain catalog fallbacks and must not be represented as warehouse-specific planning data.
