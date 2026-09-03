import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { EmailConfigurationError, EmailProviderError, saveSmtpConnection } from "@/lib/server/email-client";
import type { EmailSenderType } from "@/lib/server/email-types";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request); requireCapability(actor, "read");
    const input = await request.json() as Record<string, unknown>;
    const senderType = String(input.senderType ?? "personal") as EmailSenderType;
    if (!("company" === senderType || "personal" === senderType)) {
      return Response.json({ error: { code: "INVALID_EMAIL_SENDER", message: "senderType must be company or personal." } }, { status: 400 });
    }
    return Response.json(await saveSmtpConnection(actor, senderType, {
      emailAddress: String(input.emailAddress ?? ""),
      host: String(input.host ?? ""),
      port: Number(input.port),
      username: String(input.username ?? ""),
      password: String(input.password ?? ""),
    }));
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof EmailConfigurationError || error instanceof EmailProviderError) {
      return Response.json({ error: { code: error.code, message: error.message, detail: "detail" in error ? error.detail : undefined } }, { status: error.status });
    }
    return Response.json({ error: { code: "SMTP_CONNECT_FAILED", message: error instanceof Error ? error.message : "SMTP setup failed." } }, { status: 400 });
  }
}
