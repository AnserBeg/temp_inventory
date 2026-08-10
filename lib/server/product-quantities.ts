import { first, roundQuantity } from "./inventory-db";

export type ProductQuantityUsage = "base" | "purchase" | "sales";

export class ProductQuantityError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

type ProductUomConfiguration = {
  id: string;
  sku: string;
  trackingPolicy: string;
  baseUomId: string;
  purchaseUomId: string;
  salesUomId: string;
  baseCode: string | null;
  baseName: string | null;
  baseDimension: string | null;
  basePrecision: number | null;
  baseActive: number | null;
};

type UnitOfMeasure = {
  id: string;
  code: string;
  name: string;
  dimension: string;
  precision: number;
  active: number;
};

type Conversion = { numerator: number; denominator: number };

export type NormalizedProductQuantity = {
  productId: string;
  sku: string;
  enteredQuantity: number;
  baseQuantity: number;
  fromUomId: string;
  fromUomCode: string;
  fromUomName: string;
  baseUomId: string;
  baseUomCode: string;
  baseUomName: string;
  factorToBase: number;
  basePrecision: number;
  trackingPolicy: string;
};

function roundedToPrecision(value: number, precision: number) {
  const scale = 10 ** precision;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

async function productConfiguration(productId: string) {
  const product = await first<ProductUomConfiguration>(`SELECT p.id,p.sku,p.tracking_policy AS trackingPolicy,
      p.base_uom_id AS baseUomId,p.purchase_uom_id AS purchaseUomId,p.sales_uom_id AS salesUomId,
      u.code AS baseCode,u.name AS baseName,u.dimension AS baseDimension,u.precision AS basePrecision,u.active AS baseActive
    FROM products p LEFT JOIN units_of_measure u ON u.id=p.base_uom_id
    WHERE p.id=? AND p.active=1`, productId);
  if (!product) throw new ProductQuantityError("INVALID_PRODUCT", "The quantity must reference an active product.", 404);
  if (!product.baseCode || !product.baseName || !product.baseDimension || product.basePrecision == null || !product.baseActive) {
    throw new ProductQuantityError("UOM_CONFIGURATION_ERROR", `${product.sku} does not have an active base unit of measure.`, 409);
  }
  if (!Number.isInteger(product.basePrecision) || product.basePrecision < 0 || product.basePrecision > 3) {
    throw new ProductQuantityError("UOM_CONFIGURATION_ERROR", `${product.sku} has an invalid base-unit precision.`, 409);
  }
  return { ...product, baseCode: product.baseCode, baseName: product.baseName, baseDimension: product.baseDimension, basePrecision: product.basePrecision } as ProductUomConfiguration & { baseCode: string; baseName: string; baseDimension: string; basePrecision: number };
}

async function unitOfMeasure(uomId: string) {
  return first<UnitOfMeasure>("SELECT id,code,name,dimension,precision,active FROM units_of_measure WHERE id=?", uomId);
}

async function conversionFactor(productId: string, fromUomId: string, baseUomId: string) {
  if (fromUomId === baseUomId) return 1;
  const direct = await first<Conversion>(`SELECT numerator,denominator FROM uom_conversions
    WHERE (product_id=? OR product_id IS NULL) AND from_uom_id=? AND to_uom_id=?
    ORDER BY CASE WHEN product_id=? THEN 0 ELSE 1 END,id LIMIT 1`, productId, fromUomId, baseUomId, productId);
  if (direct) return Number(direct.numerator) / Number(direct.denominator);
  const reverse = await first<Conversion>(`SELECT numerator,denominator FROM uom_conversions
    WHERE (product_id=? OR product_id IS NULL) AND from_uom_id=? AND to_uom_id=?
    ORDER BY CASE WHEN product_id=? THEN 0 ELSE 1 END,id LIMIT 1`, productId, baseUomId, fromUomId, productId);
  if (reverse) return Number(reverse.denominator) / Number(reverse.numerator);
  throw new ProductQuantityError("UOM_CONVERSION_MISSING", "No active conversion exists between the selected unit and the product base unit.", 409);
}

export async function normalizeProductQuantity(input: {
  productId: string;
  quantity: number;
  uomId?: string | null;
  usage?: ProductQuantityUsage;
  field?: string;
  allowZero?: boolean;
}) {
  const field = input.field ?? "quantity";
  if (!Number.isFinite(input.quantity) || input.quantity < (input.allowZero ? 0 : Number.EPSILON)) {
    throw new ProductQuantityError("VALIDATION_ERROR", `${field} must be ${input.allowZero ? "zero or greater" : "greater than zero"}.`);
  }
  const product = await productConfiguration(input.productId);
  const usage = input.usage ?? "base";
  const configuredUomId = usage === "purchase" ? product.purchaseUomId : usage === "sales" ? product.salesUomId : product.baseUomId;
  const fromUomId = input.uomId?.trim() || configuredUomId;
  const from = await unitOfMeasure(fromUomId);
  if (!from?.active) throw new ProductQuantityError("INVALID_UOM", `${field} must use an active unit of measure.`, 404);
  if (from.dimension !== product.baseDimension) {
    throw new ProductQuantityError("UOM_DIMENSION_MISMATCH", `${from.code} cannot be converted to ${product.baseCode} for ${product.sku}.`, 409);
  }
  const factorToBase = await conversionFactor(product.id, from.id, product.baseUomId);
  if (!Number.isFinite(factorToBase) || factorToBase <= 0) {
    throw new ProductQuantityError("UOM_CONFIGURATION_ERROR", `The ${from.code} conversion for ${product.sku} is invalid.`, 409);
  }
  const rawBaseQuantity = input.quantity * factorToBase;
  const baseQuantity = roundedToPrecision(rawBaseQuantity, product.basePrecision);
  if (Math.abs(rawBaseQuantity - baseQuantity) > 1e-7) {
    const precisionLabel = product.basePrecision === 0 ? `whole ${product.baseCode} units` : `at most ${product.basePrecision} decimal places in ${product.baseCode}`;
    throw new ProductQuantityError("INVALID_QUANTITY_PRECISION", `${field} converts to ${rawBaseQuantity} ${product.baseCode}; ${product.sku} requires ${precisionLabel}.`, 409);
  }
  if ((product.trackingPolicy === "serial" || product.basePrecision === 0) && !Number.isInteger(baseQuantity)) {
    throw new ProductQuantityError("DISCRETE_QUANTITY_REQUIRED", `${product.sku} is discrete inventory and requires a whole-number base quantity.`, 409);
  }
  return {
    productId: product.id,
    sku: product.sku,
    enteredQuantity: input.quantity,
    baseQuantity: roundQuantity(baseQuantity),
    fromUomId: from.id,
    fromUomCode: from.code,
    fromUomName: from.name,
    baseUomId: product.baseUomId,
    baseUomCode: product.baseCode,
    baseUomName: product.baseName,
    factorToBase,
    basePrecision: product.basePrecision,
    trackingPolicy: product.trackingPolicy,
  } satisfies NormalizedProductQuantity;
}

export async function validateBaseProductQuantity(productId: string, quantity: number, field = "quantity", allowZero = false) {
  return normalizeProductQuantity({ productId, quantity, usage: "base", field, allowZero });
}
