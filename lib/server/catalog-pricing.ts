import { all, commandD1, commandGuardSql, first, getD1, newId, type CommandClaim } from "./inventory-db";

export type PricingActor = { label: string; id: string; email: string };

export type MarginRule = {
  id: string | null;
  code: string;
  targetMarginBps: number;
  minimumGrossProfitCents: number;
  roundingIncrementCents: number;
};

type ProductPricingState = {
  id: string;
  sku: string;
  category: string;
  standardCostCents: number;
  lastUnitCostCents: number | null;
  sellingPriceCents: number;
  suggestedSellingPriceCents: number | null;
  pricingMode: "automatic" | "manual";
  appliedMarginRuleId: string | null;
  lastUnitCostSourcePoId: string | null;
};

export type ApprovedPurchaseLine = {
  id: string;
  productId: string;
  quantity: number;
  unitCostCents: number;
  discountCents: number;
};

export type ApprovedPurchaseCostInput = {
  claim: CommandClaim;
  actor: PricingActor;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  purchaseOrderRevision: number;
  vendorId: string;
  currency: string;
  exchangeRateToBase: number;
  effectiveAt: string;
  eventType: "purchase_order_approved" | "purchase_order_amendment_approved" | "purchase_order_fast_track_approved" | "purchase_order_cost_restored";
  lines: ApprovedPurchaseLine[];
};

const fallbackRule: MarginRule = {
  id: null,
  code: "FALLBACK-32",
  targetMarginBps: 3200,
  minimumGrossProfitCents: 0,
  roundingIncrementCents: 100,
};

export function calculateSuggestedSellingPrice(costBasisCents: number, rule: MarginRule) {
  const cost = Math.max(Math.round(costBasisCents), 0);
  const marginPrice = Math.ceil(cost / (1 - rule.targetMarginBps / 10_000));
  const profitFloorPrice = cost + Math.max(Math.round(rule.minimumGrossProfitCents), 0);
  const unrounded = Math.max(marginPrice, profitFloorPrice);
  const increment = Math.max(Math.round(rule.roundingIncrementCents), 1);
  return Math.ceil(unrounded / increment) * increment;
}

export async function resolveMarginRule(input: { productId: string; category: string; costBasisCents: number; onDate?: string }): Promise<MarginRule> {
  const onDate = input.onDate ?? new Date().toISOString().slice(0, 10);
  const rule = await first<{
    id: string; code: string; targetMarginBps: number; minimumGrossProfitCents: number; roundingIncrementCents: number;
  }>(`SELECT id,code,target_margin_bps AS targetMarginBps,
      minimum_gross_profit_cents AS minimumGrossProfitCents,rounding_increment_cents AS roundingIncrementCents
    FROM margin_rules
    WHERE active=1 AND minimum_cost_cents<=? AND (maximum_cost_cents IS NULL OR maximum_cost_cents>?)
      AND (valid_from IS NULL OR valid_from<=?) AND (valid_to IS NULL OR valid_to>=?)
      AND (product_id=? OR (product_id IS NULL AND (category=? OR category IS NULL)))
    ORDER BY CASE WHEN product_id=? THEN 3 WHEN category=? THEN 2 ELSE 1 END DESC,priority DESC,minimum_cost_cents DESC,id
    LIMIT 1`, input.costBasisCents, input.costBasisCents, onDate, onDate, input.productId, input.category, input.productId, input.category);
  return rule ? {
    id: rule.id,
    code: rule.code,
    targetMarginBps: Number(rule.targetMarginBps),
    minimumGrossProfitCents: Number(rule.minimumGrossProfitCents),
    roundingIncrementCents: Number(rule.roundingIncrementCents),
  } : fallbackRule;
}

export async function suggestedPriceForProduct(input: { productId: string; category: string; costBasisCents: number; onDate?: string }) {
  const rule = await resolveMarginRule(input);
  return { rule, suggestedSellingPriceCents: calculateSuggestedSellingPrice(input.costBasisCents, rule) };
}

