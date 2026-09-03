import { AuthorizationError, authorizationResponse, requireCapability, resolveActor } from "@/lib/server/auth";
import { createInvoicePaymentLink, HelcimPaymentError } from "@/lib/server/helcim-payments";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "financialWrite");
    const input = await request.json() as Record<string, unknown>;
    const invoiceId = String(input.invoiceId ?? "").trim();
    if (!invoiceId) return Response.json({ error: { code: "INVOICE_REQUIRED", message: "invoiceId is required." } }, { status: 400 });
    return Response.json(await createInvoicePaymentLink(invoiceId, actor, request.url), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof HelcimPaymentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    return Response.json({ error: { code: "PAYMENT_LINK_FAILED", message: error instanceof Error ? error.message : "Payment link creation failed." } }, { status: 500 });
  }
}

