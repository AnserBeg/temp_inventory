import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [app, importer] = await Promise.all([
  readFile(new URL("../app/inventory-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ply-gem-import.tsx", import.meta.url), "utf8"),
]);

test("purchase orders expose the PDF importer in the page header", () => {
  assert.match(app, /view === "purchase-orders"[\s\S]*?<PlyGemImportButton[\s\S]*?label="Import PDFs"/);
  assert.match(app, /onPurchaseOrderImported=\{async \(\) => \{ await loadSnapshot\(\); setWorkflowRefreshToken/);
});

test("the purchase-order importer accepts a single PDF or a batch", () => {
  assert.match(importer, /<input type="file" accept="application\/pdf,\.pdf" multiple/);
  assert.match(importer, /Select cost-sheet PDFs/);
  assert.match(importer, /Each PDF becomes a separate draft PO/);
});
