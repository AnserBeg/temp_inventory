import { PasswordAuthError, registerOrganization, requireSameOrigin, sessionCookieHeaders } from "@/lib/server/password-auth";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await request.json() as Record<string, unknown>;
    const session = await registerOrganization(input);
    return Response.json({ user: session.user, tenant: session.tenant }, { status: 201, headers: sessionCookieHeaders(request, session) });
  } catch (error) {
    if (error instanceof PasswordAuthError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Organization registration failed.", error);
    return Response.json({ error: { code: "REGISTRATION_FAILED", message: "The organization could not be created." } }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
