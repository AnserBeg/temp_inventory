import { createHelcimCheckout, HelcimPaymentError, runForPaymentLinkTenant } from "@/lib/server/helcim-payments";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>;
    const paymentLinkToken = String(input.paymentLinkToken ?? "").trim();
    if (!paymentLinkToken) return Response.json({ error: { code: "PAYMENT_LINK_REQUIRED", message: "A payment link token is required." } }, { status: 400 });
    const result = await runForPaymentLinkTenant(paymentLinkToken, () => createHelcimCheckout({ paymentLinkToken, amountCents: input.amountCents }));
    if (!result) return Response.json({ error: { code: "PAYMENT_LINK_INVALID", message: "This payment link is invalid or has expired." } }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HelcimPaymentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    return Response.json({ error: { code: "CHECKOUT_FAILED", message: error instanceof Error ? error.message : "Helcim checkout could not be started." } }, { status: 500 });
  }
}
