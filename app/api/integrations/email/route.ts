import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { disconnectEmail, EmailConfigurationError, EmailProviderError, getEmailConnectionState, listRecentEmailDeliveries } from "@/lib/server/email-client";

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return authorizationResponse(error);
  if (error instanceof EmailConfigurationError || error instanceof EmailProviderError) {
    return Response.json({ error: { code: error.code, message: error.message, detail: "detail" in error ? error.detail : undefined } }, { status: error.status });
  }
  return Response.json({ error: { code: "EMAIL_REQUEST_FAILED", message: error instanceof Error ? error.message : "Email request failed." } }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "read");
    const state = await getEmailConnectionState(actor, request.url);
    const url = new URL(request.url);
    const includeDeliveries = url.searchParams.get("deliveries") === "1";
    return Response.json({ ...state, ...(includeDeliveries ? { deliveries: await listRecentEmailDeliveries(actor) } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "read");
    return Response.json(await disconnectEmail(actor));
  } catch (error) { return errorResponse(error); }
}

