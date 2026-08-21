import { all, ensureDatabase } from "./inventory-db";

/**
 * Management reports a distributor runs daily. Each one is a single aggregate query against
 * the durable tables — no snapshot paging — so the numbers cover the whole company rather
 * than the first page of records.
 */
export const REPORT_TYPES = ["ar-aging", "customer-statement", "open-orders", "replenishment"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as readonly string[]).includes(value);
}

/**
 * Historical receivables must be reconstructed from dated postings. `paid_cents` is the
 * invoice's current roll-up, so using it for an earlier as-of date makes old statements change
 * whenever a later payment is posted. The base expressions also keep company totals from adding
 * CAD, USD, and EUR document cents together.
 */
const postedPayments = `COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.document_type = 'customer_invoice' AND p.document_id = ci.id AND p.direction = 'inbound' AND substr(p.payment_date, 1, 10) <= (SELECT as_of FROM report_params)), 0)`;
const postedBasePayments = `COALESCE((SELECT SUM(p.base_amount_cents) FROM payments p WHERE p.document_type = 'customer_invoice' AND p.document_id = ci.id AND p.direction = 'inbound' AND substr(p.payment_date, 1, 10) <= (SELECT as_of FROM report_params)), 0)`;
const postedCredits = `COALESCE((SELECT SUM(cc.amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id = ci.id AND cc.status = 'posted' AND substr(cc.posted_at, 1, 10) <= (SELECT as_of FROM report_params)), 0)`;
const postedBaseCredits = `COALESCE((SELECT SUM(cc.base_amount_cents) FROM customer_credits cc WHERE cc.customer_invoice_id = ci.id AND cc.status = 'posted' AND substr(cc.posted_at, 1, 10) <= (SELECT as_of FROM report_params)), 0)`;
const outstandingDocumentCents = `MAX(ci.total_cents - ${postedPayments} - ${postedCredits}, 0)`;
const outstandingBaseCents = `MAX(ci.base_total_cents - ${postedBasePayments} - ${postedBaseCredits}, 0)`;

/**
 * Whole days past the due date, negative while the invoice is still current. The as-of date
 * comes from a single-row CTE so repeating this expression never changes the binding count.
 */
const daysPastDue = `CAST(julianday((SELECT as_of FROM report_params)) - julianday(COALESCE(ci.due_date, ci.invoice_date)) AS INTEGER)`;

