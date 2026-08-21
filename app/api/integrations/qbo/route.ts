import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { disconnectQbo, QboApiError, QboBusyError } from "@/lib/server/qbo-client";
import { getQboAdminState, saveQboAccountMappings, saveQboReferenceMappings } from "@/lib/server/qbo-admin";
import { QboMappingError } from "@/lib/server/qbo-transform";
import { processQboSyncBatch, reconcileQboConnection, retryQboDelivery } from "@/lib/server/qbo-sync";

function responseFor(error: unknown) {
  if (error instanceof AuthorizationError) return authorizationResponse(error);
  if (error instanceof QboApiError) return Response.json({ error: { code: error.code, message: error.message, detail: error.detail } }, { status: error.status });
  if (error instanceof QboBusyError) return Response.json({ error: { code: error.code, message: error.message } }, { status: 503 });
  if (error instanceof QboMappingError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code.endsWith("NOT_FOUND") ? 404 : 409 });
  return Response.json({ error: { code: "QBO_REQUEST_FAILED", message: error instanceof Error ? error.message : String(error) } }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const url = new URL(request.url);
    return Response.json(await getQboAdminState(request.url, {
      connectionId: url.searchParams.get("connectionId") ?? undefined,
      includeRemoteOptions: url.searchParams.get("refresh") === "1",
      deliveryStatus: url.searchParams.get("status") ?? undefined,
    }));
  } catch (error) { return responseFor(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const input = await request.json() as Record<string, unknown>;
    const action = String(input.action ?? "");
    const connectionId = String(input.connectionId ?? "");
    if (!connectionId && action !== "retry") throw new Error("connectionId is required.");
    if (action === "saveAccountMappings") {
      const mappings = Array.isArray(input.mappings) ? input.mappings as Array<Record<string, unknown>> : [];
      return Response.json(await saveQboAccountMappings(connectionId, mappings, actor));
    }
    if (action === "saveReferenceMappings") {
      const mappings = Array.isArray(input.mappings) ? input.mappings as Array<Record<string, unknown>> : [];
      return Response.json(await saveQboReferenceMappings(connectionId, mappings, actor));
    }
    if (action === "sync") return Response.json(await processQboSyncBatch({ connectionId, limit: Number(input.limit ?? 100) }));
    if (action === "retry") return Response.json(await retryQboDelivery(String(input.deliveryId ?? ""), actor));
    if (action === "reconcile") return Response.json(await reconcileQboConnection(connectionId, Number(input.limit ?? 100)));
    if (action === "disconnect") return Response.json(await disconnectQbo(connectionId, actor));
    return Response.json({ error: { code: "UNKNOWN_ACTION", message: "Unknown QuickBooks integration action." } }, { status: 400 });
  } catch (error) { return responseFor(error); }
}

