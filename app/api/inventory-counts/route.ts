import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { PolicyError } from "@/lib/server/policy";
import {
  addCountLine,
  approveCountLine,
  asCountSessionError,
  cancelCountSession,
  createCountSession,
  getCountSessionWorkspace,
  postCountSession,
  refreshCountLine,
  reopenCountSession,
  requestCountLineApproval,
  saveCountLine,
  submitCountSession,
} from "@/lib/server/inventory-count-sessions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "read");
    const url = new URL(request.url);
    const result = await getCountSessionWorkspace({
      warehouseId: url.searchParams.get("warehouseId") ?? "",
      sessionId: url.searchParams.get("sessionId") ?? undefined,
      productSearch: url.searchParams.has("productSearch") ? url.searchParams.get("productSearch") ?? "" : undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof PolicyError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    const known = asCountSessionError(error);
    if (known) return Response.json({ error: { code: known.code, message: known.message, currentVersion: known.currentVersion } }, { status: known.status });
    return Response.json({ error: { code: "COUNT_SESSION_FAILED", message: error instanceof Error ? error.message : "Unable to load inventory counts." } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "").trim();
    requireCapability(actor, action === "approveLine" ? "approve" : "operationalWrite");
    const handlers: Record<string, () => Promise<unknown>> = {
      createSession: () => createCountSession(actor, payload),
      addLine: () => addCountLine(actor, payload),
      saveLine: () => saveCountLine(actor, payload),
      refreshLine: () => refreshCountLine(actor, payload),
      submitSession: () => submitCountSession(actor, payload),
      reopenSession: () => reopenCountSession(actor, payload),
      requestLineApproval: () => requestCountLineApproval(actor, payload),
      approveLine: () => approveCountLine(actor, payload),
      postSession: () => postCountSession(actor, payload),
      cancelSession: () => cancelCountSession(actor, payload),
    };
    const handler = handlers[action];
    if (!handler) return Response.json({ error: { code: "UNKNOWN_ACTION", message: `Unsupported count action: ${action || "(missing)"}.` } }, { status: 400 });
    return Response.json(await handler(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof PolicyError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    const known = asCountSessionError(error);
    if (known) return Response.json({ error: { code: known.code, message: known.message, currentVersion: known.currentVersion } }, { status: known.status });
    return Response.json({ error: { code: "COUNT_SESSION_FAILED", message: error instanceof Error ? error.message : "Unable to update inventory count." } }, { status: 500 });
  }
}
