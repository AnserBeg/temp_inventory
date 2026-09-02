import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { DocumentEmailError, getDocumentPdf, isEmailDocumentType } from "@/lib/server/document-email";

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return authorizationResponse(error);
  if (error instanceof DocumentEmailError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return Response.json({ error: { code: "DOCUMENT_PDF_FAILED", message: error instanceof Error ? error.message : "Document PDF failed." } }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "read");
    const url = new URL(request.url);
    const documentType = url.searchParams.get("documentType") ?? "";
    const documentId = url.searchParams.get("documentId")?.trim() ?? "";
    if (!isEmailDocumentType(documentType) || !documentId) {
      return Response.json({ error: { code: "INVALID_DOCUMENT", message: "A supported documentType and documentId are required." } }, { status: 400 });
    }
    const pdf = await getDocumentPdf(documentType, documentId);
    return new Response(pdf.body, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.fileName}"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) { return errorResponse(error); }
}
