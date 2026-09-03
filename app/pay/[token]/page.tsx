import type { Metadata } from "next";
import Link from "next/link";
import { getPublicInvoiceForPayment, runForPaymentLinkTenant } from "@/lib/server/helcim-payments";
import { HelcimCheckout } from "./helcim-checkout";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay invoice",
  description: "Secure invoice payment for PaneFlow customers.",
  robots: { index: false, follow: false },
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

export default async function PaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invoice = await runForPaymentLinkTenant(token, () => getPublicInvoiceForPayment(token)) ?? { available: false as const, reason: "not_found" as const };
  const unavailable = !invoice.available;
  const title = invoice.reason === "paid" ? "This invoice is paid"
    : invoice.reason === "expired" ? "This payment link expired"
    : invoice.reason === "void" ? "This invoice is no longer payable"
    : invoice.reason === "configuration" ? "Online payment is being configured"
    : "Payment link not found";
  const detail = invoice.reason === "paid" ? "Thank you. No balance remains on this invoice."
    : invoice.reason === "expired" ? "Ask the billing team to send you a new secure payment link."
    : invoice.reason === "configuration" ? "Please contact the billing team for another payment method."
    : "Please contact the billing team if you believe this is an error.";

  return <main className="public-payment-page">
    <section className="public-payment-shell" aria-labelledby="payment-title">
      <header><Link className="payment-brand" href="/" aria-label="PaneFlow home"><span>PF</span><strong>PaneFlow</strong></Link><div className="secure-label"><span aria-hidden="true">●</span> Secure payment</div></header>
      {unavailable ? <div className="payment-unavailable"><span className="payment-state-icon" aria-hidden="true">{invoice.reason === "paid" ? "✓" : "!"}</span><h1 id="payment-title">{title}</h1><p>{detail}</p>{"invoiceNumber" in invoice && invoice.invoiceNumber ? <small>Invoice {invoice.invoiceNumber}</small> : null}</div>
      : <>
        <div className="payment-heading"><span>Invoice payment</span><h1 id="payment-title">{invoice.invoiceNumber}</h1><p>For {invoice.customerName}</p></div>
        <dl className="payment-summary"><div><dt>Invoice date</dt><dd>{invoice.invoiceDate}</dd></div><div><dt>Due date</dt><dd>{invoice.dueDate}</dd></div><div className="payment-balance"><dt>Balance due</dt><dd>{money(invoice.outstandingCents, invoice.currency)}</dd></div></dl>
        <HelcimCheckout token={token} outstandingCents={invoice.outstandingCents} currency={invoice.currency} paymentMethods={invoice.paymentMethods} />
      </>}
      <footer><span>Payments processed by <strong>Helcim</strong></span><span>TLS encrypted checkout</span></footer>
    </section>
  </main>;
}
