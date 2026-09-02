import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships PaneFlow product metadata and removes starter preview infrastructure", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /InventoryApp/);
  assert.match(layout, /PaneFlow Operations/);
  assert.match(layout, /\/og\.png/);
  assert.match(layout, /x-forwarded-host/);
  assert.doesNotMatch(page + layout, /codex-preview|SkeletonPreview|Starter Project/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../public/og.png", import.meta.url));
});

test("exposes the required operational language and impact previews", async () => {
  const source = (await Promise.all([
    readFile(new URL("../app/inventory-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/operations-suite.tsx", import.meta.url), "utf8"),
  ])).join("\n");

  for (const required of [
    "Reopen stock-receipt quantity",
    "Close unfulfilled quantity",
    "Post receipt",
    "Reverse incorrect receipt",
    "Return to vendor",
    "Post shipment",
    "Reserve available stock",
    "Create purchase order",
    "Create sales order",
    "approved purchase order",
    "Sales order with invoiceable fulfillment",
    "Physical inventory",
    "Commercial commitment",
    "Financial effect",
    "On-hand inventory",
    "No change",
    "Warehouse mode",
    "Three-way match exception",
  ]) {
    assert.match(source, new RegExp(required, "i"), `missing UI contract: ${required}`);
  }
  assert.match(source, /Ctrl K/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /caption className="sr-only"/);
});

test("includes responsive, focus-visible, reduced-motion, and print behavior", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media print/);
  assert.match(css, /min-height: 54px/);
  assert.match(css, /html\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(css, /\.quick-create-dialog > div:not\(\.dialog-header\)\s*\{[^}]*padding:\s*18px 20px 20px/);
  assert.match(css, /\.command-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 36px\)/);
  assert.match(css, /input\[type="checkbox"\]\s*\{[^}]*width:\s*17px/);
  assert.match(css, /\.app-shell input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[\s\S]*?font-size:\s*16px/);
  assert.match(css, /\.supply-allocation-row\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("declares durable D1 data and explicit command and record APIs", async () => {
  const [hosting, snapshotRoute, commandRoute, recordsRoute] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/snapshot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/commands/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(JSON.parse(hosting).d1, "DB");
  assert.match(snapshotRoute, /getInventorySnapshot/);
  assert.match(commandRoute, /executeInventoryCommand/);
  assert.match(commandRoute, /idempotency|InventoryCommand/i);
  assert.match(recordsRoute, /createOrderRecord/);
  assert.match(recordsRoute, /export async function POST/);
});

test("purchase-order drafts round-trip their line discount and tax through the composer", async () => {
  // The composer prices every purchase line with a discount and tax rate. Migration 0012 gave
  // purchase_order_lines the columns to store them; these assertions guard the two client-side
  // halves that make the stored values visible again, which is where they were being dropped:
  // the snapshot normaliser must read them, and the composer must turn cents and basis points
  // back into the percentages the buyer typed.
  const app = await readFile(new URL("../app/inventory-app.tsx", import.meta.url), "utf8");
  const purchaseLines = app.slice(app.indexOf("const lines = asRows(item.lines).map((line, lineIndex): PurchaseLine"), app.indexOf("const expectedDate = text(item.expectedDate"));

  assert.match(purchaseLines, /discountCents: number\(line\.discountCents\)/);
  assert.match(purchaseLines, /taxable: number\(line\.taxable\) !== 0/);
  assert.match(purchaseLines, /taxRateBps: number\(line\.taxRateBps\)/);
  // Optional fields would silently normalise a stored discount to zero, which is the exact
  // failure this guards: the order would reopen showing 0% against a total that included it.
  assert.match(app, /\r?\n  discountCents: number;\r?\n  taxable: boolean;\r?\n  taxRateBps: number;\r?\n  version: number;\r?\n\};/);

  const draft = app.slice(app.indexOf("function composerDraft("), app.indexOf("function AdvancedCreateOrderDialog("));
  assert.match(draft, /discountCents: line\.discountCents, taxable: line\.taxable, taxRateBps: line\.taxRateBps/);

  // cents ÷ gross gives the percent back, and basis points ÷ 100 the tax rate.
  assert.match(app, /discountRate: line\.quantity \* line\.unitAmount > 0 \? line\.discountCents \/ \(line\.quantity \* line\.unitAmount\) : 0/);
  assert.match(app, /taxRate: line\.taxRateBps \/ 100/);
});
