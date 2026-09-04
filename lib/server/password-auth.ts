import { getRootD1 } from "./inventory-db";

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 310_000;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_FAILURE_LIMIT = 10;
const DUMMY_PASSWORD_HASH = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DUMMY_PASSWORD_SALT = "AAAAAAAAAAAAAAAAAAAAAA";

type SessionRole = "viewer" | "operator" | "accounting" | "manager" | "administrator";

export const SESSION_COOKIE = "paneflow_session";
export const TENANT_COOKIE = "paneflow_tenant";

export class PasswordAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "PasswordAuthError";
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function passwordDigest(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = Uint8Array.from(salt).buffer;
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function createPasswordCredential(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await passwordDigest(password, salt, PASSWORD_ITERATIONS);
  return { hash: base64Url(digest), salt: base64Url(salt), iterations: PASSWORD_ITERATIONS };
}

async function verifyPassword(password: string, encodedHash: string, encodedSalt: string, iterations: number) {
  let expected: Uint8Array;
  let actual: Uint8Array;
  try {
    expected = fromBase64Url(encodedHash);
    actual = await passwordDigest(password, fromBase64Url(encodedSalt), iterations);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  return difference === 0;
}

function cleanEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new PasswordAuthError("INVALID_EMAIL", "Enter a valid email address.");
  }
  return email;
}

export function organizationSlug(value: unknown) {
  const slug = String(value ?? "").trim().toLowerCase().normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-+|-+$/gu, "").slice(0, 56);
  if (slug.length < 2) throw new PasswordAuthError("INVALID_ORGANIZATION_ID", "Organization ID must contain at least two letters or numbers.");
  return slug;
}

function cleanPassword(value: unknown) {
  const password = String(value ?? "");
  if (password.length < 12 || password.length > 128) {
    throw new PasswordAuthError("INVALID_PASSWORD", "Password must be 12–128 characters.");
  }
  return password;
}

function cleanName(value: unknown, label: string) {
  const name = String(value ?? "").trim().replaceAll(/\s+/gu, " ");
  if (name.length < 2 || name.length > 100) throw new PasswordAuthError("INVALID_NAME", `${label} must be 2–100 characters.`);
  return name;
}

function randomToken(bytes = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

type SessionResult = {
  token: string;
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string; name: string; role: SessionRole };
};

async function createSession(user: SessionResult["user"], tenant: SessionResult["tenant"], now = new Date()) {
  const root = getRootD1();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  await root.batch([
    root.prepare("DELETE FROM app_sessions WHERE expires_at<=?").bind(createdAt),
    root.prepare("INSERT INTO app_sessions (id,token_hash,user_id,tenant_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)")
      .bind(`session-${crypto.randomUUID()}`, tokenHash, user.id, tenant.id, expiresAt, createdAt, createdAt),
  ]);
  return { token, user, tenant } satisfies SessionResult;
}

