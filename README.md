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

### Per-user document email

Each authenticated user can connect a Google Workspace/Gmail or Microsoft 365/Outlook mailbox from the account menu. Approved purchase orders, confirmed sales orders, and posted customer invoices can then be sent as PDF attachments from that user's own mailbox. PaneFlow reads the document from D1 at send time, enforces the same operational or financial role as the underlying document, and records the sender, recipients, document, provider result, and audit event without retaining the message body or attachment.

Configure one or both OAuth providers and a dedicated encryption secret of at least 32 characters:

- Google: `EMAIL_GOOGLE_CLIENT_ID`, `EMAIL_GOOGLE_CLIENT_SECRET`, and `EMAIL_GOOGLE_REDIRECT_URI`. Enable the Gmail API and register the callback URI; the app requests `gmail.send`, OpenID, and email identity scopes.
- Microsoft: `EMAIL_MICROSOFT_CLIENT_ID`, `EMAIL_MICROSOFT_CLIENT_SECRET`, `EMAIL_MICROSOFT_REDIRECT_URI`, and optionally `EMAIL_MICROSOFT_TENANT_ID` (defaults to `common`). Register the callback URI and allow delegated `User.Read` and `Mail.Send` permissions.
- Both providers use `EMAIL_TOKEN_ENCRYPTION_KEY`; keep it as a Worker secret and stable across deploys. OAuth access and refresh tokens are AES-GCM encrypted before being stored in D1.

For production, each redirect URI must be the exact public URL ending in `/api/integrations/email/callback/google` or `/api/integrations/email/callback/microsoft`.

## QuickBooks Online integration

PaneFlow is the operational and inventory source of truth; QuickBooks Online remains the general ledger and banking system. The native integration sends customers, vendors, non-inventory products, approved purchase orders, customer invoices, approved vendor bills, credits, and payments. Draft or pending purchase orders and match-held bills remain in PaneFlow until approval. Inventory receipts, COGS, returns, scrap, counts, landed cost, and returnable-deposit forfeitures are sent as balanced journal entries so QBO does not maintain a second, competing stock valuation. Lots, serials, bins, reservations, physical movements, and R2 attachments stay in PaneFlow.

The connection uses Intuit OAuth 2.0. Access and refresh tokens are AES-GCM encrypted before they are stored in D1; the encryption key remains a Worker secret. Delivery is durable and at least once, with local idempotency, stable QBO-ID links, `SyncToken` conflict detection, exponential retry, signed webhook ingestion, and reconciliation. PaneFlow never guesses a chart-of-accounts or Canadian tax mapping: missing mappings appear as administrator-visible conflicts.

To configure an Intuit app:

1. Create an app in the Intuit Developer dashboard and enable the `com.intuit.quickbooks.accounting` scope. A QBO Plus or Advanced company is required when purchase orders are part of the workflow.
2. Register `https://YOUR_HOST/api/integrations/qbo/callback` as an OAuth redirect URI and `https://YOUR_HOST/api/integrations/qbo/webhook` as the webhook endpoint. Enable the current CloudEvents v1.0 webhook payload; the endpoint also accepts Intuit's legacy payload during migration. Use the equivalent localhost callback for sandbox development.
3. Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, and `QBO_WEBHOOK_VERIFIER_TOKEN` as Worker secrets. Set `QBO_TOKEN_ENCRYPTION_KEY` to an independent, randomly generated value of at least 32 characters. `QBO_MINOR_VERSION` defaults to `75`.
4. Open **Reports & admin → Integrations**, connect a sandbox company, load its reference lists, and map every applicable PaneFlow accounting role plus all local tax codes, payment terms, and payment methods. Map **Vendor payment credit card** if bills can be paid from a credit-card account.
5. Run the initial sync from the chosen cutover date, resolve any worklist conflicts, reconcile, and only then repeat the connection process for production.

The same screen supports manual sync, retry, disconnect/revocation, delivery inspection, and round-robin reconciliation. The Worker also projects and delivers QBO work every five minutes. QBO webhook edits are treated as conflicts because the integration is intentionally one-way for PaneFlow-owned records; an administrator can retry the conflict to refresh its current `SyncToken` and overwrite it from PaneFlow.

The Reports workspace still provides an accounting control export and balanced QuickBooks journal CSV as an audited fallback and reconciliation artifact.

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
