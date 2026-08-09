import { DomainError, executeInventoryCommand, getInventorySnapshot, type InventoryCommand } from "@/lib/server/inventory-domain";
import { actorPayload, authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as InventoryCommand;
    const actor = await resolveActor(request);
    const normalized = input.command?.toLowerCase().replaceAll(/[_\s-]/g, "") ?? "";
    if (["priceonlycredit", "vendorpriceallowance"].includes(normalized)) requireCapability(actor, "financialWrite");
    else requireCapability(actor, "operationalWrite");
    input.payload = { ...(input.payload ?? {}), ...actorPayload(actor) };
    const result = await executeInventoryCommand(input);
    const snapshot = await getInventorySnapshot();
    return Response.json({ ...result, snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof DomainError) {
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
            currentVersion: error.currentVersion,
          },
        },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : "Unable to execute inventory command.";
    return Response.json({ error: { code: "COMMAND_FAILED", message } }, { status: 500 });
  }
}
