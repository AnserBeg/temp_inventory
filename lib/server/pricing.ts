import { all, first } from "./inventory-db";
import { normalizeProductQuantity, ProductQuantityError, type ProductQuantityUsage } from "./product-quantities";

export type EffectivePrice = {
  unitAmountCents: number;
  source: "contract" | "catalog" | "last_unit_cost" | "standard_cost";
  sourceLabel: string;
  priceListId: string | null;
  priceListCode: string | null;
  uomId: string;
  uomCode: string;
  factorToBase: number;
  currency: string;
};

type ProductPrice = {
  sku: string;
  standardCostCents: number;
  lastUnitCostCents: number | null;
  lastUnitCostSourcePoNumber: string | null;
  sellingPriceCents: number;
  purchaseUomId: string;
  salesUomId: string;
};

type ContractPrice = {
  unitPriceCents: number;
  priceListId: string;
  priceListCode: string;
  currency: string;
};

type BatchProductPrice = ProductPrice & {
  productId: string;
  trackingPolicy: string;
  baseUomId: string;
  baseUomCode: string | null;
  baseUomName: string | null;
  baseDimension: string | null;
  basePrecision: number | null;
  baseUomActive: number | null;
  fromUomId: string;
  fromUomCode: string | null;
  fromUomName: string | null;
  fromDimension: string | null;
  fromUomActive: number | null;
  factorToBase: number | null;
};

type BatchContractPrice = ContractPrice & { productId: string };

