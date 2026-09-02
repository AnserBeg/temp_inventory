import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePlyGemCostSheet } from "../lib/domain/ply-gem-cost-sheet.ts";
import { automaticPlyGemProductMatch } from "../lib/domain/ply-gem-product-match.ts";

const token = (text, x, top) => ({ text, x, top });
const page = (pageNumber, tokens = []) => ({ pageNumber, width: 612, height: 792, tokens });

function itemPage(pageNumber, { line, quantity, unit, total, type, dimensions }) {
  return page(pageNumber, [
    token("Line", 30, 100), token("Qty", 100, 100), token("Unit Price", 400, 100), token("Total Price", 500, 100),
    token(String(line), 30, 130), token(String(quantity), 100, 130), token(unit, 400, 130), token(total, 500, 130),
    token(`Product Type: ${type}`, 85, 150), token(dimensions, 85, 170),
  ]);
}

test("Ply Gem parser reads item rows across a variable number of PDF pages", () => {
  const first = itemPage(1, { line: 1, quantity: 2, unit: "$100.00", total: "$200.00", type: "Casement Right", dimensions: "760 X 760" });
  first.tokens.unshift(
    token("Ply Gem", 20, 20), token("STOCK 3030CR", 20, 35), token("Quote:", 120, 35),
    token("Quote Number:", 20, 50), token("999999", 150, 50),
    token("Created: 26-Aug-2026", 20, 65), token("Scheduled: 09-Sep-2026", 200, 65),
    token("PO: Supplier planning ref, VPO1:", 20, 80),
    token("Frame Colour: Exterior = White, Interior = White", 20, 90),
  );
  const pages = [
    first,
    itemPage(2, { line: 2, quantity: 1, unit: "$150.00", total: "$150.00", type: "Picture", dimensions: "600 X 900" }),
    page(3, [token("Configuration continuation page", 20, 20)]),
    page(4, [
      token("Total Quantity:", 300, 100), token("3", 500, 100),
      token("Subtotal:", 300, 120), token("$350.00", 500, 120),
      token("GST/HST:", 300, 140), token("$17.50", 500, 140),
      token("Tax Total:", 300, 160), token("$17.50", 500, 160),
      token("TOTAL:", 300, 180), token("$367.50", 500, 180),
    ]),
  ];
  const parsed = parsePlyGemCostSheet({ clientId: "fixture", fileName: "Cost Sheet-999999.pdf", sourceDocumentHash: "a".repeat(64), pages });
  assert.equal(parsed.quoteNumber, "999999");
  assert.equal(parsed.supplierReference, "Supplier planning ref");
  assert.equal(parsed.scheduledDate, "2026-09-09");
  assert.equal(parsed.lines.length, 2);
  assert.deepEqual(parsed.lines.map((line) => [line.sourceLineNumber, line.quantity, line.lineTotalCents]), [["1", 2, 20000], ["2", 1, 15000]]);
  assert.deepEqual({ quantity: parsed.totalQuantity, subtotal: parsed.subtotalCents, tax: parsed.taxTotalCents, total: parsed.totalCents }, { quantity: 3, subtotal: 35000, tax: 1750, total: 36750 });
});

test("Ply Gem matching distinguishes handed windows and patio-door configurations", () => {
  const document = {
    orderName: "STOCK 3030CR",
    supplierReference: "Stock PatioOX",
    frameColour: "White",
  };
  const rightLine = { productType: "Casement Right", frameColour: "White", osmWidthMm: 760, osmHeightMm: 760 };
  const products = [
    { id: "right", sku: "RIGHT", manufacturerSku: "3030CR", name: "Casement Right", category: "Window", material: "Vinyl", dimensions: "760 x 760 mm", finish: "White" },
    { id: "left", sku: "LEFT", manufacturerSku: "3030CL", name: "Casement Left", category: "Window", material: "Vinyl", dimensions: "760 x 760 mm", finish: "White" },
  ];
  assert.equal(automaticPlyGemProductMatch(document, rightLine, products).product?.id, "right");

  const patioLine = { productType: "Patio Door", frameColour: "White", osmWidthMm: 1800, osmHeightMm: 2000 };
  const patioProducts = [
    { id: "ox", sku: "PATIO-OX", manufacturerSku: null, name: "6 ft Patio OX", category: "Door", material: "Vinyl", dimensions: "1800 x 2000 mm", finish: "White" },
    { id: "xo", sku: "PATIO-XO", manufacturerSku: null, name: "6 ft Patio XO", category: "Door", material: "Vinyl", dimensions: "1800 x 2000 mm", finish: "White" },
  ];
  assert.equal(automaticPlyGemProductMatch(document, patioLine, patioProducts).product?.id, "ox");
});

test("Ply Gem matching refuses an ambiguous catalog result", () => {
  const document = { orderName: "", supplierReference: "", frameColour: "White" };
  const line = { productType: "Picture", frameColour: "White", osmWidthMm: 600, osmHeightMm: 900 };
  const products = ["a", "b"].map((id) => ({ id, sku: id.toUpperCase(), manufacturerSku: null, name: "Picture window", category: "Window", material: "Vinyl", dimensions: "600 x 900 mm", finish: "White" }));
  assert.equal(automaticPlyGemProductMatch(document, line, products).product, null);
});
