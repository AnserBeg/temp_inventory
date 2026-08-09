import { all, first } from "./inventory-db";
import { normalizeProductQuantity, ProductQuantityError, type ProductQuantityUsage } from "./product-quantities";

export type EffectivePrice = {
  unitAmountCents: number;
  source: "contract" | "catalog" | "standard_cost";
  sourceLabel: string;
  priceListId: string | null;
  priceListCode: string | null;
  uomId: string;
  uomCode: string;
  factorToBase: number;
};

type ProductPrice = {
  sku: string;
  standardCostCents: number;
  sellingPriceCents: number;
  purchaseUomId: string;
  salesUomId: string;
};

type ContractPrice = {
  unitPriceCents: number;
  priceListId: string;
  priceListCode: string;
};

export async function resolveEffectivePrice(input: {
  productId: string;
  usage: Exclude<ProductQuantityUsage, "base">;
  partnerId?: string | null;
  uomId?: string | null;
  quantity?: number;
  onDate?: string;
}): Promise<EffectivePrice> {
  const product = await first<ProductPrice>(`SELECT sku,standard_cost_cents AS standardCostCents,
      selling_price_cents AS sellingPriceCents,purchase_uom_id AS purchaseUomId,sales_uom_id AS salesUomId
    FROM products WHERE id=? AND active=1`, input.productId);
  if (!product) throw new ProductQuantityError("INVALID_PRODUCT", "Pricing requires an active product.", 404);
  const enteredQuantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
  const quantity = await normalizeProductQuantity({ productId: input.productId, quantity: enteredQuantity, uomId: input.uomId, usage: input.usage, field: "price quantity" });
  const date = input.onDate ?? new Date().toISOString().slice(0, 10);
  if (input.usage === "sales" && input.partnerId) {
    const contract = await first<ContractPrice>(`SELECT ple.unit_price_cents AS unitPriceCents,pl.id AS priceListId,pl.code AS priceListCode
      FROM price_list_assignments pla
      JOIN price_lists pl ON pl.id=pla.price_list_id
      JOIN price_list_entries ple ON ple.price_list_id=pl.id
      WHERE pla.partner_id=? AND pla.active=1 AND pl.active=1 AND ple.active=1
        AND ple.product_id=? AND ple.uom_id=? AND ple.minimum_quantity<=?
        AND (pla.valid_from IS NULL OR pla.valid_from<=?) AND (pla.valid_to IS NULL OR pla.valid_to>=?)
        AND (pl.valid_from IS NULL OR pl.valid_from<=?) AND (pl.valid_to IS NULL OR pl.valid_to>=?)
        AND (ple.valid_from IS NULL OR ple.valid_from<=?) AND (ple.valid_to IS NULL OR ple.valid_to>=?)
      ORDER BY pla.priority DESC,ple.minimum_quantity DESC,pl.priority DESC,ple.id
      LIMIT 1`, input.partnerId, input.productId, quantity.fromUomId, enteredQuantity, date, date, date, date, date, date);
    if (contract) return {
      unitAmountCents: Number(contract.unitPriceCents), source: "contract", sourceLabel: `Contract ${contract.priceListCode}`,
      priceListId: contract.priceListId, priceListCode: contract.priceListCode, uomId: quantity.fromUomId,
      uomCode: quantity.fromUomCode, factorToBase: quantity.factorToBase,
    };
  }
  const baseAmount = input.usage === "purchase" ? Number(product.standardCostCents) : Number(product.sellingPriceCents);
  return {
    unitAmountCents: Math.round(baseAmount * quantity.factorToBase),
    source: input.usage === "purchase" ? "standard_cost" : "catalog",
    sourceLabel: input.usage === "purchase" ? "Catalog standard cost" : "Catalog selling price",
    priceListId: null,
    priceListCode: null,
    uomId: quantity.fromUomId,
    uomCode: quantity.fromUomCode,
    factorToBase: quantity.factorToBase,
  };
}

export async function effectivePricesForProducts(input: {
  products: Array<Record<string, unknown>>;
  usage: Exclude<ProductQuantityUsage, "base">;
  partnerId?: string | null;
  quantity?: number;
}) {
  return Promise.all(input.products.map(async (product) => {
    const resolved = await resolveEffectivePrice({
      productId: String(product.id), usage: input.usage, partnerId: input.partnerId, quantity: input.quantity,
    });
    return { ...product, effectiveUnitAmountCents: resolved.unitAmountCents, priceSource: resolved.sourceLabel, selectedUomId: resolved.uomId, selectedUomCode: resolved.uomCode, factorToBase: resolved.factorToBase };
  }));
}

export async function listEffectiveContractPrices(partnerId: string) {
  return all<Record<string, unknown>>(`SELECT pl.code AS priceListCode,pl.name AS priceListName,p.sku,p.name AS productName,
      u.code AS uomCode,ple.minimum_quantity AS minimumQuantity,ple.unit_price_cents AS unitPriceCents,
      ple.valid_from AS validFrom,ple.valid_to AS validTo
    FROM price_list_assignments pla JOIN price_lists pl ON pl.id=pla.price_list_id
    JOIN price_list_entries ple ON ple.price_list_id=pl.id JOIN products p ON p.id=ple.product_id
    JOIN units_of_measure u ON u.id=ple.uom_id WHERE pla.partner_id=? AND pla.active=1 AND pl.active=1 AND ple.active=1
    ORDER BY pl.priority DESC,p.sku,ple.minimum_quantity DESC`, partnerId);
}