export async function resolveEffectivePrice(input: {
  productId: string;
  usage: Exclude<ProductQuantityUsage, "base">;
  partnerId?: string | null;
  uomId?: string | null;
  quantity?: number;
  onDate?: string;
  currency?: string | null;
  exchangeRateToBase?: number | null;
}): Promise<EffectivePrice> {
  const product = await first<ProductPrice>(`SELECT p.sku,p.standard_cost_cents AS standardCostCents,
      p.last_unit_cost_cents AS lastUnitCostCents,po.number AS lastUnitCostSourcePoNumber,
      p.selling_price_cents AS sellingPriceCents,p.purchase_uom_id AS purchaseUomId,p.sales_uom_id AS salesUomId
    FROM products p LEFT JOIN purchase_orders po ON po.id=p.last_unit_cost_source_po_id
    WHERE p.id=? AND p.active=1`, input.productId);
  if (!product) throw new ProductQuantityError("INVALID_PRODUCT", "Pricing requires an active product.", 404);
  const enteredQuantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
  const quantity = await normalizeProductQuantity({ productId: input.productId, quantity: enteredQuantity, uomId: input.uomId, usage: input.usage, field: "price quantity" });
  const date = input.onDate ?? new Date().toISOString().slice(0, 10);
  const partnerCurrency = input.partnerId ? await first<{ currency: string }>("SELECT currency FROM business_partners WHERE id=? AND active=1", input.partnerId) : null;
  const currency = String(input.currency || partnerCurrency?.currency || "CAD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ProductQuantityError("INVALID_CURRENCY", "Pricing currency must be a three-letter ISO code.");
  if (input.usage === "sales" && input.partnerId) {
    const contract = await first<ContractPrice>(`SELECT ple.unit_price_cents AS unitPriceCents,pl.id AS priceListId,pl.code AS priceListCode,pl.currency
      FROM price_list_assignments pla
      JOIN price_lists pl ON pl.id=pla.price_list_id
      JOIN price_list_entries ple ON ple.price_list_id=pl.id
      WHERE pla.partner_id=? AND pla.active=1 AND pl.active=1 AND ple.active=1 AND pl.currency=?
        AND ple.product_id=? AND ple.uom_id=? AND ple.minimum_quantity<=?
        AND (pla.valid_from IS NULL OR pla.valid_from<=?) AND (pla.valid_to IS NULL OR pla.valid_to>=?)
        AND (pl.valid_from IS NULL OR pl.valid_from<=?) AND (pl.valid_to IS NULL OR pl.valid_to>=?)
        AND (ple.valid_from IS NULL OR ple.valid_from<=?) AND (ple.valid_to IS NULL OR ple.valid_to>=?)
      ORDER BY pla.priority DESC,ple.minimum_quantity DESC,pl.priority DESC,ple.id
      LIMIT 1`, input.partnerId, currency, input.productId, quantity.fromUomId, enteredQuantity, date, date, date, date, date, date);
    if (contract) return {
      unitAmountCents: Number(contract.unitPriceCents), source: "contract", sourceLabel: `Contract ${contract.priceListCode}`,
      priceListId: contract.priceListId, priceListCode: contract.priceListCode, uomId: quantity.fromUomId,
      uomCode: quantity.fromUomCode, factorToBase: quantity.factorToBase, currency: contract.currency,
    };
  }
  const hasLastUnitCost = input.usage === "purchase" && product.lastUnitCostCents != null;
  const baseAmount = input.usage === "purchase" ? Number(product.lastUnitCostCents ?? product.standardCostCents) : Number(product.sellingPriceCents);
  const exchange = currency === "CAD" ? 1 : Number(input.exchangeRateToBase);
  if (!Number.isFinite(exchange) || exchange <= 0) throw new ProductQuantityError("EXCHANGE_RATE_REQUIRED", `Enter a positive ${currency}-to-CAD exchange rate before using catalog pricing.`);
  return {
    unitAmountCents: Math.round(baseAmount * quantity.factorToBase / exchange),
    source: input.usage === "purchase" ? hasLastUnitCost ? "last_unit_cost" : "standard_cost" : "catalog",
    sourceLabel: input.usage === "purchase"
      ? hasLastUnitCost ? `Last unit cost${product.lastUnitCostSourcePoNumber ? ` · ${product.lastUnitCostSourcePoNumber}` : ""}` : "Catalog standard cost fallback"
      : "Catalog selling price",
    priceListId: null,
    priceListCode: null,
    uomId: quantity.fromUomId,
    uomCode: quantity.fromUomCode,
    factorToBase: quantity.factorToBase,
    currency,
  };
}

export async function effectivePricesForProducts(input: {
  products: Array<Record<string, unknown>>;
  usage: Exclude<ProductQuantityUsage, "base">;
  partnerId?: string | null;
  quantity?: number;
  currency?: string | null;
  exchangeRateToBase?: number | null;
}) {
  if (!input.products.length) return [];
  const productIds = [...new Set(input.products.map((product) => String(product.id)))];
  const productIdsJson = JSON.stringify(productIds);
  const enteredQuantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
  const uomColumn = input.usage === "purchase" ? "purchase_uom_id" : "sales_uom_id";

  // The picker returns up to 25 products. Resolving each one independently used to issue a
  // product query, two UOM queries, a partner query, and sometimes a contract query per row.
  // Load the same configuration in one statement so a first-time item search has constant
  // database round trips instead of growing linearly with the result count.
  const configurations = await all<BatchProductPrice>(`SELECT p.id AS productId,p.sku,p.tracking_policy AS trackingPolicy,
      p.standard_cost_cents AS standardCostCents,p.last_unit_cost_cents AS lastUnitCostCents,
      po.number AS lastUnitCostSourcePoNumber,p.selling_price_cents AS sellingPriceCents,
      p.purchase_uom_id AS purchaseUomId,p.sales_uom_id AS salesUomId,p.base_uom_id AS baseUomId,
      base.code AS baseUomCode,base.name AS baseUomName,base.dimension AS baseDimension,
      base.precision AS basePrecision,base.active AS baseUomActive,
      source.id AS fromUomId,source.code AS fromUomCode,source.name AS fromUomName,
      source.dimension AS fromDimension,source.active AS fromUomActive,
      COALESCE(
        CASE WHEN p.${uomColumn}=p.base_uom_id THEN 1.0 END,
        (SELECT CAST(c.numerator AS REAL)/c.denominator FROM uom_conversions c
          WHERE (c.product_id=p.id OR c.product_id IS NULL) AND c.from_uom_id=p.${uomColumn} AND c.to_uom_id=p.base_uom_id
          ORDER BY c.product_id IS NULL,c.id LIMIT 1),
        (SELECT CAST(c.denominator AS REAL)/c.numerator FROM uom_conversions c
          WHERE (c.product_id=p.id OR c.product_id IS NULL) AND c.from_uom_id=p.base_uom_id AND c.to_uom_id=p.${uomColumn}
          ORDER BY c.product_id IS NULL,c.id LIMIT 1)
      ) AS factorToBase
    FROM products p
    LEFT JOIN purchase_orders po ON po.id=p.last_unit_cost_source_po_id
    LEFT JOIN units_of_measure base ON base.id=p.base_uom_id
    LEFT JOIN units_of_measure source ON source.id=p.${uomColumn}
    WHERE p.active=1 AND p.id IN (SELECT value FROM json_each(?))`, productIdsJson);
  const configurationByProduct = new Map(configurations.map((configuration) => [configuration.productId, configuration]));

  const partnerCurrency = input.partnerId && !input.currency
    ? await first<{ currency: string }>("SELECT currency FROM business_partners WHERE id=? AND active=1", input.partnerId)
    : null;
  const currency = String(input.currency || partnerCurrency?.currency || "CAD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ProductQuantityError("INVALID_CURRENCY", "Pricing currency must be a three-letter ISO code.");

  const contractsByProduct = new Map<string, BatchContractPrice>();
  if (input.usage === "sales" && input.partnerId) {
    const date = new Date().toISOString().slice(0, 10);
    const contracts = await all<BatchContractPrice>(`SELECT ple.product_id AS productId,ple.unit_price_cents AS unitPriceCents,
        pl.id AS priceListId,pl.code AS priceListCode,pl.currency
      FROM price_list_assignments pla
      JOIN price_lists pl ON pl.id=pla.price_list_id
      JOIN price_list_entries ple ON ple.price_list_id=pl.id
      JOIN products p ON p.id=ple.product_id
      WHERE pla.partner_id=? AND pla.active=1 AND pl.active=1 AND ple.active=1 AND pl.currency=?
        AND ple.product_id IN (SELECT value FROM json_each(?)) AND ple.uom_id=p.sales_uom_id AND ple.minimum_quantity<=?
        AND (pla.valid_from IS NULL OR pla.valid_from<=?) AND (pla.valid_to IS NULL OR pla.valid_to>=?)
        AND (pl.valid_from IS NULL OR pl.valid_from<=?) AND (pl.valid_to IS NULL OR pl.valid_to>=?)
        AND (ple.valid_from IS NULL OR ple.valid_from<=?) AND (ple.valid_to IS NULL OR ple.valid_to>=?)
      ORDER BY ple.product_id,pla.priority DESC,ple.minimum_quantity DESC,pl.priority DESC,ple.id`,
      input.partnerId, currency, productIdsJson, enteredQuantity, date, date, date, date, date, date);
    for (const contract of contracts) if (!contractsByProduct.has(contract.productId)) contractsByProduct.set(contract.productId, contract);
  }

  return input.products.map((product) => {
    const configuration = configurationByProduct.get(String(product.id));
    if (!configuration) throw new ProductQuantityError("INVALID_PRODUCT", "Pricing requires an active product.", 404);
    if (!configuration.baseUomCode || !configuration.baseUomName || !configuration.baseDimension || configuration.basePrecision == null || !configuration.baseUomActive) {
      throw new ProductQuantityError("UOM_CONFIGURATION_ERROR", `${configuration.sku} does not have an active base unit of measure.`, 409);
    }
    if (!Number.isInteger(configuration.basePrecision) || configuration.basePrecision < 0 || configuration.basePrecision > 3) {
      throw new ProductQuantityError("UOM_CONFIGURATION_ERROR", `${configuration.sku} has an invalid base-unit precision.`, 409);
    }
    if (!configuration.fromUomCode || !configuration.fromUomName || !configuration.fromUomActive) {
      throw new ProductQuantityError("INVALID_UOM", "price quantity must use an active unit of measure.", 404);
    }
    if (configuration.fromDimension !== configuration.baseDimension) {
      throw new ProductQuantityError("UOM_DIMENSION_MISMATCH", `${configuration.fromUomCode} cannot be converted to ${configuration.baseUomCode} for ${configuration.sku}.`, 409);
    }
    const factorToBase = Number(configuration.factorToBase);
    if (!Number.isFinite(factorToBase) || factorToBase <= 0) {
      throw new ProductQuantityError("UOM_CONVERSION_MISSING", "No active conversion exists between the selected unit and the product base unit.", 409);
    }
    const rawBaseQuantity = enteredQuantity * factorToBase;
    const scale = 10 ** configuration.basePrecision;
    const baseQuantity = Math.round((rawBaseQuantity + Number.EPSILON) * scale) / scale;
    if (Math.abs(rawBaseQuantity - baseQuantity) > 1e-7) {
      const precisionLabel = configuration.basePrecision === 0 ? `whole ${configuration.baseUomCode} units` : `at most ${configuration.basePrecision} decimal places in ${configuration.baseUomCode}`;
      throw new ProductQuantityError("INVALID_QUANTITY_PRECISION", `price quantity converts to ${rawBaseQuantity} ${configuration.baseUomCode}; ${configuration.sku} requires ${precisionLabel}.`, 409);
    }
    if ((configuration.trackingPolicy === "serial" || configuration.basePrecision === 0) && !Number.isInteger(baseQuantity)) {
      throw new ProductQuantityError("DISCRETE_QUANTITY_REQUIRED", `${configuration.sku} is discrete inventory and requires a whole-number base quantity.`, 409);
    }

    const contract = contractsByProduct.get(configuration.productId);
    if (contract) return {
      ...product,
      effectiveUnitAmountCents: Number(contract.unitPriceCents),
      effectiveCurrency: contract.currency,
      priceSource: `Contract ${contract.priceListCode}`,
      selectedUomId: configuration.fromUomId,
      selectedUomCode: configuration.fromUomCode,
      factorToBase,
    };

    const exchange = currency === "CAD" ? 1 : Number(input.exchangeRateToBase);
    if (!Number.isFinite(exchange) || exchange <= 0) {
      throw new ProductQuantityError("EXCHANGE_RATE_REQUIRED", `Enter a positive ${currency}-to-CAD exchange rate before using catalog pricing.`);
    }
    const hasLastUnitCost = input.usage === "purchase" && configuration.lastUnitCostCents != null;
    const baseAmount = input.usage === "purchase"
      ? Number(configuration.lastUnitCostCents ?? configuration.standardCostCents)
      : Number(configuration.sellingPriceCents);
    return {
      ...product,
      effectiveUnitAmountCents: Math.round(baseAmount * factorToBase / exchange),
      effectiveCurrency: currency,
      priceSource: input.usage === "purchase"
        ? hasLastUnitCost
          ? `Last unit cost${configuration.lastUnitCostSourcePoNumber ? ` · ${configuration.lastUnitCostSourcePoNumber}` : ""}`
          : "Catalog standard cost fallback"
        : "Catalog selling price",
      selectedUomId: configuration.fromUomId,
      selectedUomCode: configuration.fromUomCode,
      factorToBase,
    };
  });
}

export async function listEffectiveContractPrices(partnerId: string, onDate = new Date().toISOString().slice(0, 10)) {
  return all<Record<string, unknown>>(`SELECT pl.code AS priceListCode,pl.name AS priceListName,p.sku,p.name AS productName,
      pl.currency,u.code AS uomCode,ple.minimum_quantity AS minimumQuantity,ple.unit_price_cents AS unitPriceCents,
      ple.valid_from AS validFrom,ple.valid_to AS validTo
    FROM price_list_assignments pla JOIN price_lists pl ON pl.id=pla.price_list_id
    JOIN price_list_entries ple ON ple.price_list_id=pl.id JOIN products p ON p.id=ple.product_id
    JOIN units_of_measure u ON u.id=ple.uom_id WHERE pla.partner_id=? AND pla.active=1 AND pl.active=1 AND ple.active=1
      AND (pla.valid_from IS NULL OR pla.valid_from<=?) AND (pla.valid_to IS NULL OR pla.valid_to>=?)
      AND (pl.valid_from IS NULL OR pl.valid_from<=?) AND (pl.valid_to IS NULL OR pl.valid_to>=?)
      AND (ple.valid_from IS NULL OR ple.valid_from<=?) AND (ple.valid_to IS NULL OR ple.valid_to>=?)
    ORDER BY pla.priority DESC,pl.priority DESC,p.sku,ple.minimum_quantity DESC`, partnerId, onDate, onDate, onDate, onDate, onDate, onDate);
}
