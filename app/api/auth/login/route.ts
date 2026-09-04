import { authClientKey, loginToOrganization, PasswordAuthError, requireSameOrigin, sessionCookieHeaders } from "@/lib/server/password-auth";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await request.json() as Record<string, unknown>;
    const session = await loginToOrganization(input, authClientKey(request));
    return Response.json({ user: session.user, tenant: session.tenant }, { headers: sessionCookieHeaders(request, session) });
  } catch (error) {
    if (error instanceof PasswordAuthError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Organization login failed.", error);
    return Response.json({ error: { code: "LOGIN_FAILED", message: "Sign in is temporarily unavailable." } }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
