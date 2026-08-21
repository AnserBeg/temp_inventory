import { completeQboAuthorization } from "@/lib/server/qbo-client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const realmId = url.searchParams.get("realmId") ?? "";
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const target = new URL("/?view=reports&tab=integrations&qbo=error", url.origin);
    target.searchParams.set("message", url.searchParams.get("error_description") ?? oauthError);
    return Response.redirect(target, 302);
  }
  if (!state || !code || !realmId) return Response.json({ error: { code: "INVALID_CALLBACK", message: "QuickBooks callback is missing state, code, or realmId." } }, { status: 400 });
  try {
    const result = await completeQboAuthorization(request.url, { state, code, realmId });
    const target = new URL(result.returnTo, url.origin);
    target.searchParams.set("qbo", "connected");
    target.searchParams.set("connectionId", result.connectionId);
    return Response.redirect(target, 302);
  } catch (error) {
    const target = new URL("/?view=reports&tab=integrations&qbo=error", url.origin);
    target.searchParams.set("message", error instanceof Error ? error.message : String(error));
    return Response.redirect(target, 302);
  }
}
