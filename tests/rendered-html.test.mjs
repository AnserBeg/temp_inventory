import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

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
  const source = await readFile(new URL("../app/inventory-app.tsx", import.meta.url), "utf8");

  for (const required of [
    "Reopen quantity to receive",
    "Close unreceived quantity",
    "Post receipt",
    "Reverse incorrect receipt",
    "Return to vendor",
    "Post shipment",
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
});

test("declares durable D1 data and explicit command APIs", async () => {
  const [hosting, snapshotRoute, commandRoute] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/snapshot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/commands/route.ts", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(JSON.parse(hosting).d1, "DB");
  assert.match(snapshotRoute, /getInventorySnapshot/);
  assert.match(commandRoute, /executeInventoryCommand/);
  assert.match(commandRoute, /idempotency|InventoryCommand/i);
});
