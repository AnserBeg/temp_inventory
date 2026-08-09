import { getInventorySnapshot } from "@/lib/server/inventory-domain";
import { createOrderRecord, RecordValidationError, type CreateOrderInput } from "@/lib/server/inventory-records";
import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CreateOrderInput;
    const actor = await resolveActor(request);
    requireCapability(actor, "operationalWrite");
    payload.idempotencyKey ||= request.headers.get("idempotency-key") ?? "";
    payload.actor = actor.label;
    payload.actorId = actor.id;
    payload.actorEmail = actor.email;
    const result = await createOrderRecord(payload);
    const snapshot = await getInventorySnapshot();
    return Response.json({ ...result, snapshot }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof RecordValidationError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unable to create the order.";
    return Response.json({ error: { code: "RECORD_CREATE_FAILED", message } }, { status: 500 });
  }
}
