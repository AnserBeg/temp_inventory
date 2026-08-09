import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { AttachmentError, deleteAttachment, downloadAttachment } from "@/lib/server/attachments";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const actor=await resolveActor(request);requireCapability(actor,"read");return downloadAttachment((await context.params).id); }
  catch(error){if(error instanceof AuthorizationError)return authorizationResponse(error);if(error instanceof AttachmentError)return Response.json({error:{code:error.code,message:error.message}},{status:error.status});throw error;}
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const actor=await resolveActor(request);requireCapability(actor,"operationalWrite");await deleteAttachment(actor,(await context.params).id);return Response.json({message:"Attachment removed."}); }
  catch(error){if(error instanceof AuthorizationError)return authorizationResponse(error);if(error instanceof AttachmentError)return Response.json({error:{code:error.code,message:error.message}},{status:error.status});throw error;}
}
