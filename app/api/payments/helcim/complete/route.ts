import { completeHelcimCheckout, HelcimPaymentError } from "@/lib/server/helcim-payments";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>;
    const paymentLinkToken = String(input.paymentLinkToken ?? "").trim();
    const checkoutToken = String(input.checkoutToken ?? "").trim();
    if (!paymentLinkToken || !checkoutToken || input.eventMessage == null) {
      return Response.json({ error: { code: "CHECKOUT_RESPONSE_REQUIRED", message: "The payment link, checkout token, and Helcim response are required." } }, { status: 400 });
    }
    return Response.json(await completeHelcimCheckout({ paymentLinkToken, checkoutToken, eventMessage: input.eventMessage }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HelcimPaymentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    return Response.json({ error: { code: "PAYMENT_COMPLETION_FAILED", message: error instanceof Error ? error.message : "The payment could not be confirmed." } }, { status: 500 });
  }
}

