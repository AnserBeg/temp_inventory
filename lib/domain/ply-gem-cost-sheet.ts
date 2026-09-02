export type PositionedPdfToken = {
  text: string;
  x: number;
  top: number;
};

export type PositionedPdfPage = {
  pageNumber: number;
  width: number;
  height: number;
  tokens: PositionedPdfToken[];
};

export type ParsedPlyGemLine = {
  sourceLineNumber: string;
  quantity: number;
  unitCostCents: number;
  lineTotalCents: number;
  productType: string;
  frameColour: string;
  osmWidthMm: number | null;
  osmHeightMm: number | null;
  configurationSnapshot: string;
};

export type ParsedPlyGemCharge = {
  chargeType: "freight" | "fee" | "other";
  description: string;
  amountCents: number;
};

export type ParsedPlyGemCostSheet = {
  clientId: string;
  fileName: string;
  sourceDocumentHash: string;
  supplierName: string;
  quoteNumber: string;
  supplierReference: string;
  orderName: string;
  createdDate: string;
  scheduledDate: string;
  currency: "CAD";
  totalQuantity: number;
  subtotalCents: number;
  pstCents: number;
  gstCents: number;
  taxTotalCents: number;
  totalCents: number;
  taxCode: string;
  taxRateBps: number;
  frameColour: string;
  lines: ParsedPlyGemLine[];
  charges: ParsedPlyGemCharge[];
  warnings: string[];
};

export class PlyGemCostSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlyGemCostSheetError";
  }
}

const moneyPattern = /^\(?\$[\d,]+\.\d{2}\)?$/;

function cleanTokens(page: PositionedPdfPage) {
  return page.tokens
    .map((token) => ({ ...token, text: token.text.trim() }))
    .filter((token) => token.text.length > 0);
}

function cents(value: string | undefined, label: string) {
  if (!value || !moneyPattern.test(value)) throw new PlyGemCostSheetError(`${label} was not found.`);
  const negative = value.startsWith("(");
  const numeric = Number(value.replaceAll(/[()$,]/g, ""));
  if (!Number.isFinite(numeric)) throw new PlyGemCostSheetError(`${label} is not a valid amount.`);
  return Math.round(numeric * 100) * (negative ? -1 : 1);
}

function optionalCents(value: string | undefined) {
  return value && moneyPattern.test(value) ? cents(value, "Amount") : 0;
}

function sameRow(left: PositionedPdfToken, right: PositionedPdfToken, tolerance = 2.25) {
  return Math.abs(left.top - right.top) <= tolerance;
}

function moneyBesideLabel(tokens: PositionedPdfToken[], label: string) {
  const anchor = tokens.find((token) => token.text.toLowerCase() === label.toLowerCase());
  if (!anchor) return undefined;
  return tokens
    .filter((token) => token.x > anchor.x + 35 && sameRow(anchor, token) && moneyPattern.test(token.text))
    .sort((left, right) => left.x - right.x)[0]?.text;
}

function numberBesideLabel(tokens: PositionedPdfToken[], label: string) {
  const anchor = tokens.find((token) => token.text.toLowerCase() === label.toLowerCase());
  if (!anchor) return undefined;
  return tokens
    .filter((token) => token.x > anchor.x + 25 && sameRow(anchor, token) && /^\d+(?:\.\d+)?$/.test(token.text))
    .sort((left, right) => left.x - right.x)[0]?.text;
}

function isoDate(value: string, label: string) {
  const match = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) throw new PlyGemCostSheetError(`${label} was not found.`);
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase()) + 1;
  if (!month) throw new PlyGemCostSheetError(`${label} contains an unknown month.`);
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

function firstMatchingToken(tokens: PositionedPdfToken[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    const value = tokens.find((token) => pattern.test(token.text))?.text;
    if (value) return value;
  }
  return "";
}

function parseDimensions(block: PositionedPdfToken[]) {
  const value = block.find((token) => /^\d+(?:\.\d+)?\s+X\s+\d+(?:\.\d+)?$/i.test(token.text))?.text;
  const match = value?.match(/^(\d+(?:\.\d+)?)\s+X\s+(\d+(?:\.\d+)?)$/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: null, height: null };
}

function configurationFor(globalTokens: PositionedPdfToken[], block: PositionedPdfToken[], lineNumber: string, dimensions: { width: number | null; height: number | null }) {
  const selected = [...globalTokens, ...block]
    .map((token) => token.text)
    .filter((text) => /^(Series:|Product Type:|Frame (?:Width|Height|Colour):|Jamb:|Screen\s*:|Nailing Fin:|Egress:|Egress Hinge:|Sash Restrictors:|Handle (?:Colour|Type):|Lock:|Toe Lock:|Slab Ship Loose Option\s*:|Site Install Panels|Glass Type:|Glass Thickness:|Preserve:|Sealed Unit Type:)/i.test(text));
  const pieces = [`Ply Gem source line ${lineNumber}`];
  if (dimensions.width != null && dimensions.height != null) pieces.push(`OSM ${dimensions.width} x ${dimensions.height} mm`);
  for (const value of selected) if (!pieces.includes(value)) pieces.push(value);
  return pieces.join(" | ").slice(0, 4000);
}

