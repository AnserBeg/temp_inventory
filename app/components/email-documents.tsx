"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDialogDismiss } from "./use-dialog-dismiss";

type EmailProvider = "google" | "microsoft";
type EmailSenderType = "company" | "personal";
type DocumentType = "purchase_order" | "sales_order" | "customer_invoice";
type ConnectionSummary = {
  senderType: EmailSenderType; provider: EmailProvider; providerLabel: string; emailAddress: string; status: string; connectedAt: string; lastError?: string;
};
type ConnectionState = {
  configuredProviders: Array<{ provider: EmailProvider; label: string }>;
  companyConnection: ConnectionSummary | null;
  personalConnection: ConnectionSummary | null;
  defaultSender: EmailSenderType | null;
  canManageCompany: boolean;
  connection: ConnectionSummary | null;
};
type PreviewResponse = {
  document: {
    documentType: DocumentType; documentId: string; documentNumber: string; documentLabel: string; partyName: string;
    defaultRecipient: string; defaultSubject: string; defaultMessage: string; fileName: string;
  };
  email: ConnectionState;
};

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
    if (typeof error === "string") return error;
  }
  return fallback;
}

async function beginConnection(provider: EmailProvider, senderType: EmailSenderType) {
  const response = await fetch("/api/integrations/email/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, senderType, returnTo: `${window.location.pathname}${window.location.search}` }),
  });
  const body = await response.json() as { authorizationUrl?: string; error?: unknown };
  if (!response.ok || !body.authorizationUrl) throw new Error(errorMessage(body, "The email connection could not be started."));
  window.location.assign(body.authorizationUrl);
}

