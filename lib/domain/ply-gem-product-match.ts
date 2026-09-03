import type { ParsedPlyGemCostSheet, ParsedPlyGemLine } from "./ply-gem-cost-sheet";

export type PlyGemCatalogProduct = {
  id: string;
  sku: string;
  manufacturerSku: string | null;
  name: string;
  category: string;
  material: string;
  dimensions: string;
  finish: string;
};

export type PlyGemProductCandidate = PlyGemCatalogProduct & { score: number };

function normalized(value: string | null | undefined) {
  return String(value ?? "").toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

function numbers(value: string) {
  return [...value.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite);
}

function includesNear(values: number[], target: number | null, tolerance = 1.5) {
  return target != null && values.some((value) => Math.abs(value - target) <= tolerance);
}

function dimensionCodes(source: string) {
  return [...source.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((match) => match[1]);
}

function tokenPresent(value: string, token: string) {
  return new RegExp(`(?:^|[^A-Z0-9])${token}(?:$|[^A-Z0-9])`, "i").test(value);
}

function scoreProduct(document: ParsedPlyGemCostSheet, line: ParsedPlyGemLine, product: PlyGemCatalogProduct) {
  const source = `${document.orderName} ${document.supplierReference}`;
  const sourceNormalized = normalized(source);
  const productText = `${product.manufacturerSku ?? ""} ${product.sku} ${product.name} ${product.category} ${product.dimensions} ${product.finish}`;
  const productNormalized = normalized(productText);
  const manufacturerNormalized = normalized(product.manufacturerSku);
  let score = 0;

  if (manufacturerNormalized && sourceNormalized.includes(manufacturerNormalized)) score += 120;
  const codes = dimensionCodes(source);
  if (codes.some((code) => manufacturerNormalized.startsWith(code) || productNormalized.includes(code))) score += 70;

  const productNumbers = numbers(productText);
  if (includesNear(productNumbers, line.osmWidthMm) && includesNear(productNumbers, line.osmHeightMm)) score += 70;
  else if (includesNear(productNumbers, line.osmWidthMm, 5) || includesNear(productNumbers, line.osmHeightMm, 5)) score += 15;

  const type = line.productType.toUpperCase();
  if (type.includes("CASEMENT") && /CASEMENT/i.test(productText)) score += 30;
  if (type.includes("SLIDER") && /SLID(?:ER|ING)/i.test(productText)) score += 30;
  if (type.includes("PICTURE") && /PICTURE/i.test(productText)) score += 30;
  if (type.includes("HOPPER") && /HOPPER|BASEMENT/i.test(productText)) score += 30;
  if (type.includes("HUNG") && /HUNG/i.test(productText)) score += 30;
  if (type.includes("DOOR") && /PATIO|DOOR/i.test(productText)) score += 30;

  const handed = type.includes("RIGHT") ? "RIGHT" : type.includes("LEFT") ? "LEFT" : "";
  if (handed) {
    if (new RegExp(`\\b${handed}\\b`, "i").test(productText)) score += 65;
    if (new RegExp(`\\b${handed === "RIGHT" ? "LEFT" : "RIGHT"}\\b`, "i").test(productText)) score -= 180;
  }

  const patioHanding = sourceNormalized.includes("PATIOOX") ? "OX" : sourceNormalized.includes("PATIOXO") ? "XO" : "";
  if (patioHanding) {
    if (tokenPresent(product.name, patioHanding)) score += 65;
    if (tokenPresent(product.name, patioHanding === "OX" ? "XO" : "OX")) score -= 120;
  }

  const colour = (line.frameColour || document.frameColour).toUpperCase();
  const blackProduct = /\bBLACK\b/i.test(productText) || /-B(?:\b|-)/i.test(product.name);
  if (colour.includes("BLACK")) score += blackProduct ? 35 : -80;
  if (colour.includes("WHITE")) score += blackProduct ? -120 : /\bWHITE\b/i.test(product.finish) || /\bWHITE\b/i.test(product.name) ? 25 : 5;

  return score;
}

export function rankPlyGemProducts(document: ParsedPlyGemCostSheet, line: ParsedPlyGemLine, products: PlyGemCatalogProduct[]) {
  return products
    .map((product): PlyGemProductCandidate => ({ ...product, score: scoreProduct(document, line, product) }))
    .filter((product) => product.score > 0)
    .sort((left, right) => right.score - left.score || left.sku.localeCompare(right.sku))
    .slice(0, 5);
}

export function automaticPlyGemProductMatch(document: ParsedPlyGemCostSheet, line: ParsedPlyGemLine, products: PlyGemCatalogProduct[]) {
  const candidates = rankPlyGemProducts(document, line, products);
  const best = candidates[0];
  const runnerUp = candidates[1];
  const unambiguous = Boolean(best && best.score >= 60 && (!runnerUp || best.score - runnerUp.score >= 15));
  return { product: unambiguous ? best : null, candidates };
}
