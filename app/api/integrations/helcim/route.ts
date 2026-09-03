import { AuthorizationError, authorizationResponse, requireCapability, resolveActor } from "@/lib/server/auth";
import {
  connectHelcimCompany,
  disconnectHelcimCompany,
  getHelcimAdminState,
  HelcimPaymentError,
  processHelcimIntegrationBatch,
  verifyHelcimCompanyConnection,
} from "@/lib/server/helcim-payments";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return authorizationResponse(error);
  if (error instanceof HelcimPaymentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return Response.json({ error: { code: "HELCIM_ADMIN_FAILED", message: error instanceof Error ? error.message : "Helcim integration request failed." } }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const state = await getHelcimAdminState();
    return Response.json({ ...state, webhookUrl: `${new URL(request.url).origin}/api/integrations/helcim/webhook` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    let result: unknown;
    if (input.action === "connect") result = await connectHelcimCompany(input, actor);
    else if (input.action === "verify") result = await verifyHelcimCompanyConnection();
    else if (input.action === "reconcile") result = await processHelcimIntegrationBatch(100);
    else return Response.json({ error: { code: "INVALID_ACTION", message: "action must be connect, verify, or reconcile." } }, { status: 400 });
    return Response.json({ result, ...(await getHelcimAdminState()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await disconnectHelcimCompany(actor, input.acknowledgeActiveLinks === true);
    return Response.json({ result, ...(await getHelcimAdminState()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
