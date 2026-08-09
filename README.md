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
- Empty-database onboarding for products, vendors/customers, warehouses, locations, returnable types, and user roles.

## Roles

The first authenticated user on an empty private deployment is recorded as the administrator. Later unknown users are read-only viewers until an administrator assigns a role.

- Viewer: read-only operations and permitted exports.
- Operator: operational documents and stock movement.
- Accounting: bills, invoices, credits, payments, and approved financial actions.
- Manager: operational approvals and exception decisions.
- Administrator: policy, period, user-access, and master-data administration.

Every write derives its actor from Sites authentication headers; client-supplied actor fields are ignored.

## QuickBooks handoff

PaneFlow is the operational source of truth; QuickBooks remains the accounting ledger. The Reports workspace provides an accounting control export and a balanced QuickBooks journal CSV with journal number/date, account, description, debit, credit, partner name, and immutable PaneFlow source references. The export is itself written to the audit log and outbox. Before the first import, create or map the named accounts in QuickBooks; any account-name customization should be handled as deployment configuration rather than by rewriting historical operations.

## Local development

Requirements: Node.js 22.13 or later.

```bash
npm install
npm run dev
```

The local Sites configuration provides D1 and R2 bindings. Development-only sample records are gated from production; a hosted empty database starts with the authenticated administrator bootstrap and master-data setup flow.

Set `BOOTSTRAP_DEMO_DATA=true` only for an isolated development database. Production deployments should omit it or set it to `false`; `ENVIRONMENT=development` also enables the local bootstrap and must not be used in production.

## Verification

```bash
npm run test:domain
npm test
npm run lint
```

`npm test` performs a production build and runs the full contract/domain suite.

## Deliberate boundaries

PaneFlow contains operational AP/AR and inventory-valuation subledgers plus balanced accounting exports. It is not a replacement for a full general ledger, bank reconciliation, payroll, tax filing, or statutory consolidation system. EDI, carrier/customer/vendor portals, demand forecasting, route optimization, manufacturing/MRP, and automated bank feeds are also outside this release. Those integrations can consume the transactional outbox and exports without weakening the operational audit trail.
