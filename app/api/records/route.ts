import { createOrderRecord, RecordValidationError, type CreateOrderInput } from "@/lib/server/inventory-records";
import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { processOutboxBatch } from "@/lib/server/outbox";

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
    payload.appOrigin = new URL(request.url).origin;
    const result = await createOrderRecord(payload);
    try { await processOutboxBatch({ limit: 10 }); } catch { /* The durable event remains available for scheduled retry. */ }
    return Response.json(result, {
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
