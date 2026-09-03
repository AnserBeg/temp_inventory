import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { D1SqliteDatabase } from "./d1-sqlite.mjs";
import { currentTenant, runWithTenant, scopeTenantSql, TENANT_OWNED_TABLES, tenantContextForRequest } from "../lib/server/tenancy.ts";

function tenantDb() {
  const db = new D1SqliteDatabase();
  db.exec(`CREATE TABLE products (tenant_id TEXT NOT NULL,id TEXT NOT NULL,sku TEXT NOT NULL,name TEXT,PRIMARY KEY(tenant_id,id));
    CREATE UNIQUE INDEX products_tenant_sku ON products(tenant_id,sku);
    CREATE TABLE audit_events (tenant_id TEXT NOT NULL,id TEXT NOT NULL,summary TEXT,PRIMARY KEY(tenant_id,id));`);
  return db;
}

async function execute(db, tenantId, sql, bindings = []) {
  return db.prepare(scopeTenantSql(sql, tenantId)).bind(...bindings).run();
}

test("tenant SQL boundary isolates reads and every mutation shape", async () => {
  const db = tenantDb();
  await execute(db, "tenant-a", "INSERT INTO products (id,sku,name) VALUES (?,?,COALESCE(?, 'fallback'))", ["same-id", "SKU-1", "Alpha"]);
  await execute(db, "tenant-b", "INSERT INTO products (id,sku,name) VALUES (?,?,?)", ["same-id", "SKU-1", "Beta"]);
  const a = await db.prepare(scopeTenantSql("SELECT id,sku,name FROM products ORDER BY id", "tenant-a")).all();
  const b = await db.prepare(scopeTenantSql("SELECT id,sku,name FROM products ORDER BY id", "tenant-b")).all();
  assert.deepEqual(a.results.map((row) => ({ ...row })), [{ id: "same-id", sku: "SKU-1", name: "Alpha" }]);
  assert.deepEqual(b.results.map((row) => ({ ...row })), [{ id: "same-id", sku: "SKU-1", name: "Beta" }]);

  await execute(db, "tenant-a", "UPDATE products SET name=? WHERE id=?", ["Alpha 2", "same-id"]);
  await execute(db, "tenant-b", "DELETE FROM products WHERE id=?", ["same-id"]);
  assert.equal((await db.prepare(scopeTenantSql("SELECT name FROM products WHERE id=?", "tenant-a")).bind("same-id").first()).name, "Alpha 2");
  assert.equal(await db.prepare(scopeTenantSql("SELECT name FROM products WHERE id=?", "tenant-b")).bind("same-id").first(), null);

  await execute(db, "tenant-a", "INSERT INTO audit_events (id,summary) SELECT id,name FROM products WHERE sku=?", ["SKU-1"]);
  assert.deepEqual((await db.prepare(scopeTenantSql("SELECT id,summary FROM audit_events", "tenant-a")).all()).results.map((row) => ({ ...row })), [{ id: "same-id", summary: "Alpha 2" }]);
  assert.throws(() => scopeTenantSql("INSERT INTO products VALUES (?,?,?,?)", "tenant-a"), /must name their columns/);
  db.close();
});

test("tenant async context does not bleed between concurrent requests", async () => {
  const values = await Promise.all([
    runWithTenant({ tenantId: "tenant-a" }, async () => { await Promise.resolve(); return currentTenant()?.tenantId; }),
    runWithTenant({ tenantId: "tenant-b" }, async () => { await Promise.resolve(); return currentTenant()?.tenantId; }),
  ]);
  assert.deepEqual(values, ["tenant-a", "tenant-b"]);
  assert.equal(currentTenant(), undefined);
});

test("the Worker tenant boundary accepts only an active membership", async () => {
  const db = new D1SqliteDatabase();
  db.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY,slug TEXT,name TEXT,status TEXT);
    CREATE TABLE tenant_memberships (tenant_id TEXT,user_id TEXT,active INTEGER);
    INSERT INTO tenants VALUES ('tenant-a','alpha','Alpha Co','active'),('tenant-b','beta','Beta Co','active');
    INSERT INTO tenant_memberships VALUES ('tenant-a','user-a',1),('tenant-b','user-b',1);`);
  const authorized = await tenantContextForRequest(new Request("https://example.test/api/snapshot", {
    headers: { "oai-authenticated-user-id": "user-a", cookie: "paneflow_tenant=tenant-a" },
  }), db);
  const rejected = await tenantContextForRequest(new Request("https://example.test/api/snapshot", {
    headers: { "oai-authenticated-user-id": "user-a", cookie: "paneflow_tenant=tenant-b" },
  }), db);
  assert.deepEqual(authorized, { tenantId: "tenant-a", tenantSlug: "alpha", tenantName: "Alpha Co" });
  assert.deepEqual(rejected, { tenantId: "tenant-default" });
  db.close();
});

test("migrated relationship guards reject cross-tenant parents", async () => {
  const db = new D1SqliteDatabase();
  const directory = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => /^\d{4}.*\.sql$/u.test(name)).sort()) {
    const sql = readFileSync(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
  }
  await db.prepare("INSERT INTO tenants (id,slug,name,status,created_by,created_at,updated_at) VALUES ('tenant-b','tenant-b','Tenant B','active','test','2026-09-03','2026-09-03')").run();
  await db.prepare("INSERT INTO business_partners (tenant_id,id,code,name,partner_type,currency,active,version,created_at) VALUES ('tenant-default','partner-a','SHARED-CODE','Partner A','customer','CAD',1,1,'2026-09-03'),('tenant-b','partner-b','SHARED-CODE','Partner B','customer','CAD',1,1,'2026-09-03')").run();
  await assert.rejects(
    db.prepare("INSERT INTO sales_orders (tenant_id,id,number,customer_id,total_cents,created_at) VALUES ('tenant-default','cross-order','SO-CROSS','partner-b',0,'2026-09-03')").run(),
    /CROSS_TENANT_REFERENCE/,
  );
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM business_partners WHERE code='SHARED-CODE'").get().count, 2);
  db.close();
});

test("schema and migration cover every company-owned table", () => {
  const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../drizzle/0030_cute_joshua_kane.sql", import.meta.url), "utf8");
  const integrityMigration = readFileSync(new URL("../drizzle/0031_tenant-integrity.sql", import.meta.url), "utf8");
  assert.match(schema, /export const tenants = sqliteTable/);
  assert.match(schema, /export const tenantMemberships = sqliteTable/);
  for (const table of TENANT_OWNED_TABLES) {
    if (table === "tenant_memberships") continue;
    const quoted = `\`${table}\``;
    const rebuilt = `\`__new_${table}\``;
    assert.match(migration, new RegExp(`(?:ALTER TABLE ${quoted} ADD \`tenant_id\`|CREATE TABLE ${rebuilt}[\\s\\S]*?\`tenant_id\`)`), `${table} must be tenantized`);
  }
  assert.match(migration, /INSERT OR IGNORE INTO `tenants`/);
  assert.match(migration, /FROM `app_users`/);
  assert.ok((integrityMigration.match(/CREATE TRIGGER/g) ?? []).length >= 250);
  assert.match(integrityMigration, /CROSS_TENANT_REFERENCE/);
});
