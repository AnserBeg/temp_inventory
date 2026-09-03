import { completeEmailAuthorization, EmailConfigurationError, EmailProviderError } from "@/lib/server/email-client";
import type { EmailProvider } from "@/lib/server/email-types";
import { sha256Hex } from "@/lib/server/email-crypto";
import { ensureDatabase, getRootD1 } from "@/lib/server/inventory-db";
import { runWithTenant } from "@/lib/server/tenancy";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await context.params;
  const provider = rawProvider as EmailProvider;
  const url = new URL(request.url);
  if (!(["google", "microsoft"] as string[]).includes(provider)) return Response.json({ error: { code: "INVALID_EMAIL_PROVIDER", message: "Unknown email provider." } }, { status: 404 });
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const target = new URL("/", url.origin);
    target.searchParams.set("email", "error");
    target.searchParams.set("message", url.searchParams.get("error_description") ?? oauthError);
    return Response.redirect(target, 302);
  }
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code) return Response.json({ error: { code: "INVALID_CALLBACK", message: "Email callback is missing state or code." } }, { status: 400 });
  try {
    await ensureDatabase();
    const stateHash = await sha256Hex(state);
    const owner = await getRootD1().prepare("SELECT tenant_id AS tenantId FROM email_oauth_states WHERE state_hash=? AND consumed_at IS NULL LIMIT 1").bind(stateHash).first<{ tenantId: string }>();
    if (!owner) throw new EmailProviderError("This email authorization expired or was already used.", "EMAIL_OAUTH_STATE_INVALID", 400);
    const result = await runWithTenant({ tenantId: owner.tenantId }, () => completeEmailAuthorization(request.url, { provider, state, code }));
    const target = new URL(result.returnTo, url.origin);
    target.searchParams.set("email", "connected");
    target.searchParams.set("mailbox", result.emailAddress);
    return Response.redirect(target, 302);
  } catch (error) {
    const target = new URL("/", url.origin);
    target.searchParams.set("email", "error");
    target.searchParams.set("message", error instanceof EmailConfigurationError || error instanceof EmailProviderError || error instanceof Error ? error.message : "Email connection failed.");
    return Response.redirect(target, 302);
  }
}
