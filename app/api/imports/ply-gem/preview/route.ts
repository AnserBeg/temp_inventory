import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { PlyGemImportPreviewError, previewPlyGemCostSheets } from "@/lib/server/ply-gem-import";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "read");
    const input = await request.json() as { documents?: unknown };
    const result = await previewPlyGemCostSheets(Array.isArray(input.documents) ? input.documents : []);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof PlyGemImportPreviewError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    const message = error instanceof Error ? error.message : "The cost sheets could not be previewed.";
    return Response.json({ error: { code: "PREVIEW_FAILED", message } }, { status: 500 });
  }
}
