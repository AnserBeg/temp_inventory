import { getInventorySnapshot, getProductOperationalDetail, searchInventoryRecords, searchInventoryReferences } from "@/lib/server/inventory-domain";
import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor=await resolveActor(request);requireCapability(actor,"read");
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (url.searchParams.get("detail") === "product") {
      return Response.json(await getProductOperationalDetail(url.searchParams.get("productId") ?? "", Number(url.searchParams.get("page") ?? 1), Number(url.searchParams.get("pageSize") ?? 50)), { headers: { "Cache-Control": "no-store" } });
    }
    const lookup = url.searchParams.get("lookup");
    if (lookup === "products" || lookup === "partners" || lookup === "locations") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return Response.json(await searchInventoryReferences(
        lookup,
        query,
        limit,
        url.searchParams.get("role") ?? undefined,
        url.searchParams.get("partnerId") ?? undefined,
        Number(url.searchParams.get("quantity") ?? 1),
      ), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (query) {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return Response.json(await searchInventoryRecords(query, limit, Number(url.searchParams.get("pageSize") ?? 50)), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const snapshot = await getInventorySnapshot({
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 50),
      search: url.searchParams.get("worklistQuery") ?? "",
      scope: url.searchParams.get("scope") ?? "",
      status: url.searchParams.get("status") ?? "",
      sort: url.searchParams.get("sort") ?? "priority",
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
