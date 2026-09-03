import { authorizationResponse, AuthorizationError, requireCapability, resolveActor, type AppRole } from "@/lib/server/auth";
import { getRootD1, newId } from "@/lib/server/inventory-db";

const validRoles = new Set<AppRole>(["viewer", "operator", "accounting", "manager", "administrator"]);

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const result = await getRootD1().prepare(`SELECT u.user_id AS userId,u.email,u.full_name AS fullName,tm.role,tm.active,tm.version
      FROM tenant_memberships tm JOIN app_users u ON u.user_id=tm.user_id WHERE tm.tenant_id=? ORDER BY u.full_name,u.email`)
      .bind(actor.tenantId).all();
    return Response.json({ members: result.results ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { if (error instanceof AuthorizationError) return authorizationResponse(error); throw error; }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "administer");
    const input = await request.json() as Record<string, unknown>;
    const email = String(input.email ?? "").trim().toLowerCase();
    const role = String(input.role ?? "viewer") as AppRole;
    if (!email || !validRoles.has(role)) return Response.json({ error: { code: "INVALID_MEMBER", message: "A registered email and valid role are required." } }, { status: 400 });
    const root = getRootD1();
    const user = await root.prepare("SELECT user_id AS userId FROM app_users WHERE email=? AND active=1").bind(email).first<{ userId: string }>();
    if (!user) return Response.json({ error: { code: "USER_NOT_REGISTERED", message: "That person must sign in once before they can be added." } }, { status: 404 });
    const now = new Date().toISOString();
    await root.batch([
      root.prepare(`INSERT INTO tenant_memberships (tenant_id,user_id,role,active,is_default,version,created_at,updated_at)
        VALUES (?,?,?,1,0,1,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,active=1,version=tenant_memberships.version+1,updated_at=excluded.updated_at`)
        .bind(actor.tenantId, user.userId, role, now, now),
      root.prepare(`INSERT INTO audit_events (tenant_id,id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        VALUES (?,?,'tenant_membership',?,'tenant_member_added',?,?,?,?,?,?)`)
        .bind(actor.tenantId, newId("audit-member"), user.userId, `${email} added as ${role}.`, actor.label, actor.id, actor.email, JSON.stringify({ role }), now),
    ]);
    return Response.json({ message: `${email} added as ${role}.` }, { status: 201 });
  } catch (error) { if (error instanceof AuthorizationError) return authorizationResponse(error); throw error; }
}

export async function PATCH(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "administer");
    const input = await request.json() as Record<string, unknown>;
    const userId = String(input.userId ?? "").trim();
    const role = String(input.role ?? "viewer") as AppRole;
    const active = input.active !== false;
    if (!userId || !validRoles.has(role)) return Response.json({ error: { code: "INVALID_MEMBER", message: "A member and valid role are required." } }, { status: 400 });
    const root = getRootD1();
    const member = await root.prepare("SELECT role,active,version FROM tenant_memberships WHERE tenant_id=? AND user_id=?").bind(actor.tenantId, userId).first<{ role: AppRole; active: number; version: number }>();
    if (!member) return Response.json({ error: { code: "MEMBER_NOT_FOUND", message: "Member was not found." } }, { status: 404 });
    if (member.active && member.role === "administrator" && (!active || role !== "administrator")) {
      const admins = await root.prepare("SELECT COUNT(*) AS count FROM tenant_memberships WHERE tenant_id=? AND role='administrator' AND active=1").bind(actor.tenantId).first<{ count: number }>();
      if (Number(admins?.count ?? 0) <= 1) return Response.json({ error: { code: "LAST_ADMIN", message: "The last organization administrator cannot be removed." } }, { status: 409 });
    }
    const now = new Date().toISOString();
    const result = await root.batch([
      root.prepare("UPDATE tenant_memberships SET role=?,active=?,version=version+1,updated_at=? WHERE tenant_id=? AND user_id=? AND version=?")
        .bind(role, active ? 1 : 0, now, actor.tenantId, userId, member.version),
      root.prepare(`INSERT INTO audit_events (tenant_id,id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        SELECT ?,?,'tenant_membership',?,'tenant_member_updated',?,?,?,?,?,? WHERE EXISTS
          (SELECT 1 FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND version=?)`)
        .bind(actor.tenantId, newId("audit-member"), userId, `Member access changed to ${role} (${active ? "active" : "inactive"}).`, actor.label, actor.id, actor.email,
          JSON.stringify({ role, active }), now, actor.tenantId, userId, member.version + 1),
    ]);
    if (!Number(result[0].meta?.changes ?? 0)) return Response.json({ error: { code: "VERSION_CONFLICT", message: "Member access changed before this update. Refresh and try again." } }, { status: 409 });
    return Response.json({ message: "Member updated." });
  } catch (error) { if (error instanceof AuthorizationError) return authorizationResponse(error); throw error; }
}
