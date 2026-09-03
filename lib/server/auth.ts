import { env } from "cloudflare:workers";
import { ensureDatabase, getD1, getRootD1, newId } from "./inventory-db";
import { DEFAULT_TENANT_ID } from "./tenancy";

export type AppRole = "viewer" | "operator" | "accounting" | "manager" | "administrator";
export type TenantMembership = { id: string; slug: string; name: string; role: AppRole; isDefault: boolean };
export type ActorIdentity = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  label: string;
  localDevelopment: boolean;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenants: TenantMembership[];
};

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

function decodeName(request: Request) {
  const value = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  if (!value || encoding !== "percent-encoded-utf-8") return "Authenticated user";
  try { return decodeURIComponent(value); } catch { return value; }
}

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function requestedTenant(request: Request) {
  return request.headers.get("x-paneflow-tenant-id")?.trim() || cookieValue(request, "paneflow_tenant").trim();
}

type MembershipRow = { id: string; slug: string; name: string; role: AppRole; isDefault: number };

async function membershipsFor(userId: string): Promise<TenantMembership[]> {
  const result = await getRootD1().prepare(`SELECT t.id,t.slug,t.name,tm.role,tm.is_default AS isDefault
    FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id
    WHERE tm.user_id=? AND tm.active=1 AND t.status='active'
    ORDER BY tm.is_default DESC,t.name,t.id`).bind(userId).all<MembershipRow>();
  return (result.results ?? []).map((row) => ({ ...row, isDefault: Boolean(row.isDefault) }));
}

async function ensureTenantRegistry() {
  const now = new Date().toISOString();
  await getRootD1().prepare(`INSERT OR IGNORE INTO tenants (id,slug,name,status,created_by,created_at,updated_at)
    VALUES (?,'default','PaneFlow','active','System',?,?)`).bind(DEFAULT_TENANT_ID, now, now).run();
}

async function provisionMembership(userId: string, role: AppRole) {
  const db = getRootD1();
  const now = new Date().toISOString();
  const bootstrap = await db.prepare(`INSERT OR IGNORE INTO tenant_memberships
    (tenant_id,user_id,role,active,is_default,version,created_at,updated_at)
    SELECT ?,?,'administrator',1,1,1,?,? WHERE NOT EXISTS (SELECT 1 FROM tenant_memberships)`)
    .bind(DEFAULT_TENANT_ID, userId, now, now).run();
  const firstAdministrator = Number(bootstrap.meta?.changes ?? 0) > 0;
  if ((await membershipsFor(userId)).length) return firstAdministrator;
  await db.prepare(`INSERT INTO tenant_memberships (tenant_id,user_id,role,active,is_default,version,created_at,updated_at)
    VALUES (?,?,?,1,1,1,?,?)`).bind(DEFAULT_TENANT_ID, userId, role, now, now).run();
  return false;
}

export function localDevelopmentAuthEnabled() {
  return String(env.ALLOW_LOCAL_DEV_AUTH ?? "").trim().toLowerCase() === "true";
}

