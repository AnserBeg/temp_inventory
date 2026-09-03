"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    appendHelcimPayIframe?: (checkoutToken: string, allowExit?: boolean) => void;
    removeHelcimPayIframe?: () => void;
  }
}

type CheckoutResult = {
  checkoutToken?: string;
  status?: "paid" | "processing" | "failed";
  message?: string;
  error?: { message?: string };
};

function amountToCents(value: string) {
  if (!/^\d+(?:\.\d{0,2})?$/u.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function loadHelcimPay() {
  if (window.appendHelcimPayIframe) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-helcim-pay="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Helcim checkout could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://secure.helcim.app/helcim-pay/services/start.js";
    script.async = true;
    script.dataset.helcimPay = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Helcim checkout could not be loaded."));
    document.head.append(script);
  });
}

export function HelcimCheckout({ token, outstandingCents, currency, paymentMethods }: {
  token: string;
  outstandingCents: number;
  currency: string;
  paymentMethods: string;
}) {
  const [amount, setAmount] = useState((outstandingCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"ready" | "processing" | "paid">("ready");
  const [message, setMessage] = useState("");
  const checkoutToken = useRef("");

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (!checkoutToken.current || event.origin !== "https://secure.helcim.app") return;
      const payload = event.data as { eventName?: string; eventStatus?: string; eventMessage?: unknown } | null;
      if (!payload || payload.eventName !== `helcim-pay-js-${checkoutToken.current}`) return;
      if (payload.eventStatus === "HIDE") { setBusy(false); return; }
      if (payload.eventStatus === "ABORTED") {
        setBusy(false);
        setMessage(typeof payload.eventMessage === "string" ? payload.eventMessage : "Helcim did not approve the payment. You can try again.");
        return;
      }
      if (payload.eventStatus !== "SUCCESS") return;
      setState("processing");
      setMessage("Confirming your payment…");
      try {
        const response = await fetch("/api/payments/helcim/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentLinkToken: token, checkoutToken: checkoutToken.current, eventMessage: payload.eventMessage }),
        });
        const result = await response.json() as CheckoutResult;
        if (!response.ok) throw new Error(result.error?.message ?? "The payment could not be confirmed.");
        window.removeHelcimPayIframe?.();
        if (result.status === "paid") {
          setState("paid");
          setMessage("Payment received. Thank you—this invoice has been updated.");
        } else {
          setState("processing");
          setMessage(result.message ?? "Your bank payment is processing. The invoice will update after clearing.");
        }
      } catch (error) {
        setState("processing");
        setMessage(error instanceof Error ? error.message : "The payment needs review. Please contact the billing team before paying again.");
      } finally { setBusy(false); }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [token]);

  const start = async () => {
    const amountCents = amountToCents(amount);
    if (amountCents == null || amountCents < 100 || amountCents > outstandingCents) {
      setMessage(`Enter an amount from 1.00 to ${(outstandingCents / 100).toFixed(2)}.`);
      return;
    }
    setBusy(true); setMessage("");
    try {
      await loadHelcimPay();
      const response = await fetch("/api/payments/helcim/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentLinkToken: token, amountCents }),
      });
      const result = await response.json() as CheckoutResult;
      if (!response.ok || !result.checkoutToken) throw new Error(result.error?.message ?? "Checkout could not be started.");
      checkoutToken.current = result.checkoutToken;
      if (!window.appendHelcimPayIframe) throw new Error("Helcim checkout did not initialize.");
      window.appendHelcimPayIframe(result.checkoutToken, true);
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Checkout could not be started.");
    }
  };

  if (state === "paid") return <div className="payment-success" role="status"><span aria-hidden="true">✓</span><div><strong>Payment received</strong><p>{message}</p></div></div>;
  if (state === "processing") return <div className="payment-processing" role="status"><span aria-hidden="true">↻</span><div><strong>Payment processing</strong><p>{message}</p></div></div>;

  return <div className="public-payment-form">
    <label htmlFor="payment-amount"><span>Payment amount</span><div className="money-input"><span>{currency}</span><input id="payment-amount" type="number" min="1" max={(outstandingCents / 100).toFixed(2)} step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} /></div></label>
    <button type="button" onClick={() => void start()} disabled={busy}>{busy ? "Opening secure checkout…" : "Continue to secure payment"}</button>
    <p className="payment-method-note">{paymentMethods === "cc-ach" ? "Pay by credit card or Canadian bank account." : paymentMethods === "ach" ? "Pay by Canadian bank account." : "Pay by credit card."} Payment details are entered directly in Helcim&apos;s secure checkout.</p>
    {message ? <p className="payment-form-message" role="alert">{message}</p> : null}
  </div>;
}

