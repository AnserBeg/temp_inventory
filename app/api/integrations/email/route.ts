import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { disconnectEmail, EmailConfigurationError, EmailProviderError, getEmailConnectionState, listRecentEmailDeliveries, setPurchaseOrderApprovalEmail, setPurchaseOrderApprovedEmails } from "@/lib/server/email-client";
import type { EmailSenderType } from "@/lib/server/email-types";

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
    const senderType = (new URL(request.url).searchParams.get("sender") ?? "personal") as EmailSenderType;
    if (!["company", "personal"].includes(senderType)) return Response.json({ error: { code: "INVALID_EMAIL_SENDER", message: "sender must be company or personal." } }, { status: 400 });
    return Response.json(await disconnectEmail(actor, senderType));
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "read");
    const input = await request.json() as { purchaseOrderApprovalEmail?: unknown; purchaseOrderApprovedEmails?: unknown };
    if (typeof input.purchaseOrderApprovedEmails === "string") {
      return Response.json(await setPurchaseOrderApprovedEmails(actor, input.purchaseOrderApprovedEmails));
    }
    if (typeof input.purchaseOrderApprovalEmail !== "string") {
      return Response.json({ error: { code: "INVALID_APPROVAL_EMAIL", message: "purchaseOrderApprovalEmail must be a string." } }, { status: 400 });
    }
    return Response.json(await setPurchaseOrderApprovalEmail(actor, input.purchaseOrderApprovalEmail));
  } catch (error) { return errorResponse(error); }
}
