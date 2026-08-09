import { getInventorySnapshot, searchInventoryRecords } from "@/lib/server/inventory-domain";
import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor=await resolveActor(request);requireCapability(actor,"read");
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query) {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return Response.json(await searchInventoryRecords(query, limit), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const snapshot = await getInventorySnapshot({
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 50),
    });
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if(error instanceof AuthorizationError)return authorizationResponse(error);
    const message = error instanceof Error ? error.message : "Unable to load inventory.";
    return Response.json({ error: { code: "SNAPSHOT_FAILED", message } }, { status: 500 });
  }
}