export async function resolveActor(request: Request): Promise<ActorIdentity> {
  await ensureDatabase();
  await ensureTenantRegistry();
  let id = request.headers.get("oai-authenticated-user-id")?.trim() ?? "";
  let email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
  let name = decodeName(request);
  let localDevelopment = false;
  if (!id || !email) {
    if (!localDevelopmentAuthEnabled()) throw new AuthorizationError("Authenticated user headers are required.");
    id = "local-dev";
    email = "local@paneflow.dev";
    name = "Local developer";
    localDevelopment = true;
  }

  const root = getRootD1();
  let registrationRole: AppRole = "viewer";
  try {
    const configured = await root.prepare("SELECT value_json AS valueJson FROM system_settings WHERE tenant_id=? AND key='security.defaultRole'").bind(DEFAULT_TENANT_ID).first<{ valueJson: string }>();
    const value = JSON.parse(configured?.valueJson ?? '"viewer"');
    if (["viewer", "operator", "accounting"].includes(value)) registrationRole = value as AppRole;
  } catch { /* least privilege */ }
  const mapped = await root.prepare("SELECT full_name AS fullName,email,active FROM app_users WHERE user_id=? LIMIT 1").bind(id)
    .first<{ fullName: string; email: string; active: number }>();
  if (mapped && !mapped.active) throw new AuthorizationError("Your PaneFlow account is disabled.");
  if (mapped) {
    if (mapped.email.toLowerCase() !== email) throw new AuthorizationError("This identity no longer matches its registered email address.");
    name = mapped.fullName || name;
  } else {
    const emailOwner = await root.prepare("SELECT user_id AS userId FROM app_users WHERE email=? LIMIT 1").bind(email).first<{ userId: string }>();
    if (emailOwner && emailOwner.userId !== id) throw new AuthorizationError("This email is already mapped to another identity. An administrator must update the user mapping.");
    const now = new Date().toISOString();
    await root.prepare(`INSERT INTO app_users (user_id,email,full_name,role,active,version,created_at,updated_at)
      VALUES (?,?,?,?,1,1,?,?)`).bind(id, email, name, registrationRole, now, now).run();
  }

  let memberships = await membershipsFor(id);
  let firstAdministrator = false;
  if (!memberships.length) {
    firstAdministrator = await provisionMembership(id, registrationRole);
    memberships = await membershipsFor(id);
  }
  const requested = requestedTenant(request);
  const selected = requested ? memberships.find((membership) => membership.id === requested) : memberships.find((membership) => membership.isDefault) ?? memberships[0];
  if (!selected) throw new AuthorizationError(requested ? "You do not have access to the selected organization." : "You do not belong to an active organization.");

  if (!mapped) {
    const now = new Date().toISOString();
    const db = getD1();
    await db.batch([
      db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        VALUES (?,'app_user',?,?,?,?,?,?,?,?)`)
        .bind(newId("audit-auth"), id,
          firstAdministrator ? "first_administrator_bootstrapped" : "authenticated_user_registered",
          firstAdministrator ? "First authenticated user assigned administrator for private-site setup." : `Authenticated identity registered with ${selected.role} access.`,
          `${name} <${email}>`, id, email, JSON.stringify({ role: selected.role }), now),
      db.prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
        VALUES (?,?,'app_user',?,?,'pending',0,?,?)`)
        .bind(newId("outbox-auth"), firstAdministrator ? "security.first_administrator_bootstrapped" : "security.authenticated_user_registered",
          id, JSON.stringify({ userId: id, email, role: selected.role }), now, now),
    ]);
  }
  return {
    id, email, name, role: selected.role, label: `${name} <${email}>`, localDevelopment,
    tenantId: selected.id, tenantSlug: selected.slug, tenantName: selected.name, tenants: memberships,
  };
}

export const capabilityRoles = {
  read: ["viewer", "operator", "accounting", "manager", "administrator"],
  export: ["viewer", "operator", "accounting", "manager", "administrator"],
  operationalWrite: ["operator", "manager", "administrator"],
  financialWrite: ["accounting", "manager", "administrator"],
  approve: ["manager", "administrator"],
  administer: ["administrator"],
} satisfies Record<string, AppRole[]>;

export type AppCapability = keyof typeof capabilityRoles;
export function hasCapability(actor: ActorIdentity, capability: AppCapability) { return (capabilityRoles[capability] as readonly AppRole[]).includes(actor.role); }
export function requireCapability(actor: ActorIdentity, capability: AppCapability) {
  if (!hasCapability(actor, capability)) throw new AuthorizationError(`Role ${actor.role} cannot perform this ${capability.replace("Write", " write")} action.`);
}
export function actorPayload(actor: ActorIdentity) { return { actor: actor.label, actorId: actor.id, actorEmail: actor.email, tenantId: actor.tenantId }; }
export function authorizationResponse(error: AuthorizationError) { return Response.json({ error: { code: "FORBIDDEN", message: error.message } }, { status: 403 }); }
