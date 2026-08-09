import { ensureDatabase, first, getD1 } from "./inventory-db";

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

function decodeName(value: string | null) {
  if (!value) return "Authenticated user";
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function resolveActor(request: Request): Promise<ActorIdentity> {
  await ensureDatabase();
  const id = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!id || !email) {
    const hostname = new URL(request.url).hostname.toLowerCase();
    const isLocalDevelopment = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local");
    if (!isLocalDevelopment) {
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
    "SELECT full_name AS fullName, role, active FROM app_users WHERE user_id = ? OR email = ? LIMIT 1",
    id,
    email
  );
  if (mapped && !mapped.active) throw new AuthorizationError("Your PaneFlow access is disabled.");
  const name = mapped?.fullName || decodeName(request.headers.get("oai-authenticated-user-full-name"));
  let role = mapped?.role ?? "viewer";
  if (!mapped) {
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

const capabilityRoles: Record<string, AppRole[]> = {
  read: ["viewer", "operator", "accounting", "manager", "administrator"],
  export: ["viewer", "operator", "accounting", "manager", "administrator"],
  operationalWrite: ["operator", "manager", "administrator"],
  financialWrite: ["accounting", "manager", "administrator"],
  approve: ["manager", "administrator"],
  administer: ["administrator"],
};

export function requireCapability(actor: ActorIdentity, capability: keyof typeof capabilityRoles) {
  if (!capabilityRoles[capability].includes(actor.role)) {
    throw new AuthorizationError(`Role ${actor.role} cannot perform this ${capability.replace("Write", " write")} action.`);
  }
}

export function actorPayload(actor: ActorIdentity) {
  return { actor: actor.label, actorId: actor.id, actorEmail: actor.email };
}

export function authorizationResponse(error: AuthorizationError) {
  return Response.json({ error: { code: "FORBIDDEN", message: error.message } }, { status: 403 });
}