function guardedAuditStatement(claim: CommandClaim, actor: PricingActor, productId: string, summary: string, metadata: unknown, when: string) {
  return commandD1(claim).prepare(`INSERT INTO audit_events
    (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
    SELECT ?,'product',?,'catalog_price_recalculated',?,?,?,?,?,? WHERE ${commandGuardSql()}`)
    .bind(newId("audit"), productId, summary, actor.label, actor.id, actor.email, JSON.stringify(metadata), when);
}

function guardedOutboxStatement(claim: CommandClaim, productId: string, payload: unknown, when: string) {
  return commandD1(claim).prepare(`INSERT INTO outbox_events
    (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
    SELECT ?,'pricing.catalog_recalculated','product',?,?,'pending',0,?,? WHERE ${commandGuardSql()}`)
    .bind(newId("outbox"), productId, JSON.stringify(payload), when, when);
}

export async function prepareApprovedPurchaseCostStatements(input: ApprovedPurchaseCostInput): Promise<D1PreparedStatement[]> {
  const groups = new Map<string, ApprovedPurchaseLine[]>();
  for (const line of input.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    const current = groups.get(line.productId) ?? [];
    current.push(line);
    groups.set(line.productId, current);
  }
  const statements: D1PreparedStatement[] = [];
  for (const [productId, lines] of groups) {
    const product = await first<ProductPricingState>(`SELECT id,sku,category,standard_cost_cents AS standardCostCents,
        last_unit_cost_cents AS lastUnitCostCents,selling_price_cents AS sellingPriceCents,
        suggested_selling_price_cents AS suggestedSellingPriceCents,pricing_mode AS pricingMode,
        applied_margin_rule_id AS appliedMarginRuleId,last_unit_cost_source_po_id AS lastUnitCostSourcePoId
      FROM products WHERE id=? AND active=1`, productId);
    if (!product) continue;
    const quantity = lines.reduce((sum, line) => sum + Number(line.quantity), 0);
    const gross = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCostCents), 0);
    const discount = lines.reduce((sum, line) => sum + Math.max(Number(line.discountCents), 0), 0);
    const lastUnitCostCents = Math.max(Math.round(Math.max(gross - discount, 0) * input.exchangeRateToBase / quantity), 0);
    const sourceLineId = lines.length === 1 ? lines[0].id : null;
    const { rule, suggestedSellingPriceCents } = await suggestedPriceForProduct({ productId, category: product.category, costBasisCents: lastUnitCostCents, onDate: input.effectiveAt.slice(0, 10) });
    const effectiveSellingPriceCents = product.pricingMode === "automatic" ? suggestedSellingPriceCents : Number(product.sellingPriceCents);
    const db = commandD1(input.claim);
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO product_cost_history
        (id,product_id,source_purchase_order_id,source_purchase_order_line_id,purchase_order_revision,vendor_id,last_unit_cost_cents,source_currency,exchange_rate_to_base,effective_at,recorded_by)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${commandGuardSql()}`)
        .bind(newId("product-cost"), productId, input.purchaseOrderId, sourceLineId, input.purchaseOrderRevision, input.vendorId, lastUnitCostCents, input.currency, input.exchangeRateToBase, input.effectiveAt, input.actor.label),
      db.prepare(`UPDATE products SET last_unit_cost_cents=?,last_unit_cost_source_po_id=?,last_unit_cost_source_po_line_id=?,
          last_unit_cost_vendor_id=?,last_unit_cost_at=?,suggested_selling_price_cents=?,applied_margin_rule_id=?,
          selling_price_cents=CASE WHEN pricing_mode='automatic' THEN ? ELSE selling_price_cents END,
          pricing_updated_at=?,version=version+1 WHERE id=? AND active=1 AND ${commandGuardSql()}`)
        .bind(lastUnitCostCents, input.purchaseOrderId, sourceLineId, input.vendorId, input.effectiveAt, suggestedSellingPriceCents, rule.id, suggestedSellingPriceCents, input.effectiveAt, productId),
      db.prepare(`INSERT INTO catalog_price_history
        (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${commandGuardSql()}`)
        .bind(newId("catalog-price"), productId, input.eventType, lastUnitCostCents, product.sellingPriceCents, suggestedSellingPriceCents, effectiveSellingPriceCents, product.pricingMode, rule.id, input.purchaseOrderId, `${input.purchaseOrderNumber} revision ${input.purchaseOrderRevision} approved`, input.effectiveAt, input.actor.label),
      guardedAuditStatement(input.claim, input.actor, productId,
        `${product.sku} last unit cost updated from ${input.purchaseOrderNumber}; ${product.pricingMode === "automatic" ? "catalog price updated" : "manual catalog price preserved"}.`,
        { purchaseOrderId: input.purchaseOrderId, purchaseOrderRevision: input.purchaseOrderRevision, lastUnitCostCents, suggestedSellingPriceCents, effectiveSellingPriceCents, pricingMode: product.pricingMode, marginRuleId: rule.id }, input.effectiveAt),
      guardedOutboxStatement(input.claim, productId, { purchaseOrderId: input.purchaseOrderId, lastUnitCostCents, suggestedSellingPriceCents, effectiveSellingPriceCents, pricingMode: product.pricingMode, marginRuleId: rule.id }, input.effectiveAt),
    );
  }
  return statements;
}

export async function prepareExistingApprovedPurchaseCostStatements(input: {
  claim: CommandClaim; actor: PricingActor; purchaseOrderId: string; effectiveAt: string;
  eventType: ApprovedPurchaseCostInput["eventType"];
}) {
  const order = await first<{ number: string; revision: number; vendorId: string; currency: string; exchangeRate: number }>(
    `SELECT number,revision_number AS revision,vendor_id AS vendorId,currency,exchange_rate_to_base AS exchangeRate
       FROM purchase_orders WHERE id=?`, input.purchaseOrderId);
  if (!order) return [];
  const lines = await all<ApprovedPurchaseLine>(`SELECT id,product_id AS productId,ordered_qty AS quantity,
      unit_cost_cents AS unitCostCents,discount_cents AS discountCents FROM purchase_order_lines WHERE purchase_order_id=?`, input.purchaseOrderId);
  return prepareApprovedPurchaseCostStatements({
    ...input,
    purchaseOrderNumber: order.number,
    purchaseOrderRevision: Number(order.revision),
    vendorId: order.vendorId,
    currency: order.currency,
    exchangeRateToBase: Number(order.exchangeRate),
    lines,
  });
}

export async function repriceAutomaticProducts(actor: PricingActor, reason: string, eventType = "margin_matrix_changed") {
  const products = await all<ProductPricingState>(`SELECT id,sku,category,standard_cost_cents AS standardCostCents,
      last_unit_cost_cents AS lastUnitCostCents,selling_price_cents AS sellingPriceCents,
      suggested_selling_price_cents AS suggestedSellingPriceCents,pricing_mode AS pricingMode,
      applied_margin_rule_id AS appliedMarginRuleId,last_unit_cost_source_po_id AS lastUnitCostSourcePoId
    FROM products WHERE active=1 AND pricing_mode='automatic' ORDER BY id`);
  const statements: D1PreparedStatement[] = [];
  const when = new Date().toISOString();
  for (const product of products) {
    const costBasisCents = Number(product.lastUnitCostCents ?? product.standardCostCents);
    const { rule, suggestedSellingPriceCents } = await suggestedPriceForProduct({ productId: product.id, category: product.category, costBasisCents });
    if (suggestedSellingPriceCents === product.sellingPriceCents && rule.id === product.appliedMarginRuleId) continue;
    statements.push(
      getD1().prepare(`UPDATE products SET suggested_selling_price_cents=?,selling_price_cents=?,applied_margin_rule_id=?,pricing_updated_at=?,version=version+1 WHERE id=? AND pricing_mode='automatic'`)
        .bind(suggestedSellingPriceCents, suggestedSellingPriceCents, rule.id, when, product.id),
      getD1().prepare(`INSERT INTO catalog_price_history
        (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(newId("catalog-price"), product.id, eventType, costBasisCents, product.sellingPriceCents, suggestedSellingPriceCents, suggestedSellingPriceCents, "automatic", rule.id, product.lastUnitCostSourcePoId, reason, when, actor.label),
    );
  }
  if (statements.length) await getD1().batch(statements);
  return statements.length / 2;
}

