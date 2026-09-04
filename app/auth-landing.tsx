"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type AuthMode = "signin" | "create";

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56);
}

function errorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "The request could not be completed.";
  const error = (input as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return "The request could not be completed.";
}

export function AuthLanding() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirmation("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "create" && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const endpoint = mode === "signin" ? "/api/auth/login" : "/api/auth/register";
      const payload = mode === "signin"
        ? { organizationSlug, email, password }
        : { organizationName, organizationSlug, fullName, email, password };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as unknown;
      if (!response.ok) throw new Error(errorMessage(result));
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page">
    <section className="auth-story" aria-labelledby="auth-title">
      <Link className="auth-brand" href="/" aria-label="PaneFlow home"><span aria-hidden="true"><i /></span><strong>PaneFlow</strong></Link>
      <div className="auth-story-copy">
        <span className="auth-kicker">Distribution operations, kept accountable</span>
        <h1 id="auth-title">One operating picture.<br />Only your organization.</h1>
        <p>Purchasing, receiving, stock, fulfillment, billing, and customer activity stay connected without crossing company boundaries.</p>
        <ul>
          <li><span aria-hidden="true">01</span><div><strong>Organization-scoped access</strong><small>Every session is checked against an active company membership.</small></div></li>
          <li><span aria-hidden="true">02</span><div><strong>Traceable operations</strong><small>Physical and financial changes retain their source and actor.</small></div></li>
          <li><span aria-hidden="true">03</span><div><strong>A clean start</strong><small>Each new organization opens with its own warehouse and settings.</small></div></li>
        </ul>
      </div>
      <footer>PaneFlow Operations · Secure organization workspace</footer>
    </section>

    <section className="auth-access" aria-label="Account access">
      <div className="auth-card">
        <div className="auth-tabs" role="tablist" aria-label="Account action">
          <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => changeMode("signin")}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => changeMode("create")}>Create organization</button>
        </div>
        <div className="auth-heading">
          <span>{mode === "signin" ? "Welcome back" : "New workspace"}</span>
          <h2>{mode === "signin" ? "Sign in to PaneFlow" : "Create your organization"}</h2>
          <p>{mode === "signin" ? "Use the organization ID supplied by your administrator." : "You will become the first administrator for this isolated workspace."}</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "create" ? <label><span>Organization name</span><input autoFocus autoComplete="organization" value={organizationName} onChange={(event) => { const value = event.target.value; setOrganizationName(value); if (!slugEdited) setOrganizationSlug(slugify(value)); }} required minLength={2} maxLength={100} /></label> : null}
          <label><span>Organization ID</span><input autoFocus={mode === "signin"} autoCapitalize="none" autoComplete="organization" spellCheck={false} value={organizationSlug} onChange={(event) => { setSlugEdited(true); setOrganizationSlug(slugify(event.target.value)); }} required minLength={2} maxLength={56} /><small>Lowercase letters and numbers; use this ID every time you sign in.</small></label>
          {mode === "create" ? <label><span>Your full name</span><input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={2} maxLength={100} /></label> : null}
          <label><span>Email address</span><input type="email" autoCapitalize="none" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
          <label><span>Password</span><input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} />{mode === "create" ? <small>Use at least 12 characters.</small> : null}</label>
          {mode === "create" ? <label><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={12} maxLength={128} /></label> : null}
          {error ? <div className="auth-error" role="alert"><span aria-hidden="true">!</span><p>{error}</p></div> : null}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? mode === "signin" ? "Signing in…" : "Creating organization…" : mode === "signin" ? "Sign in" : "Create organization"}<span aria-hidden="true">→</span></button>
        </form>
        <p className="auth-switch">{mode === "signin" ? "Starting a new company workspace?" : "Already have an organization?"} <button type="button" onClick={() => changeMode(mode === "signin" ? "create" : "signin")}>{mode === "signin" ? "Create an organization" : "Sign in"}</button></p>
      </div>
    </section>
  </main>;
}