function parseItemPage(page: PositionedPdfPage, globalTokens: PositionedPdfToken[]) {
  const tokens = cleanTokens(page);
  const lineHeader = tokens.find((token) => token.text === "Line");
  const qtyHeader = tokens.find((token) => token.text === "Qty" && (!lineHeader || sameRow(lineHeader, token, 3)));
  const unitHeader = tokens.find((token) => /^Unit\s+Price$/i.test(token.text) && (!lineHeader || sameRow(lineHeader, token, 3)));
  const totalHeader = tokens.find((token) => /^Total\s+Price$/i.test(token.text) && (!lineHeader || sameRow(lineHeader, token, 3)));
  if (!lineHeader || !qtyHeader || !unitHeader || !totalHeader) return [];

  const rowStarts = tokens
    .filter((token) => token.top > lineHeader.top + 5 && token.x >= unitHeader.x - 18 && token.x <= unitHeader.x + 35 && moneyPattern.test(token.text))
    .map((unit) => {
      const peers = tokens.filter((token) => sameRow(unit, token));
      const line = peers.find((token) => Math.abs(token.x - lineHeader.x) < 22 && /^\d+$/.test(token.text));
      const quantity = peers.find((token) => Math.abs(token.x - qtyHeader.x) < 22 && /^\d+(?:\.\d+)?$/.test(token.text));
      const total = peers.find((token) => Math.abs(token.x - totalHeader.x) < 35 && moneyPattern.test(token.text));
      return line && quantity && total ? { line, quantity, unit, total, top: Math.min(line.top, quantity.top, unit.top, total.top) } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => left.top - right.top);

  return rowStarts.map((row, index): ParsedPlyGemLine => {
    const nextTop = rowStarts[index + 1]?.top ?? page.height - 55;
    const block = tokens.filter((token) => token.top > row.top + 3 && token.top < nextTop - 3);
    const productType = block.find((token) => /^Product Type:/i.test(token.text))?.text.replace(/^Product Type:\s*/i, "").trim() ?? "Unspecified product";
    const frameColourText = block.find((token) => /^Frame Colour:/i.test(token.text))?.text ?? firstMatchingToken(globalTokens, [/^Frame Colour:/i]);
    const frameColour = frameColourText.match(/Exterior\s*=\s*([^,]+)/i)?.[1]?.trim() ?? "Unspecified";
    const dimensions = parseDimensions(block);
    const quantity = Number(row.quantity.text);
    const unitCostCents = cents(row.unit.text, `Unit price on source line ${row.line.text}`);
    const lineTotalCents = cents(row.total.text, `Total price on source line ${row.line.text}`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new PlyGemCostSheetError(`Quantity on source line ${row.line.text} is invalid.`);
    if (Math.round(quantity * unitCostCents) !== lineTotalCents) throw new PlyGemCostSheetError(`Source line ${row.line.text} does not reconcile quantity, unit price, and total price.`);
    return {
      sourceLineNumber: row.line.text,
      quantity,
      unitCostCents,
      lineTotalCents,
      productType,
      frameColour,
      osmWidthMm: dimensions.width,
      osmHeightMm: dimensions.height,
      configurationSnapshot: configurationFor(globalTokens, block, row.line.text, dimensions),
    };
  });
}

export function parsePlyGemCostSheet(input: { clientId: string; fileName: string; sourceDocumentHash: string; pages: PositionedPdfPage[] }): ParsedPlyGemCostSheet {
  if (!input.pages.length) throw new PlyGemCostSheetError("The PDF has no readable pages.");
  const firstPage = cleanTokens(input.pages[0]);
  const firstText = firstPage.map((token) => token.text).join(" ");
  if (!/Ply\s*Gem/i.test(firstText)) throw new PlyGemCostSheetError("This does not appear to be a Ply Gem cost sheet.");

  const quoteFromName = input.fileName.match(/(?:Cost\s*Sheet[-_ ]*)?(\d{6})/i)?.[1];
  const quoteLabel = firstPage.find((token) => /^Quote Number:$/i.test(token.text));
  const quoteNearLabel = quoteLabel ? firstPage.find((token) => /^\d{6}$/.test(token.text) && sameRow(quoteLabel, token, 3))?.text : undefined;
  const quoteNumber = quoteNearLabel ?? quoteFromName ?? firstText.match(/\b(\d{6})\b/)?.[1] ?? "";
  if (!quoteNumber) throw new PlyGemCostSheetError("Quote number was not found.");

  const headerKindIndex = firstPage.findIndex((token, index) => index < 20 && /^(?:Order|Quote):$/i.test(token.text));
  const orderName = headerKindIndex > 0 ? firstPage[headerKindIndex - 1].text : "";
  const scheduledRaw = firstText.match(/Scheduled:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i)?.[1] ?? "";
  const createdRaw = firstText.match(/Created:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i)?.[1] ?? "";
  const supplierReference = firstText.match(/\bPO:\s*([^,]+?)(?:,\s*VPO1:|\s+Model:)/i)?.[1]?.trim() ?? "";
  const frameColourText = firstMatchingToken(firstPage, [/^Frame Colour:/i]);
  const frameColour = frameColourText.match(/Exterior\s*=\s*([^,]+)/i)?.[1]?.trim() ?? "Unspecified";
  const globalTokens = firstPage.filter((token) => /^(Series:|Frame Colour:|Jamb:|Screen\s*:|Nailing Fin:|Handle (?:Colour|Type):|Lock:|Glass Type:|Preserve:|Sealed Unit Type:)/i.test(token.text));

  const lines = input.pages.flatMap((page) => parseItemPage(page, globalTokens));
  if (!lines.length) throw new PlyGemCostSheetError("No item lines were found on the PDF pages.");

  const summaryPage = input.pages.map(cleanTokens).find((tokens) => tokens.some((token) => token.text === "Total Quantity:") && tokens.some((token) => token.text === "Subtotal:") && tokens.some((token) => token.text === "TOTAL:"));
  if (!summaryPage) throw new PlyGemCostSheetError("The final totals section was not found.");
  const totalQuantity = Number(numberBesideLabel(summaryPage, "Total Quantity:"));
  const subtotalCents = cents(moneyBesideLabel(summaryPage, "Subtotal:"), "Subtotal");
  const pstCents = optionalCents(moneyBesideLabel(summaryPage, "PST:"));
  const gstCents = optionalCents(moneyBesideLabel(summaryPage, "GST/HST:"));
  const taxTotalCents = cents(moneyBesideLabel(summaryPage, "Tax Total:"), "Tax total");
  const totalCents = cents(moneyBesideLabel(summaryPage, "TOTAL:"), "Total");
  const miscChargesCents = optionalCents(moneyBesideLabel(summaryPage, "Misc Charges:"));
  const surchargesCents = optionalCents(moneyBesideLabel(summaryPage, "Surcharges:"));
  const freightCents = optionalCents(moneyBesideLabel(summaryPage, "Freight:"));
  const cashDepositCents = Math.abs(optionalCents(moneyBesideLabel(summaryPage, "Cash Deposit:")));
  const charges: ParsedPlyGemCharge[] = [
    freightCents > 0 ? { chargeType: "freight" as const, description: "Ply Gem freight", amountCents: freightCents } : null,
    surchargesCents > 0 ? { chargeType: "fee" as const, description: "Ply Gem surcharge", amountCents: surchargesCents } : null,
    miscChargesCents > 0 ? { chargeType: "other" as const, description: "Ply Gem miscellaneous charges", amountCents: miscChargesCents } : null,
  ].filter((charge): charge is ParsedPlyGemCharge => charge !== null);
  const chargeTotalCents = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
  const parsedQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const parsedSubtotal = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  if (parsedQuantity !== totalQuantity) throw new PlyGemCostSheetError(`Item quantity ${parsedQuantity} does not match the PDF total quantity ${totalQuantity}.`);
  if (parsedSubtotal !== subtotalCents) throw new PlyGemCostSheetError(`Item subtotal ${parsedSubtotal} does not match the PDF subtotal ${subtotalCents}.`);
  if (pstCents + gstCents !== taxTotalCents) throw new PlyGemCostSheetError("PST and GST/HST do not reconcile to the PDF tax total.");
  if (subtotalCents + chargeTotalCents + taxTotalCents !== totalCents) throw new PlyGemCostSheetError("Subtotal, charges, and tax do not reconcile to the PDF total.");

  const taxableBaseCents = subtotalCents + chargeTotalCents;
  const taxRateBps = taxableBaseCents > 0 ? Math.round((taxTotalCents * 10000) / taxableBaseCents) : 0;
  const calculatedTax = [...lines.map((line) => line.lineTotalCents), ...charges.map((charge) => charge.amountCents)]
    .reduce((sum, amount) => sum + Math.round((amount * taxRateBps) / 10000), 0);
  if (calculatedTax !== taxTotalCents) throw new PlyGemCostSheetError("The PDF uses a tax allocation this importer cannot reproduce line by line.");

  const warnings: string[] = [];
  if (cashDepositCents > 0) warnings.push("The PDF shows a cash deposit. It is retained as a source warning and is not posted by a draft PO import.");
  return {
    clientId: input.clientId,
    fileName: input.fileName,
    sourceDocumentHash: input.sourceDocumentHash,
    supplierName: "Ply Gem",
    quoteNumber,
    supplierReference,
    orderName,
    createdDate: isoDate(createdRaw, "Created date"),
    scheduledDate: isoDate(scheduledRaw, "Scheduled date"),
    currency: "CAD",
    totalQuantity,
    subtotalCents,
    pstCents,
    gstCents,
    taxTotalCents,
    totalCents,
    taxCode: pstCents > 0 ? "GST/PST" : gstCents > 0 ? "GST" : "EXEMPT",
    taxRateBps,
    frameColour,
    lines,
    charges,
    warnings,
  };
}
