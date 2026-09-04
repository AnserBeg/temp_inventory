import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyRenderMigrations, databasePathFromUrl, fileUrlForPath, openRenderDatabase } from "../scripts/render-runtime.mjs";

test("Render startup applies the complete migration chain exactly once", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "paneflow-render-"));
  const filename = join(temporaryDirectory, "paneflow.sqlite");
  let database;
  try {
    ({ database } = await openRenderDatabase({ databaseUrl: fileUrlForPath(filename) }));
    const migrationDirectory = new URL("../drizzle/", import.meta.url);
    const migrationNames = (await readdir(migrationDirectory)).filter((name) => /^\d{4}.*\.sql$/u.test(name)).sort();

    const first = await applyRenderMigrations(database, { migrationDirectory: databasePathFromUrl(migrationDirectory.href) });
    const second = await applyRenderMigrations(database, { migrationDirectory: databasePathFromUrl(migrationDirectory.href) });

    assert.equal(first.applied, migrationNames.length);
    assert.equal(second.applied, 0);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM _paneflow_migrations").get().count, migrationNames.length);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sales_people").get().count, 0, "a fresh deployment must not seed placeholder salespeople");
    assert.ok(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_balances'").get());
    assert.ok(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_sessions'").get());
    assert.ok(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='app_sessions_active_membership_insert'").get());
    assert.ok(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='tenant_guard_sales_order_lines_bin_location_id_insert'").get());
    assert.equal(database.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    database?.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Render startup rejects a PostgreSQL URL instead of silently corrupting the SQLite contract", () => {
  assert.throws(() => databasePathFromUrl("postgresql://example.invalid/paneflow"), /SQLite\/D1 SQL/);
});

test("the Render Blueprint keeps migrations in startup where the persistent disk is mounted", async () => {
  const [blueprint, packageJson] = await Promise.all([
    readFile(new URL("../render.yaml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(blueprint, /mountPath: \/var\/data/);
  assert.match(blueprint, /startCommand: npm run start:render/);
  assert.doesNotMatch(blueprint, /preDeployCommand/);
  assert.doesNotMatch(blueprint, /APP_AUTH_/);
  assert.equal(JSON.parse(packageJson).scripts["start:render"].includes("start-render.mjs"), true);
});