export function EmailConnectionManager({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [setupTarget, setSetupTarget] = useState<EmailSenderType | null>(null);
  // Every setState here happens after the response arrives, never synchronously inside the
  // effect that starts the load; errors are handled where they occur rather than by the caller.
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/email", { cache: "no-store" });
      const body = await response.json() as ConnectionState;
      if (!response.ok) throw new Error(errorMessage(body, "Email connection status is unavailable."));
      setState(body);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Email connection status is unavailable.");
    }
  }, []);
  // Deferred a tick, as the other loaders are, so no state is set synchronously inside the effect.
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const connect = async (provider: EmailProvider, senderType: EmailSenderType) => {
    setBusy(`${senderType}:${provider}`); setError("");
    try { await beginConnection(provider, senderType); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The email connection could not be started."); setBusy(""); }
  };
  const disconnect = async (senderType: EmailSenderType) => {
    setBusy(`${senderType}:disconnect`); setError("");
    try {
      const response = await fetch(`/api/integrations/email?sender=${senderType}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "The mailbox could not be disconnected."));
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The mailbox could not be disconnected."); }
    finally { setBusy(""); }
  };

  const providerName = (provider: EmailProvider) => provider === "google" ? "Google" : "Microsoft 365";
  const senderRow = (senderType: EmailSenderType, connection: ConnectionSummary | null, canManage: boolean) => {
    const title = senderType === "company" ? "Company email" : "My email";
    const description = senderType === "company" ? "Shared with everyone" : "Only you can use this";
    const ready = connection?.status === "connected";
    return <div className="email-sender-setting" key={senderType}>
      <div><strong>{title}</strong><small>{ready ? connection.emailAddress : connection ? "Needs to be reconnected" : description}</small></div>
      {ready && canManage ? <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void disconnect(senderType)}>{busy === `${senderType}:disconnect` ? "Removing…" : "Remove"}</button> : null}
      {!ready && canManage && setupTarget !== senderType ? <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setSetupTarget(senderType)}>{connection ? "Reconnect" : "Connect"}</button> : null}
      {!ready && !canManage ? <small className="email-admin-note">Not set up</small> : null}
      {setupTarget === senderType ? <div className="email-provider-actions email-provider-choice">
        {state?.configuredProviders.map((provider) => <button type="button" className="button secondary" key={provider.provider} disabled={Boolean(busy)} onClick={() => void connect(provider.provider, senderType)}>{busy === `${senderType}:${provider.provider}` ? "Opening…" : providerName(provider.provider)}</button>)}
        <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setSetupTarget(null)}>Cancel</button>
        {!state?.configuredProviders.length ? <small>Email sign-in is not configured for this installation.</small> : null}
      </div> : null}
    </div>;
  };

  return <div className={`email-connection-manager ${compact ? "compact" : ""}`}>
    <div className="email-connection-heading"><div><strong>Email sending</strong>{state?.connection ? <small>{state.connection.senderType === "company" ? "Company" : "Personal"} · {state.connection.emailAddress}</small> : <small>{state ? "No sender is set up" : "Checking email…"}</small>}</div>{state ? <button type="button" className="text-button" onClick={() => { setExpanded((value) => !value); setSetupTarget(null); }}>{expanded ? "Done" : state.connection ? "Manage" : "Set up"}</button> : null}</div>
    {error ? <p className="text-danger" role="alert">{error}</p> : null}
    {state && expanded ? <div className="email-sender-list">
      {senderRow("company", state.companyConnection, state.canManageCompany)}
      {senderRow("personal", state.personalConnection, true)}
    </div> : null}
  </div>;
}

export function EmailDocumentButton({ documentType, documentId, documentNumber, disabled = false, className = "button secondary", children = "Email document" }: {
  documentType: DocumentType; documentId: string; documentNumber: string; disabled?: boolean; className?: string; children?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)} title={disabled ? "Your role cannot send this document." : `Email ${documentNumber} as a PDF`}>{children}</button>
    {open ? <EmailDocumentDialog documentType={documentType} documentId={documentId} documentNumber={documentNumber} onClose={() => setOpen(false)} /> : null}
  </>;
}

function EmailDocumentDialog({ documentType, documentId, documentNumber, onClose }: { documentType: DocumentType; documentId: string; documentNumber: string; onClose: () => void }) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [senderType, setSenderType] = useState<EmailSenderType>("company");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ senderEmail: string; recipients: string[] } | null>(null);
  useDialogDismiss(onClose, busy);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const query = new URLSearchParams({ documentType, documentId });
        const response = await fetch(`/api/documents/email?${query}`, { cache: "no-store" });
        const body = await response.json() as PreviewResponse;
        if (!response.ok) throw new Error(errorMessage(body, `Could not prepare ${documentNumber} for email.`));
        if (!active) return;
        setData(body); setRecipient(body.document.defaultRecipient); setSubject(body.document.defaultSubject); setMessage(body.document.defaultMessage); setSenderType(body.email.defaultSender ?? "personal");
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : `Could not prepare ${documentNumber} for email.`); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [documentId, documentNumber, documentType]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/documents/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType, documentId, recipients: recipient.split(/[;,]/).map((value) => value.trim()).filter(Boolean), subject, message, senderType }),
      });
      const body = await response.json() as { senderEmail?: string; recipients?: string[]; error?: unknown };
      if (!response.ok || !body.senderEmail) throw new Error(errorMessage(body, `${documentNumber} could not be emailed.`));
      setSent({ senderEmail: body.senderEmail, recipients: body.recipients ?? [] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : `${documentNumber} could not be emailed.`); }
    finally { setBusy(false); }
  };

  const connect = async (provider: EmailProvider) => {
    setBusy(true); setError("");
    try { await beginConnection(provider, "personal"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The email connection could not be started."); setBusy(false); }
  };

  const availableSenders = data ? [data.email.companyConnection, data.email.personalConnection]
    .filter((connection): connection is ConnectionSummary => connection?.status === "connected") : [];
  const selectedSender = availableSenders.find((connection) => connection.senderType === senderType) ?? availableSenders[0];

  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="command-dialog email-document-dialog" role="dialog" aria-modal="true" aria-labelledby="email-document-title">
    <div className="dialog-header"><div><span className="section-kicker">{documentNumber}</span><h2 id="email-document-title">Send document by email</h2></div><button type="button" className="icon-button" aria-label="Close email dialog" disabled={busy} onClick={onClose}>×</button></div>
    {sent ? <div className="email-delivery-success" role="status"><strong>Document sent</strong><p>{documentNumber} was sent from {sent.senderEmail} to {sent.recipients.join(", ")} with a PDF attachment.</p><div className="dialog-actions"><button type="button" className="button primary" onClick={onClose}>Done</button></div></div>
      : <form onSubmit={submit}>
        {loading ? <div className="empty-inline">Preparing the current document and checking your mailbox…</div> : null}
        {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}
        {data && !availableSenders.length ? <div className="email-connect-required"><strong>Set up email to send</strong><p>Connect your email here, or ask a company administrator to set up the shared company email.</p><div className="email-provider-actions">{data.email.configuredProviders.map((provider) => <button type="button" className="button secondary" key={provider.provider} disabled={busy} onClick={() => void connect(provider.provider)}>Connect {provider.provider === "google" ? "Google" : "Microsoft 365"}</button>)}</div>{!data.email.configuredProviders.length ? <small>Email sign-in is not configured for this installation.</small> : null}</div> : null}
        {data && selectedSender ? <><div className="email-sender-summary"><span>From</span>{availableSenders.length > 1 ? <select aria-label="Email sender" value={senderType} onChange={(event) => setSenderType(event.target.value as EmailSenderType)}>{availableSenders.map((connection) => <option value={connection.senderType} key={connection.senderType}>{connection.senderType === "company" ? "Company" : "My email"} — {connection.emailAddress}</option>)}</select> : <strong>{selectedSender.emailAddress}</strong>}<small>{selectedSender.senderType === "company" ? "Company email" : "Your email"} · {data.document.fileName} will be attached</small></div><div className="command-form">
          <label>To<input type="text" inputMode="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={`${data.document.partyName}'s email address`} required /><small>Separate multiple recipients with commas.</small></label>
          <label>Subject<input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} required /></label>
          <label>Message<textarea value={message} maxLength={5000} rows={7} onChange={(event) => setMessage(event.target.value)} /></label>
        </div></> : null}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>{selectedSender ? <button type="submit" className="button primary" disabled={busy || !recipient.trim() || !subject.trim()}>{busy ? "Sending…" : `Send ${data?.document.documentLabel.toLowerCase()}`}</button> : null}</div>
      </form>}
  </section></div>;
}
