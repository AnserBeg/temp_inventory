import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

import { env } from "./cloudflare-workers-stub.mjs";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const db = new D1SqliteDatabase();
let inventoryDomain;

async function applyMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
  }
}

function run(sql, ...values) { return db.prepare(sql).bind(...values).run(); }

before(async () => {
  await applyMigrations();
  env.DB = db;
  env.ALLOW_LOCAL_DEV_AUTH = "false";
  env.BOOTSTRAP_DEMO_DATA = "false";
  const inventoryDb = await import("../lib/server/inventory-db.ts");
  inventoryDomain = await import("../lib/server/inventory-domain.ts");
  await inventoryDb.ensureDatabase();
  await run("INSERT INTO business_partners (id,code,name,partner_type,currency,active,version,created_at) VALUES ('picker-customer','PICK-C','Picker Customer','customer','CAD',1,1,'2026-09-01')");
  for (let index = 1; index <= 25; index += 1) {
    await run(`INSERT INTO products
      (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,base_uom_id,purchase_uom_id,sales_uom_id,active,version,created_at)
      VALUES (?,?,?,'test','test','test','test','quantity','stocked',100,200,0,'uom-each','uom-each','uom-each',1,1,'2026-09-01')`,
      `picker-product-${index}`, `PICK-${String(index).padStart(3, "0")}`, `Picker item ${index}`);
  }
});

after(() => db.close());

test("a full item-picker page resolves pricing in constant database round trips", async () => {
  const originalPrepare = db.prepare.bind(db);
  let preparedStatements = 0;
  db.prepare = (sql) => { preparedStatements += 1; return originalPrepare(sql); };
  try {
    const result = await inventoryDomain.searchInventoryReferences("products", "PICK-", 25, "sales", "picker-customer", 1, undefined, "CAD", 1);
    assert.equal(result.items.length, 25);
    assert.ok(preparedStatements <= 3, `expected at most 3 database round trips, received ${preparedStatements}`);
  } finally {
    db.prepare = originalPrepare;
  }
});
