import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { processOutboxBatch } from "@/lib/server/outbox";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const result = await processOutboxBatch({ limit: 50 });
    return Response.json({ ...result, message: result.configured ? `${result.processed} event(s) delivered; ${result.failed} failed and remain queued.` : `${result.processed} local cleanup event(s) processed; ${result.failed} failed. Configure OUTBOX_WEBHOOK_URL and OUTBOX_WEBHOOK_SECRET to deliver ordinary integration events.` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    return Response.json({ error: { code: "OUTBOX_DELIVERY_FAILED", message: error instanceof Error ? error.message : "Outbox delivery failed." } }, { status: 500 });
  }
}