export async function prepareCanceledPurchaseCostStatements(input: { claim: CommandClaim; actor: PricingActor; purchaseOrderId: string; effectiveAt: string }) {
  const affected = await all<{ id: string; category: string; standardCostCents: number; sellingPriceCents: number; pricingMode: "automatic" | "manual" }>(
    `SELECT DISTINCT p.id,p.category,p.standard_cost_cents AS standardCostCents,p.selling_price_cents AS sellingPriceCents,p.pricing_mode AS pricingMode
       FROM products p JOIN purchase_order_lines pol ON pol.product_id=p.id
      WHERE pol.purchase_order_id=? AND p.last_unit_cost_source_po_id=?`, input.purchaseOrderId, input.purchaseOrderId);
  const statements: D1PreparedStatement[] = [];
  for (const product of affected) {
    const prior = await first<{ purchaseOrderId: string }>(`SELECT po.id AS purchaseOrderId
      FROM purchase_orders po JOIN purchase_order_lines pol ON pol.purchase_order_id=po.id
      LEFT JOIN product_cost_history pch ON pch.product_id=pol.product_id AND pch.source_purchase_order_id=po.id
      WHERE pol.product_id=? AND po.lifecycle_status='approved' AND po.id<>?
      GROUP BY po.id,po.created_at
      ORDER BY COALESCE(MAX(pch.effective_at),po.created_at) DESC,MAX(COALESCE(pch.purchase_order_revision,po.revision_number)) DESC,po.id DESC
      LIMIT 1`, product.id, input.purchaseOrderId);
    if (prior) {
      const restored = await prepareExistingApprovedPurchaseCostStatements({ ...input, purchaseOrderId: prior.purchaseOrderId, eventType: "purchase_order_cost_restored" });
      statements.push(...restored);
      continue;
    }
    const { rule, suggestedSellingPriceCents } = await suggestedPriceForProduct({ productId: product.id, category: product.category, costBasisCents: product.standardCostCents });
    const effective = product.pricingMode === "automatic" ? suggestedSellingPriceCents : product.sellingPriceCents;
    const db = commandD1(input.claim);
    statements.push(
      db.prepare(`UPDATE products SET last_unit_cost_cents=NULL,last_unit_cost_source_po_id=NULL,last_unit_cost_source_po_line_id=NULL,
          last_unit_cost_vendor_id=NULL,last_unit_cost_at=NULL,suggested_selling_price_cents=?,applied_margin_rule_id=?,
          selling_price_cents=CASE WHEN pricing_mode='automatic' THEN ? ELSE selling_price_cents END,pricing_updated_at=?,version=version+1
        WHERE id=? AND last_unit_cost_source_po_id=? AND ${commandGuardSql()}`)
        .bind(suggestedSellingPriceCents, rule.id, suggestedSellingPriceCents, input.effectiveAt, product.id, input.purchaseOrderId),
      db.prepare(`INSERT INTO catalog_price_history
        (id,product_id,event_type,cost_basis_cents,previous_selling_price_cents,suggested_selling_price_cents,effective_selling_price_cents,pricing_mode,margin_rule_id,source_purchase_order_id,reason,created_at,created_by)
        SELECT ?,?,'purchase_order_cost_cleared',?,?,?,?,?,?,?,?,?,? WHERE ${commandGuardSql()}`)
        .bind(newId("catalog-price"), product.id, product.standardCostCents, product.sellingPriceCents, suggestedSellingPriceCents, effective, product.pricingMode, rule.id, null, "Latest approved PO was canceled; standard cost fallback restored", input.effectiveAt, input.actor.label),
    );
  }
  return statements;
}
