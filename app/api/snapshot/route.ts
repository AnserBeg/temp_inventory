import { getInventorySnapshot } from "@/lib/server/inventory-domain";
import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor=await resolveActor(request);requireCapability(actor,"read");
    const snapshot = await getInventorySnapshot();
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if(error instanceof AuthorizationError)return authorizationResponse(error);
    const message = error instanceof Error ? error.message : "Unable to load inventory.";
    return Response.json({ error: { code: "SNAPSHOT_FAILED", message } }, { status: 500 });
  }
}
