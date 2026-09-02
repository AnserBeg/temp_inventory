import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

import { D1SqliteDatabase } from "./d1-sqlite.mjs";

const migrationDirectory = new URL("../drizzle/", import.meta.url);

async function migrationFiles() {
  return (await readdir(migrationDirectory)).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort();
}

async function applyMigration(db, file) {
  const sql = await readFile(new URL(file, migrationDirectory), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
}

async function databaseBeforeImport() {
  const db = new D1SqliteDatabase();
  for (const file of await migrationFiles()) {
    if (file === "0024_max_green_import.sql") break;
    await applyMigration(db, file);
  }
  return db;
}

function seedDeployedDemoFootprint(db) {
  const productIds = [
    "prod-awning-2436",
    "prod-casement-3648",
    "prod-custom-413859",
    "prod-doublehung-3054",
    "prod-patio-6068",
    "prod-slider-6048",
  ];
  for (const [index, id] of productIds.entries()) {
    db.exec(`INSERT INTO products
      (id,sku,name,category,material,dimensions,finish,tracking_policy,inventory_policy,standard_cost_cents,selling_price_cents,reorder_point,active,created_at)
      VALUES ('${id}','DEMO-${index + 1}','Demo ${index + 1}','Demo','Vinyl','N/A','White','quantity','stocked',100,200,0,1,'2026-08-08T22:30:34.012Z')`);
  }

  const partnerIds = [
    ["customer-copperstone", "C-440", "customer"],
    ["customer-northstar", "C-425", "customer"],
    ["customer-ridgeview", "C-410", "customer"],
    ["vendor-allweather", "V-310", "vendor"],
    ["vendor-andersen", "V-100", "vendor"],
    ["vendor-plygem", "V-220", "vendor"],
  ];
  for (const [id, code, type] of partnerIds) {
    db.exec(`INSERT INTO business_partners (id,code,name,partner_type,created_at)
      VALUES ('${id}','${code}','Demo ${code}','${type}','2026-08-08T22:30:34.012Z')`);
  }

  const locationIds = ["loc-a01", "loc-b03", "loc-quarantine", "loc-receiving", "loc-returns", "loc-staging"];
  for (const [index, id] of locationIds.entries()) {
    db.exec(`INSERT INTO locations (id,code,name,location_type,inventory_status)
      VALUES ('${id}','DEMO-LOC-${index + 1}','Demo location ${index + 1}','storage','usable')`);
  }

  const balances = [
    [productIds[0], locationIds[0]],
    [productIds[1], locationIds[0]],
    [productIds[1], locationIds[2]],
    [productIds[2], locationIds[2]],
    [productIds[3], locationIds[1]],
    [productIds[4], locationIds[0]],
    [productIds[5], locationIds[1]],
  ];
  for (const [productId, locationId] of balances) {
    db.exec(`INSERT INTO inventory_balances (product_id,location_id,on_hand_qty,reserved_qty,version)
      VALUES ('${productId}','${locationId}',1,0,1)`);
  }
}

test("Max Green migration stays inert on a clean database", async () => {
  const db = await databaseBeforeImport();
  try {
    await applyMigration(db, "0024_max_green_import.sql");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM products").get().count, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM business_partners").get().count, 0);
  } finally {
    db.close();
  }
});

test("Max Green migration replaces the deployed demo footprint", async () => {
  const db = await databaseBeforeImport();
  try {
    seedDeployedDemoFootprint(db);
    await applyMigration(db, "0024_max_green_import.sql");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM products").get().count, 154);
    assert.equal(db.sqlite.prepare("SELECT SUM(on_hand_qty) AS qty FROM inventory_balances").get().qty, 618);
    assert.equal(db.sqlite.prepare("SELECT SUM(ordered_qty) AS qty FROM purchase_order_lines").get().qty, 488);
    assert.deepEqual(
      db.sqlite.prepare("SELECT code,name FROM locations ORDER BY code").all().map((row) => ({ ...row })),
      [
        { code: "MG-INSIDE", name: "Inside" },
        { code: "MG-OUTSIDE", name: "Outside" },
      ],
    );
  } finally {
    db.close();
  }
});