export async function registerOrganization(input: Record<string, unknown>) {
  const organizationName = cleanName(input.organizationName, "Organization name");
  const slug = organizationSlug(input.organizationSlug ?? organizationName);
  const fullName = cleanName(input.fullName, "Your name");
  const email = cleanEmail(input.email);
  const password = cleanPassword(input.password);
  const root = getRootD1();
  if (await root.prepare("SELECT 1 AS found FROM tenants WHERE slug=? LIMIT 1").bind(slug).first()) {
    throw new PasswordAuthError("ORGANIZATION_ID_TAKEN", "That organization ID is already in use.", 409);
  }
  if (await root.prepare("SELECT 1 AS found FROM app_users WHERE email=? LIMIT 1").bind(email).first()) {
    throw new PasswordAuthError("ACCOUNT_EXISTS", "An account already exists for this email. Sign in, then create another organization from the organization menu.", 409);
  }

  const credential = await createPasswordCredential(password);
  const userId = `user-${crypto.randomUUID()}`;
  const tenantId = `tenant-${crypto.randomUUID()}`;
  const warehouseId = `warehouse-${crypto.randomUUID()}`;
  const uomId = `uom-${crypto.randomUUID()}`;
  const now = new Date();
  const timestamp = now.toISOString();
  try {
    await root.batch([
      root.prepare("INSERT INTO app_users (user_id,email,full_name,role,active,version,created_at,updated_at) VALUES (?,?,?,'administrator',1,1,?,?)")
        .bind(userId, email, fullName, timestamp, timestamp),
      root.prepare("INSERT INTO app_password_credentials (user_id,password_hash,password_salt,password_iterations,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .bind(userId, credential.hash, credential.salt, credential.iterations, timestamp, timestamp),
      root.prepare("INSERT INTO tenants (id,slug,name,status,created_by,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)")
        .bind(tenantId, slug, organizationName, userId, timestamp, timestamp),
      root.prepare("INSERT INTO tenant_memberships (tenant_id,user_id,role,active,is_default,version,created_at,updated_at) VALUES (?,?,'administrator',1,1,1,?,?)")
        .bind(tenantId, userId, timestamp, timestamp),
      root.prepare("INSERT INTO warehouses (tenant_id,id,code,name,timezone,active,version) VALUES (?,?,'MAIN','Main warehouse','America/Edmonton',1,1)")
        .bind(tenantId, warehouseId),
      root.prepare("INSERT INTO units_of_measure (tenant_id,id,code,name,dimension,precision,active) VALUES (?,?,'EA','Each','quantity',0,1)")
        .bind(tenantId, uomId),
      root.prepare("INSERT INTO system_settings (tenant_id,key,value_json,description,version,updated_by,updated_at) VALUES (?,'security.defaultRole','\"viewer\"','Least-privilege role for new members.',1,?,?)")
        .bind(tenantId, fullName, timestamp),
      root.prepare("INSERT INTO system_settings (tenant_id,key,value_json,description,version,updated_by,updated_at) VALUES (?,'inventory.negativeAllowed','false','Negative on-hand inventory is blocked by default.',1,?,?)")
        .bind(tenantId, fullName, timestamp),
      root.prepare("INSERT INTO system_settings (tenant_id,key,value_json,description,version,updated_by,updated_at) VALUES (?,'valuation.defaultMethod','\"fifo\"','Default inventory valuation method.',1,?,?)")
        .bind(tenantId, fullName, timestamp),
      root.prepare(`INSERT INTO audit_events (tenant_id,id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        VALUES (?,?,'tenant',?,'tenant_created',?,?,?,?,?,?)`)
        .bind(tenantId, `audit-${crypto.randomUUID()}`, tenantId, `${organizationName} organization created.`, `${fullName} <${email}>`, userId, email, JSON.stringify({ slug, source: "public_registration" }), timestamp),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("tenants.slug")) throw new PasswordAuthError("ORGANIZATION_ID_TAKEN", "That organization ID is already in use.", 409);
    if (message.includes("app_users.email")) throw new PasswordAuthError("ACCOUNT_EXISTS", "An account already exists for this email.", 409);
    throw error;
  }
  return createSession({ id: userId, email, name: fullName }, { id: tenantId, slug, name: organizationName, role: "administrator" }, now);
}

type LoginRow = {
  userId: string;
  email: string;
  fullName: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: SessionRole;
};

async function attemptKey(slug: string, email: string, clientKey: string) {
  return sha256(`${slug}\u0000${email}\u0000${clientKey}`);
}

async function recordLoginFailure(key: string, now: Date) {
  const root = getRootD1();
  const timestamp = now.toISOString();
  const current = await root.prepare("SELECT failure_count AS failureCount,window_started_at AS windowStartedAt FROM auth_login_attempts WHERE attempt_key=?")
    .bind(key).first<{ failureCount: number; windowStartedAt: string }>();
  const inWindow = current && new Date(current.windowStartedAt).getTime() > now.getTime() - LOGIN_WINDOW_MS;
  const failures = inWindow ? Number(current.failureCount) + 1 : 1;
  const windowStartedAt = inWindow ? current.windowStartedAt : timestamp;
  const lockedUntil = failures >= LOGIN_FAILURE_LIMIT ? new Date(now.getTime() + LOGIN_WINDOW_MS).toISOString() : null;
  await root.prepare(`INSERT INTO auth_login_attempts (attempt_key,failure_count,window_started_at,locked_until,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(attempt_key) DO UPDATE SET failure_count=excluded.failure_count,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until,updated_at=excluded.updated_at`)
    .bind(key, failures, windowStartedAt, lockedUntil, timestamp).run();
}

export async function loginToOrganization(input: Record<string, unknown>, clientKey = "unknown") {
  const slug = organizationSlug(input.organizationSlug);
  const email = cleanEmail(input.email);
  const password = cleanPassword(input.password);
  const root = getRootD1();
  const now = new Date();
  const key = await attemptKey(slug, email, clientKey);
  const attempt = await root.prepare("SELECT locked_until AS lockedUntil FROM auth_login_attempts WHERE attempt_key=?").bind(key).first<{ lockedUntil: string | null }>();
  if (attempt?.lockedUntil && new Date(attempt.lockedUntil).getTime() > now.getTime()) {
    throw new PasswordAuthError("LOGIN_THROTTLED", "Too many sign-in attempts. Wait 15 minutes and try again.", 429);
  }

  const row = await root.prepare(`SELECT u.user_id AS userId,u.email,u.full_name AS fullName,
    c.password_hash AS passwordHash,c.password_salt AS passwordSalt,c.password_iterations AS passwordIterations,
    t.id AS tenantId,t.slug AS tenantSlug,t.name AS tenantName,tm.role
    FROM tenants t
    JOIN tenant_memberships tm ON tm.tenant_id=t.id AND tm.active=1
    JOIN app_users u ON u.user_id=tm.user_id AND u.active=1
    JOIN app_password_credentials c ON c.user_id=u.user_id
    WHERE t.slug=? AND t.status='active' AND u.email=? LIMIT 1`).bind(slug, email).first<LoginRow>();
  const valid = await verifyPassword(
    password,
    row?.passwordHash ?? DUMMY_PASSWORD_HASH,
    row?.passwordSalt ?? DUMMY_PASSWORD_SALT,
    Number(row?.passwordIterations ?? PASSWORD_ITERATIONS),
  );
  if (!row || !valid) {
    await recordLoginFailure(key, now);
    throw new PasswordAuthError("INVALID_LOGIN", "Organization, email, or password is incorrect.", 401);
  }
  await root.batch([
    root.prepare("DELETE FROM auth_login_attempts WHERE attempt_key=?").bind(key),
    root.prepare("UPDATE app_password_credentials SET last_login_at=?,updated_at=? WHERE user_id=?").bind(now.toISOString(), now.toISOString(), row.userId),
    root.prepare("UPDATE tenant_memberships SET is_default=CASE WHEN tenant_id=? THEN 1 ELSE 0 END,updated_at=? WHERE user_id=?").bind(row.tenantId, now.toISOString(), row.userId),
  ]);
  return createSession(
    { id: row.userId, email: row.email, name: row.fullName },
    { id: row.tenantId, slug: row.tenantSlug, name: row.tenantName, role: row.role },
    now,
  );
}

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) try { return decodeURIComponent(value.join("=")); } catch { return ""; }
  }
  return "";
}

export async function revokeRequestSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await getRootD1().prepare("DELETE FROM app_sessions WHERE token_hash=?").bind(await sha256(token)).run();
}

function secureCookie(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return (forwarded || new URL(request.url).protocol.replace(":", "")) === "https" ? "; Secure" : "";
}

export function sessionCookieHeaders(request: Request, session: SessionResult) {
  const secure = secureCookie(request);
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
  headers.append("Set-Cookie", `${TENANT_COOKIE}=${encodeURIComponent(session.tenant.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
  return headers;
}

export function clearedSessionCookieHeaders(request: Request) {
  const secure = secureCookie(request);
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  headers.append("Set-Cookie", `${TENANT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  return headers;
}

export function authClientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || "unknown";
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new PasswordAuthError("INVALID_ORIGIN", "Cross-site authentication requests are not allowed.", 403);
}
