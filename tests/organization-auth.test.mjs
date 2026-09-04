import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { env } from "cloudflare:workers";
import { loginToOrganization, PasswordAuthError, registerOrganization, sessionCookieHeaders } from "../lib/server/password-auth.ts";
import { applyRenderMigrations, fileUrlForPath, openRenderDatabase } from "../scripts/render-runtime.mjs";

async function testDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "paneflow-auth-"));
  const opened = await openRenderDatabase({ databaseUrl: fileUrlForPath(join(directory, "auth.sqlite")) });
  await applyRenderMigrations(opened.database, { migrationDirectory: new URL("../drizzle/", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)) });
  env.DB = opened.database;
  return { ...opened, directory };
}

test("organization registration creates isolated administrators and hashed sessions", async () => {
  const { database, directory } = await testDatabase();
  try {
    const north = await registerOrganization({
      organizationName: "North Glass",
      organizationSlug: "north-glass",
      fullName: "Nora North",
      email: "nora@example.test",
      password: "north-password-2026",
    });
    const south = await registerOrganization({
      organizationName: "South Glass",
      organizationSlug: "south-glass",
      fullName: "Sam South",
      email: "sam@example.test",
      password: "south-password-2026",
    });

    assert.notEqual(north.tenant.id, south.tenant.id);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM tenants WHERE slug IN ('north-glass','south-glass')").get().count, 2);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM tenant_memberships WHERE role='administrator' AND tenant_id IN (?,?)").get(north.tenant.id, south.tenant.id).count, 2);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM warehouses WHERE tenant_id IN (?,?)").get(north.tenant.id, south.tenant.id).count, 2);

    const credential = database.sqlite.prepare("SELECT password_hash AS passwordHash,password_salt AS passwordSalt FROM app_password_credentials WHERE user_id=?").get(north.user.id);
    assert.notEqual(credential.passwordHash, "north-password-2026");
    assert.ok(credential.passwordSalt.length >= 20);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM app_sessions WHERE token_hash=?").get(north.token).count, 0, "raw session tokens must never be stored");

    const signedIn = await loginToOrganization({ organizationSlug: "north-glass", email: "nora@example.test", password: "north-password-2026" }, "127.0.0.1");
    assert.equal(signedIn.tenant.id, north.tenant.id);
    await assert.rejects(
      loginToOrganization({ organizationSlug: "south-glass", email: "nora@example.test", password: "north-password-2026" }, "127.0.0.1"),
      (error) => error instanceof PasswordAuthError && error.code === "INVALID_LOGIN" && error.status === 401,
    );

    const headers = sessionCookieHeaders(new Request("https://inventory.example.test/api/auth/login"), signedIn);
    const cookies = headers.getSetCookie().join("\n");
    assert.match(cookies, /paneflow_session=/);
    assert.match(cookies, /HttpOnly/);
    assert.match(cookies, /SameSite=Lax/);
    assert.match(cookies, /Secure/);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a disabled organization membership cannot create a new session", async () => {
  const { database, directory } = await testDatabase();
  try {
    const session = await registerOrganization({
      organizationName: "Closed Glass",
      organizationSlug: "closed-glass",
      fullName: "Casey Closed",
      email: "casey@example.test",
      password: "closed-password-2026",
    });
    database.sqlite.prepare("UPDATE tenant_memberships SET active=0 WHERE tenant_id=? AND user_id=?").run(session.tenant.id, session.user.id);
    await assert.rejects(
      loginToOrganization({ organizationSlug: "closed-glass", email: "casey@example.test", password: "closed-password-2026" }, "127.0.0.1"),
      (error) => error instanceof PasswordAuthError && error.code === "INVALID_LOGIN",
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
