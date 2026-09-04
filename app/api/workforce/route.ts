import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { executeWorkforceCommand, getWorkforceSnapshot, WorkforceError } from "@/lib/server/workforce";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "read");
    return Response.json(await getWorkforceSnapshot(actor), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    const message = error instanceof Error ? error.message : "Unable to load work orders.";
    return Response.json({ error: { code: "WORKFORCE_SNAPSHOT_FAILED", message } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "operationalWrite");
    const input = await request.json() as Record<string, unknown>;
    return Response.json(await executeWorkforceCommand(actor, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof WorkforceError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    const message = error instanceof Error ? error.message : "Unable to update workforce records.";
    return Response.json({ error: { code: "WORKFORCE_COMMAND_FAILED", message } }, { status: 500 });
  }
}
