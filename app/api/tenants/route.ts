import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { getRootD1, newId } from "@/lib/server/inventory-db";

function slug(value: string) {
  return value.toLowerCase().normalize("NFKD").replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 56);
}

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    return Response.json({ currentTenantId: actor.tenantId, tenants: actor.tenants }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const input = await request.json() as Record<string, unknown>;
    const name = String(input.name ?? "").trim();
    if (name.length < 2 || name.length > 100) return Response.json({ error: { code: "INVALID_TENANT_NAME", message: "Organization name must be 2–100 characters." } }, { status: 400 });
    const id = `tenant-${crypto.randomUUID()}`;
    const desiredSlug = slug(String(input.slug ?? name));
    if (!desiredSlug) return Response.json({ error: { code: "INVALID_TENANT_SLUG", message: "Organization slug must contain a letter or number." } }, { status: 400 });
    if (await getRootD1().prepare("SELECT 1 AS found FROM tenants WHERE slug=? LIMIT 1").bind(desiredSlug).first()) {
      return Response.json({ error: { code: "TENANT_SLUG_TAKEN", message: "That organization ID is already in use." } }, { status: 409 });
    }
    const now = new Date().toISOString();
    const root = getRootD1();
    const warehouseId = `warehouse-${id}-${crypto.randomUUID()}`;
    const uomId = `uom-${id}-${crypto.randomUUID()}`;
    const auditId = `audit-${id}-${crypto.randomUUID()}`;
    await root.batch([
      root.prepare("UPDATE tenant_memberships SET is_default=0,updated_at=? WHERE user_id=?").bind(now, actor.id),
      root.prepare("INSERT INTO tenants (id,slug,name,status,created_by,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)").bind(id, desiredSlug, name, actor.id, now, now),
      root.prepare("INSERT INTO tenant_memberships (tenant_id,user_id,role,active,is_default,version,created_at,updated_at) VALUES (?,?,'administrator',1,1,1,?,?)").bind(id, actor.id, now, now),
      root.prepare("INSERT INTO warehouses (tenant_id,id,code,name,timezone,active,version) VALUES (?,?,'MAIN','Main warehouse','America/Edmonton',1,1)").bind(id, warehouseId),
      root.prepare("INSERT INTO units_of_measure (tenant_id,id,code,name,dimension,precision,active) VALUES (?,?,'EA','Each','quantity',0,1)").bind(id, uomId),
      root.prepare("INSERT INTO system_settings (tenant_id,key,value_json,description,version,updated_by,updated_at) VALUES (?,'security.defaultRole','\"viewer\"','Least-privilege role for new members.',1,?,?)").bind(id, actor.label, now),
      root.prepare("INSERT INTO system_settings (tenant_id,key,value_json,description,version,updated_by,updated_at) VALUES (?,'inventory.negativeAllowed','false','Negative on-hand inventory is blocked by default.',1,?,?)").bind(id, actor.label, now),
      root.prepare("INSERT INTO system_settings (tenant_id,key,value_json,description,version,updated_by,updated_at) VALUES (?,'valuation.defaultMethod','\"fifo\"','Default inventory valuation method.',1,?,?)").bind(id, actor.label, now),
      root.prepare(`INSERT INTO audit_events (tenant_id,id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        VALUES (?,?, 'tenant',?,'tenant_created',?,?,?,?,?,?)`).bind(id, auditId, id, `${name} organization created.`, actor.label, actor.id, actor.email, JSON.stringify({ slug: desiredSlug }), now),
    ]);
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return Response.json({ tenant: { id, slug: desiredSlug, name, role: "administrator" }, message: `${name} created.` }, {
      status: 201,
      headers: { "Cache-Control": "no-store", "Set-Cookie": `paneflow_tenant=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}` },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    return Response.json({ error: { code: "TENANT_CREATE_FAILED", message: error instanceof Error ? error.message : "Unable to create organization." } }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const input = await request.json() as Record<string, unknown>;
    const name = String(input.name ?? "").trim();
    if (name.length < 2 || name.length > 100) return Response.json({ error: { code: "INVALID_TENANT_NAME", message: "Organization name must be 2–100 characters." } }, { status: 400 });
    const root = getRootD1();
    const now = new Date().toISOString();
    const result = await root.batch([
      root.prepare("UPDATE tenants SET name=?,updated_at=? WHERE id=? AND status='active'").bind(name, now, actor.tenantId),
      root.prepare(`INSERT INTO audit_events (tenant_id,id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
        VALUES (?,?, 'tenant',?,'tenant_renamed',?,?,?,?,?,?)`).bind(actor.tenantId, newId("audit-tenant"), actor.tenantId, `Organization renamed to ${name}.`, actor.label, actor.id, actor.email, JSON.stringify({ name }), now),
    ]);
    if (!Number(result[0].meta?.changes ?? 0)) return Response.json({ error: { code: "TENANT_NOT_FOUND", message: "Organization was not found." } }, { status: 404 });
    return Response.json({ message: "Organization updated.", tenant: { id: actor.tenantId, name } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    throw error;
  }
}
