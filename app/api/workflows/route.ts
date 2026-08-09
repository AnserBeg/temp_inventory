import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { executeWorkflow, getWorkflowSnapshot, WorkflowError, type WorkflowCommand } from "@/lib/server/advanced-domain";

export const dynamic = "force-dynamic";

const normalized = (value: string) => value.toLowerCase().replaceAll(/[_\s-]/g, "");

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "read");
    return Response.json(await getWorkflowSnapshot(actor), { headers: { "Cache-Control": "no-store" } });
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
    const commandName = normalized(input.command ?? "");
    const financial = ["createvendorbill", "createvendorcredit", "createcustomerinvoice", "createcustomercredit", "voidcustomerinvoice", "recordpayment", "adddocumentcharge", "refundreturnabledeposit", "allocatelandedcost"];
    const masterData = ["createproduct","updateproduct","deactivateproduct","createbusinesspartner","updatebusinesspartner","deactivatebusinesspartner","createwarehouse","updatewarehouse","deactivatewarehouse","createlocation","updatelocation","deactivatelocation","createreturnableassettype","updatereturnableassettype","deactivatereturnableassettype"];
    const approvals = ["approvepurchaseorder", "rejectpurchaseorder", "approveapproval", "rejectapproval", "approvevendorbill", ...masterData];
    const administration = ["updatepolicy", "lockperiod", "unlockperiod", "setvaluationpolicy", "updateuserrole"];
    if (administration.includes(commandName)) requireCapability(actor, "administer");
    else if (approvals.includes(commandName)) requireCapability(actor, "approve");
    else if (financial.includes(commandName)) requireCapability(actor, "financialWrite");
    else requireCapability(actor, "operationalWrite");

    const result = await executeWorkflow({ ...input, actor });
    const snapshot = await getWorkflowSnapshot(actor);
    return Response.json({ ...result, snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof WorkflowError) {
      return Response.json({ error: { code: error.code, message: error.message, currentVersion: error.currentVersion } }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unable to execute workflow.";
    return Response.json({ error: { code: "WORKFLOW_FAILED", message } }, { status: 500 });
  }
}
