import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { createEmailAuthorizationUrl, EmailConfigurationError, EmailProviderError } from "@/lib/server/email-client";
import type { EmailSenderType, OAuthEmailProvider } from "@/lib/server/email-types";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "read");
    const input = await request.json() as Record<string, unknown>;
    const provider = String(input.provider ?? "") as OAuthEmailProvider;
    if (!(["google", "microsoft"] as string[]).includes(provider)) {
      return Response.json({ error: { code: "INVALID_EMAIL_PROVIDER", message: "provider must be google or microsoft." } }, { status: 400 });
    }
    const senderType = String(input.senderType ?? "personal") as EmailSenderType;
    if (!(["company", "personal"] as string[]).includes(senderType)) {
      return Response.json({ error: { code: "INVALID_EMAIL_SENDER", message: "senderType must be company or personal." } }, { status: 400 });
    }
    return Response.json(await createEmailAuthorizationUrl(actor, request.url, { provider, senderType, returnTo: String(input.returnTo ?? "/") }));
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof EmailConfigurationError || error instanceof EmailProviderError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    return Response.json({ error: { code: "EMAIL_CONNECT_FAILED", message: error instanceof Error ? error.message : "Email connection failed." } }, { status: 400 });
  }
}
