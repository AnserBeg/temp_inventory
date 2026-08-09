import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { executeWorkflow, getWorkflowSnapshot, workflowCapability, WorkflowError, type WorkflowCommand } from "@/lib/server/advanced-domain";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "read");
    const url = new URL(request.url);
    return Response.json(await getWorkflowSnapshot(actor, {
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 50),
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    const message = error instanceof Error ? error.message : "Unable to load workflows.";
    return Response.json({ error: { code: "WORKFLOW_SNAPSHOT_FAILED", message } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const input = (await request.json()) as Omit<WorkflowCommand, "actor">;
    const capability = workflowCapability(input.command ?? "");
    if (!capability) throw new WorkflowError("UNKNOWN_COMMAND", `Unsupported workflow command: ${input.command ?? ""}.`);
    requireCapability(actor, capability);

    const result = await executeWorkflow({ ...input, actor });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof WorkflowError) {
      return Response.json({ error: { code: error.code, message: error.message, currentVersion: error.currentVersion } }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unable to execute workflow.";
    return Response.json({ error: { code: "WORKFLOW_FAILED", message } }, { status: 500 });
  }
}
