import { env } from "cloudflare:workers";
import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "read");
    return Response.json(
      { apiKey: String(env.GOOGLE_MAPS_API_KEY ?? "").trim() || null },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    return Response.json({ error: { code: "GOOGLE_MAPS_CONFIG_FAILED", message: "Google address suggestions are unavailable." } }, { status: 500 });
  }
}
