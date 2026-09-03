import { authorizationResponse, AuthorizationError, resolveActor } from "@/lib/server/auth";
import { getRootD1 } from "@/lib/server/inventory-db";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const input = await request.json() as Record<string, unknown>;
    const tenantId = String(input.tenantId ?? "").trim();
    if (!actor.tenants.some((tenant) => tenant.id === tenantId)) throw new AuthorizationError("You do not have access to that organization.");
    const now = new Date().toISOString();
    await getRootD1().batch([
      getRootD1().prepare("UPDATE tenant_memberships SET is_default=0,updated_at=? WHERE user_id=?").bind(now, actor.id),
      getRootD1().prepare("UPDATE tenant_memberships SET is_default=1,updated_at=? WHERE tenant_id=? AND user_id=? AND active=1").bind(now, tenantId, actor.id),
    ]);
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return Response.json({ message: "Organization switched.", tenantId }, {
      headers: { "Cache-Control": "no-store", "Set-Cookie": `paneflow_tenant=${encodeURIComponent(tenantId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}` },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    throw error;
  }
}
