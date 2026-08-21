import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { createQboAuthorizationUrl, QboConfigurationError } from "@/lib/server/qbo-client";
import type { QboEnvironment } from "@/lib/server/qbo-types";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "administer");
    const input = await request.json() as Record<string, unknown>;
    const environment = String(input.environment ?? "sandbox");
    if (!(["sandbox", "production"] as string[]).includes(environment)) return Response.json({ error: { code: "INVALID_ENVIRONMENT", message: "environment must be sandbox or production." } }, { status: 400 });
    const defaultSyncFrom = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
    return Response.json(await createQboAuthorizationUrl(actor, request.url, {
      environment: environment as QboEnvironment,
      syncFrom: String(input.syncFrom ?? defaultSyncFrom),
      returnTo: String(input.returnTo ?? "/?view=reports&tab=integrations"),
    }));
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    const code = error instanceof QboConfigurationError ? error.code : "QBO_CONNECT_FAILED";
    return Response.json({ error: { code, message: error instanceof Error ? error.message : String(error) } }, { status: error instanceof QboConfigurationError ? 503 : 400 });
  }
}
