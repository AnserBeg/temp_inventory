import { clearedSessionCookieHeaders, revokeRequestSession } from "@/lib/server/password-auth";

async function logout(request: Request) {
  await revokeRequestSession(request);
  const headers = clearedSessionCookieHeaders(request);
  headers.set("Location", "/");
  return new Response(null, { status: 303, headers });
}

export const GET = logout;
export const POST = logout;
