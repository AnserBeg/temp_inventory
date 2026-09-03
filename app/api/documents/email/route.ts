import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { getDocumentEmailPreview, DocumentEmailError, emailDocumentCapability, isEmailDocumentType, sendDocumentEmail } from "@/lib/server/document-email";
import { EmailConfigurationError, EmailProviderError, getEmailConnectionState } from "@/lib/server/email-client";
import type { EmailSenderType } from "@/lib/server/email-types";

function responseFor(error: unknown) {
  if (error instanceof AuthorizationError) return authorizationResponse(error);
  if (error instanceof DocumentEmailError || error instanceof EmailConfigurationError || error instanceof EmailProviderError) {
    return Response.json({ error: { code: error.code, message: error.message, detail: "detail" in error ? error.detail : undefined } }, { status: error.status });
  }
  return Response.json({ error: { code: "DOCUMENT_EMAIL_FAILED", message: error instanceof Error ? error.message : "Document email failed." } }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    const url = new URL(request.url);
    const documentType = url.searchParams.get("documentType") ?? "";
    const documentId = url.searchParams.get("documentId")?.trim() ?? "";
    if (!isEmailDocumentType(documentType) || !documentId) return Response.json({ error: { code: "INVALID_DOCUMENT", message: "A supported documentType and documentId are required." } }, { status: 400 });
    requireCapability(actor, emailDocumentCapability(documentType));
    const [document, email] = await Promise.all([getDocumentEmailPreview(documentType, documentId), getEmailConnectionState(actor, request.url)]);
    return Response.json({ document, email }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseFor(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const input = await request.json() as Record<string, unknown>;
    const documentType = String(input.documentType ?? "");
    const documentId = String(input.documentId ?? "").trim();
    if (!isEmailDocumentType(documentType) || !documentId) return Response.json({ error: { code: "INVALID_DOCUMENT", message: "A supported documentType and documentId are required." } }, { status: 400 });
    const senderType = input.senderType === undefined ? undefined : String(input.senderType) as EmailSenderType;
    if (senderType && !(["company", "personal"] as string[]).includes(senderType)) return Response.json({ error: { code: "INVALID_EMAIL_SENDER", message: "senderType must be company or personal." } }, { status: 400 });
    requireCapability(actor, emailDocumentCapability(documentType));
    return Response.json(await sendDocumentEmail(actor, { documentType, documentId, recipients: input.recipients, subject: input.subject, message: input.message, senderType }, request.url));
  } catch (error) { return responseFor(error); }
}
