"use client";

import { useState } from "react";

export function HelcimPaymentLinkButton({ invoiceId, invoiceNumber, disabled = false }: {
  invoiceId: string;
  invoiceNumber: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Payment link");

  const create = async () => {
    setBusy(true); setLabel("Creating…");
    try {
      const response = await fetch("/api/payments/helcim/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const result = await response.json() as { url?: string; error?: { message?: string } };
      if (!response.ok || !result.url) throw new Error(result.error?.message ?? "Payment link creation failed.");
      try {
        await navigator.clipboard.writeText(result.url);
        setLabel("Link copied");
      } catch {
        window.prompt(`Copy the secure payment link for ${invoiceNumber}:`, result.url);
        setLabel("Link ready");
      }
      window.setTimeout(() => setLabel("Payment link"), 3_000);
    } catch (error) {
      setLabel(error instanceof Error ? error.message : "Link failed");
      window.setTimeout(() => setLabel("Payment link"), 5_000);
    } finally { setBusy(false); }
  };

  return <button className="workflow-action secondary" type="button" disabled={disabled || busy} onClick={() => void create()} title={label}>{label}</button>;
}

