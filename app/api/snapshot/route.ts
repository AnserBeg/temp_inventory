import { getInventorySnapshot, getProductOperationalDetail, isReferenceLookup, searchInventoryRecords, searchInventoryReferences } from "@/lib/server/inventory-domain";
import { authorizationResponse, AuthorizationError, hasCapability, requireCapability, resolveActor } from "@/lib/server/auth";

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
    if (lookup) {
      if (!isReferenceLookup(lookup)) return Response.json({ error: { code: "UNKNOWN_LOOKUP", message: `${lookup} is not a reference lookup.` } }, { status: 400 });
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return Response.json(await searchInventoryReferences(
        lookup,
        query,
        limit,
        url.searchParams.get("role") ?? undefined,
        url.searchParams.get("partnerId") ?? undefined,
        Number(url.searchParams.get("quantity") ?? 1),
        url.searchParams.get("warehouseId") ?? undefined,
        url.searchParams.get("currency") ?? undefined,
        url.searchParams.has("exchangeRateToBase") ? Number(url.searchParams.get("exchangeRateToBase")) : undefined,
        Number(url.searchParams.get("offset") ?? 0),
        url.searchParams.get("productId") ?? undefined,
        url.searchParams.get("lineId") ?? undefined,
        url.searchParams.get("locationId") ?? undefined,
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
      warehouseId: url.searchParams.get("warehouseId") ?? "",
    });
    // Every write is attributed to this actor, so the shell should be able to say who it is
    // and what they are allowed to do rather than showing a placeholder avatar.
    return Response.json({ ...snapshot, viewer: {
      name: actor.name,
      email: actor.email,
      role: actor.role,
      permissions: {
        canRead: hasCapability(actor, "read"),
        canExport: hasCapability(actor, "export"),
        canOperate: hasCapability(actor, "operationalWrite"),
        canPostFinancial: hasCapability(actor, "financialWrite"),
        canApprove: hasCapability(actor, "approve"),
        canAdminister: hasCapability(actor, "administer"),
      },
    } }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if(error instanceof AuthorizationError)return authorizationResponse(error);
    const message = error instanceof Error ? error.message : "Unable to load inventory.";
    return Response.json({ error: { code: "SNAPSHOT_FAILED", message } }, { status: 500 });
  }
}
