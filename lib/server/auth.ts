import { ensureDatabase, first, getD1 } from "./inventory-db";
import { env } from "cloudflare:workers";

export type AppRole = "viewer" | "operator" | "accounting" | "manager" | "administrator";
export type ActorIdentity = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  label: string;
  localDevelopment: boolean;
};

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
  }
}

function decodeName(request: Request) {
  const value = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  if (!value || encoding !== "percent-encoded-utf-8") return "Authenticated user";
  try { return decodeURIComponent(value); } catch { return value; }
}

export function localDevelopmentAuthEnabled() {
  return String(env.ALLOW_LOCAL_DEV_AUTH ?? "").trim().toLowerCase() === "true";
}

export async function resolveActor(request: Request): Promise<ActorIdentity> {
  await ensureDatabase();
  const id = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!id || !email) {
    if (!localDevelopmentAuthEnabled()) {
      throw new AuthorizationError("Authenticated user headers are required for hosted write operations.");
    }
    return {
      id: "local-dev",
      email: "local@paneflow.dev",
      name: "Local developer",
      role: "administrator",
      label: "Local developer <local@paneflow.dev>",
      localDevelopment: true,
    };
  }

  const mapped = await first<{ fullName: string; role: AppRole; active: number }>(
    "SELECT full_name AS fullName, role, active FROM app_users WHERE user_id = ? LIMIT 1",
    id
  );
  if (mapped && !mapped.active) throw new AuthorizationError("Your PaneFlow access is disabled.");
  const name = mapped?.fullName || decodeName(request);
  let role = mapped?.role ?? "viewer";
  if (!mapped) {
    const emailOwner = await first<{ userId: string }>("SELECT user_id AS userId FROM app_users WHERE email = ? LIMIT 1", email);
    if (emailOwner && emailOwner.userId !== id) {
      throw new AuthorizationError("This email is already mapped to another identity. An administrator must update the user mapping.");
    }
    const now = new Date().toISOString();
    const db = getD1();
    const bootstrapAuditId = `audit-auth-bootstrap-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO app_users (user_id,email,full_name,role,active,created_at,updated_at)
        SELECT ?,?,?,'administrator',1,?,? WHERE NOT EXISTS (SELECT 1 FROM app_users)`)
        .bind(id,email,name,now,now),
      db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        SELECT ?,'app_user',?,'first_administrator_bootstrapped','First authenticated user assigned administrator for private-site setup.',?,?,?,? ,?
        WHERE EXISTS (SELECT 1 FROM app_users WHERE user_id=? AND role='administrator')`)
        .bind(bootstrapAuditId,id,`${name} <${email}>`,id,email,JSON.stringify({policy:"one_time_empty_user_table_bootstrap"}),now,id),
      db.prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
        SELECT ?,'security.first_administrator_bootstrapped','app_user',?,?,'pending',0,?,?
        WHERE EXISTS (SELECT 1 FROM app_users WHERE user_id=? AND role='administrator')`)
        .bind(`outbox-auth-bootstrap-${crypto.randomUUID()}`,id,JSON.stringify({userId:id,email}),now,now,id),
      db.prepare(`INSERT OR IGNORE INTO app_users (user_id,email,full_name,role,active,created_at,updated_at)
        VALUES (?,?,?,'viewer',1,?,?)`).bind(id,email,name,now,now),
    ]);
    const created = await first<{ role: AppRole }>("SELECT role FROM app_users WHERE user_id=?",id);
    role=created?.role??"viewer";
  }
  return { id, email, name, role, label: `${name} <${email}>`, localDevelopment: false };
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

export function hasCapability(actor: ActorIdentity, capability: AppCapability) {
  return (capabilityRoles[capability] as readonly AppRole[]).includes(actor.role);
}

export function requireCapability(actor: ActorIdentity, capability: AppCapability) {
  if (!hasCapability(actor, capability)) {
    throw new AuthorizationError(`Role ${actor.role} cannot perform this ${capability.replace("Write", " write")} action.`);
  }
}

export function actorPayload(actor: ActorIdentity) {
  return { actor: actor.label, actorId: actor.id, actorEmail: actor.email };
}

export function authorizationResponse(error: AuthorizationError) {
  return Response.json({ error: { code: "FORBIDDEN", message: error.message } }, { status: 403 });
}