export async function arAging(asOf = new Date().toISOString().slice(0, 10)) {
  await ensureDatabase();
  const rows = await all<Record<string, unknown>>(
    `WITH report_params AS (SELECT ? AS as_of)
     SELECT bp.id AS customerId, bp.code AS customerCode, bp.name AS customerName, bp.credit_limit_cents AS creditLimitCents, bp.credit_hold AS creditHold,
       bp.currency AS partnerCurrency,
       CASE WHEN COUNT(DISTINCT ci.currency) = 1 THEN MIN(ci.currency) ELSE 'MIXED' END AS documentCurrency,
       SUM(${outstandingDocumentCents}) AS documentOutstandingCents,
       SUM(${outstandingBaseCents}) AS totalBaseCents,
       SUM(CASE WHEN ${daysPastDue} <= 0  THEN ${outstandingBaseCents} ELSE 0 END) AS currentBaseCents,
       SUM(CASE WHEN ${daysPastDue} BETWEEN 1 AND 30  THEN ${outstandingBaseCents} ELSE 0 END) AS days1To30BaseCents,
       SUM(CASE WHEN ${daysPastDue} BETWEEN 31 AND 60 THEN ${outstandingBaseCents} ELSE 0 END) AS days31To60BaseCents,
       SUM(CASE WHEN ${daysPastDue} BETWEEN 61 AND 90 THEN ${outstandingBaseCents} ELSE 0 END) AS days61To90BaseCents,
       SUM(CASE WHEN ${daysPastDue} > 90 THEN ${outstandingBaseCents} ELSE 0 END) AS over90BaseCents,
       COUNT(*) AS invoiceCount
     FROM customer_invoices ci
     JOIN business_partners bp ON bp.id = ci.customer_id
     WHERE ci.status <> 'void' AND substr(ci.invoice_date, 1, 10) <= (SELECT as_of FROM report_params) AND ${outstandingBaseCents} > 0
     GROUP BY bp.id
     HAVING totalBaseCents > 0
     ORDER BY over90BaseCents DESC, days61To90BaseCents DESC, totalBaseCents DESC`,
    asOf,
  );
  const sum = (key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  return {
    asOf,
    rows,
    totals: {
      totalBaseCents: sum("totalBaseCents"),
      currentBaseCents: sum("currentBaseCents"),
      days1To30BaseCents: sum("days1To30BaseCents"),
      days31To60BaseCents: sum("days31To60BaseCents"),
      days61To90BaseCents: sum("days61To90BaseCents"),
      over90BaseCents: sum("over90BaseCents"),
    },
  };
}

export async function customerStatement(partnerId: string, asOf = new Date().toISOString().slice(0, 10)) {
  await ensureDatabase();
  if (!partnerId.trim()) return { asOf, partnerId: "", rows: [], totals: { outstandingBaseCents: 0, invoiceCount: 0 } };
  const rows = await all<Record<string, unknown>>(
    `WITH report_params AS (SELECT ? AS as_of)
       SELECT ci.id, ci.number, ci.invoice_date AS invoiceDate, ci.due_date AS dueDate, ci.status, ci.currency,
        so.number AS salesOrderNumber, ci.total_cents AS totalCents, ${postedPayments} AS paidCents,
        ${postedCredits} AS creditedCents, ${outstandingDocumentCents} AS outstandingCents,
        ci.base_total_cents AS baseTotalCents, ${postedBasePayments} AS paidBaseCents,
        ${postedBaseCredits} AS creditedBaseCents, ${outstandingBaseCents} AS outstandingBaseCents,
        ${daysPastDue} AS daysPastDue
     FROM customer_invoices ci
     LEFT JOIN sales_orders so ON so.id = ci.sales_order_id
      WHERE ci.customer_id = ? AND ci.status <> 'void' AND substr(ci.invoice_date, 1, 10) <= (SELECT as_of FROM report_params)
      ORDER BY ci.invoice_date DESC, ci.number DESC`,
    asOf, partnerId,
  );
  return {
    asOf,
    partnerId,
    rows,
    totals: {
      outstandingBaseCents: rows.reduce((total, row) => total + Number(row.outstandingBaseCents ?? 0), 0),
      invoiceCount: rows.length,
    },
  };
}

export async function openOrdersByCustomer() {
  await ensureDatabase();
  const rows = await all<Record<string, unknown>>(
    `SELECT bp.id AS customerId, bp.code AS customerCode, bp.name AS customerName,
       COUNT(DISTINCT so.id) AS orderCount,
       SUM(sol.ordered_qty - sol.canceled_qty) AS orderedQuantity,
       SUM(MAX(sol.ordered_qty - sol.canceled_qty - COALESCE((SELECT SUM(CASE WHEN sm.movement_type = 'sales_shipment' THEN -sm.quantity WHEN sm.movement_type = 'shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id = sol.id), 0), 0)) AS openQuantity,
       -- Value only the unshipped share of each net item line, converted to company base CAD.
       SUM(ROUND(CASE WHEN sol.ordered_qty > 0 THEN
         MAX(sol.ordered_qty - sol.canceled_qty - COALESCE((SELECT SUM(CASE WHEN sm.movement_type = 'sales_shipment' THEN -sm.quantity WHEN sm.movement_type = 'shipment_reversal' THEN -sm.quantity ELSE 0 END) FROM stock_movements sm WHERE sm.sales_order_line_id = sol.id), 0), 0)
         * MAX(sol.ordered_qty * sol.unit_price_cents - sol.discount_cents, 0) / sol.ordered_qty * so.exchange_rate_to_base
         ELSE 0 END)) AS openBaseValueCents,
       MIN(so.requested_date) AS earliestRequestedDate
     FROM sales_orders so
     JOIN sales_order_lines sol ON sol.sales_order_id = so.id
     JOIN business_partners bp ON bp.id = so.customer_id
     WHERE so.lifecycle_status IN ('draft', 'confirmed')
       AND EXISTS (
         SELECT 1 FROM sales_order_lines open_line
         WHERE open_line.sales_order_id = so.id
           AND open_line.ordered_qty - open_line.canceled_qty
             - COALESCE((SELECT SUM(CASE WHEN open_movement.movement_type = 'sales_shipment' THEN -open_movement.quantity WHEN open_movement.movement_type = 'shipment_reversal' THEN -open_movement.quantity ELSE 0 END) FROM stock_movements open_movement WHERE open_movement.sales_order_line_id = open_line.id), 0) > 0
       )
     GROUP BY bp.id
     HAVING openQuantity > 0
     ORDER BY openBaseValueCents DESC`,
  );
  return {
    rows,
    totals: {
      openQuantity: rows.reduce((total, row) => total + Number(row.openQuantity ?? 0), 0),
      openBaseValueCents: rows.reduce((total, row) => total + Number(row.openBaseValueCents ?? 0), 0),
    },
  };
}

/**
 * Buying worklist: what to order, ranked by how far projected stock falls below target.
 * Suggested quantity restores the reorder point once open demand and incoming supply are
 * both accounted for, so a product already covered by an open PO is not reordered twice.
 */
export async function replenishmentWorklist(warehouseId = "") {
  await ensureDatabase();
  const scope = warehouseId.trim();
  const rows = await all<Record<string, unknown>>(
    `SELECT p.id, p.sku, p.name, p.inventory_policy AS inventoryPolicy, p.reorder_point AS reorderPoint,
     p.standard_cost_cents AS standardCostCents,
       COALESCE((SELECT SUM(ib.on_hand_qty) FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id
         WHERE ib.product_id = p.id AND l.active = 1 AND l.inventory_status = 'usable' AND (?='' OR l.warehouse_id = ?)), 0) AS usableQuantity,
       COALESCE((SELECT SUM(ib.on_hand_qty - ib.reserved_qty) FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id
         WHERE ib.product_id = p.id AND l.active = 1 AND l.inventory_status = 'usable' AND (?='' OR l.warehouse_id = ?)), 0) AS availableQuantity,
       COALESCE((SELECT SUM(pol.ordered_qty - pol.closed_qty - COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.purchase_order_line_id = pol.id AND sm.movement_type = 'purchase_receipt'), 0))
         FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
         WHERE pol.product_id = p.id AND po.lifecycle_status = 'approved'), 0) AS incomingQuantity,
       COALESCE((SELECT SUM(MAX(sol.ordered_qty - sol.canceled_qty
           - COALESCE((SELECT SUM(CASE WHEN sm.movement_type = 'sales_shipment' THEN -sm.quantity WHEN sm.movement_type = 'shipment_reversal' THEN -sm.quantity ELSE 0 END)
               FROM stock_movements sm WHERE sm.sales_order_line_id = sol.id), 0), 0))
         FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.sales_order_id
         WHERE sol.product_id = p.id AND so.lifecycle_status = 'confirmed'), 0) AS openDemandQuantity,
       (SELECT bp.name FROM purchase_orders po2 JOIN purchase_order_lines pol2 ON pol2.purchase_order_id = po2.id
          JOIN business_partners bp ON bp.id = po2.vendor_id
          WHERE pol2.product_id = p.id ORDER BY po2.expected_date DESC LIMIT 1) AS lastVendorName
     FROM products p
     WHERE p.active = 1 AND p.inventory_policy = 'stocked'`,
    scope, scope, scope, scope,
  );
  const enriched: Array<Record<string, unknown> & { projectedQuantity: number; suggestedOrderQuantity: number }> = rows
    .map((row) => {
      const usable = Number(row.usableQuantity ?? 0);
      const available = Number(row.availableQuantity ?? 0);
      const incoming = Number(row.incomingQuantity ?? 0);
      const demand = Number(row.openDemandQuantity ?? 0);
      const reorderPoint = Number(row.reorderPoint ?? 0);
      // Open demand still includes quantities already reserved. Starting from available
      // would subtract those reservations once in `available` and again in `demand`.
      const projected = usable + incoming - demand;
      const shortfall = reorderPoint - projected;
      return { ...row, usableQuantity: usable, availableQuantity: available, incomingQuantity: incoming, openDemandQuantity: demand, projectedQuantity: projected, suggestedOrderQuantity: shortfall > 0 ? Math.ceil(shortfall) : 0 };
    })
    .filter((row) => row.suggestedOrderQuantity > 0 || row.projectedQuantity < 0)
    .sort((left, right) => left.projectedQuantity - right.projectedQuantity);
  return {
    warehouseId: scope,
    rows: enriched,
    totals: {
      lineCount: enriched.length,
      suggestedValueCents: enriched.reduce((total, row) => total + row.suggestedOrderQuantity * Number((row as { standardCostCents?: unknown }).standardCostCents ?? 0), 0),
    },
  };
}
