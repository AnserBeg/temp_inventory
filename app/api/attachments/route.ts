import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { AttachmentError, listAttachments, uploadAttachment } from "@/lib/server/attachments";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "read");
    const url = new URL(request.url); const documentType = url.searchParams.get("documentType") ?? ""; const documentId = url.searchParams.get("documentId") ?? "";
    return Response.json({ attachments: await listAttachments(documentType, documentId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { if (error instanceof AuthorizationError) return authorizationResponse(error); if (error instanceof AttachmentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status }); throw error; }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "operationalWrite");
    const attachment = await uploadAttachment(actor, await request.formData());
    return Response.json({ attachment, message: `${attachment.fileName} attached.` }, { status: 201 });
  } catch (error) { if (error instanceof AuthorizationError) return authorizationResponse(error); if (error instanceof AttachmentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status }); const message=error instanceof Error?error.message:"Upload failed.";return Response.json({error:{code:"UPLOAD_FAILED",message}},{status:500}); }
}
