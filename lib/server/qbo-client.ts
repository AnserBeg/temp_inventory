import { env } from "cloudflare:workers";
import type { ActorIdentity } from "./auth";
import { ensureDatabase, first, getD1 } from "./inventory-db";
import { decryptQboSecret, encryptQboSecret, randomUrlSafeString, sha256Hex } from "./qbo-crypto";
import type {
  QboApiEnvelope,
  QboConnection,
  QboEnvironment,
  QboRequestOptions,
  QboRuntimeConfig,
  QboTokenResponse,
} from "./qbo-types";

const authorizationEndpoint = "https://appcenter.intuit.com/connect/oauth2";
const tokenEndpoint = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const revokeEndpoint = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const accountingScope = "com.intuit.quickbooks.accounting";

type RuntimeEnv = Record<string, unknown>;

export class QboConfigurationError extends Error {
  code = "QBO_NOT_CONFIGURED";
}

export class QboBusyError extends Error {
  code = "QBO_BUSY";
  retryable = true;
}

export class QboApiError extends Error {
  code: string;
  status: number;
  detail: string;
  retryable: boolean;
  conflict: boolean;

  constructor(message: string, options: { code?: string; status: number; detail?: string; retryable?: boolean; conflict?: boolean }) {
    super(message);
    this.name = "QboApiError";
    this.code = options.code ?? "QBO_API_ERROR";
    this.status = options.status;
    this.detail = options.detail ?? message;
    this.retryable = options.retryable ?? (options.status === 429 || options.status >= 500);
    this.conflict = options.conflict ?? ["5010", "6240", "610"].includes(this.code);
  }
}

function runtimeValue(name: string) {
  const value = (env as unknown as RuntimeEnv)[name];
  return typeof value === "string" ? value.trim() : "";
}

export function qboConfig(_requestUrl?: string): QboRuntimeConfig {
  void _requestUrl;
  const config = {
    clientId: runtimeValue("QBO_CLIENT_ID"),
    clientSecret: runtimeValue("QBO_CLIENT_SECRET"),
    tokenEncryptionKey: runtimeValue("QBO_TOKEN_ENCRYPTION_KEY"),
    redirectUri: runtimeValue("QBO_REDIRECT_URI"),
    webhookVerifierToken: runtimeValue("QBO_WEBHOOK_VERIFIER_TOKEN") || undefined,
    minorVersion: runtimeValue("QBO_MINOR_VERSION") || "75",
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => ["clientId", "clientSecret", "tokenEncryptionKey", "redirectUri"].includes(key) && !value)
    .map(([key]) => key);
  if (missing.length) throw new QboConfigurationError(`QuickBooks is not configured. Missing: ${missing.join(", ")}.`);
  if (config.tokenEncryptionKey.length < 32) throw new QboConfigurationError("QBO_TOKEN_ENCRYPTION_KEY must be at least 32 characters.");
  let redirect: URL;
  try { redirect = new URL(config.redirectUri); }
  catch { throw new QboConfigurationError("QBO_REDIRECT_URI must be an absolute URL registered with Intuit."); }
  const localRedirect = ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
  if (redirect.protocol !== "https:" && !(localRedirect && redirect.protocol === "http:")) {
    throw new QboConfigurationError("QBO_REDIRECT_URI must use HTTPS except for localhost development.");
  }
  if (!/^\d+$/u.test(config.minorVersion)) throw new QboConfigurationError("QBO_MINOR_VERSION must be a numeric Intuit minor version.");
  return config;
}

export function qboConfigurationStatus(requestUrl?: string) {
  const runtime = {
    QBO_CLIENT_ID: runtimeValue("QBO_CLIENT_ID"),
    QBO_CLIENT_SECRET: runtimeValue("QBO_CLIENT_SECRET"),
    QBO_TOKEN_ENCRYPTION_KEY: runtimeValue("QBO_TOKEN_ENCRYPTION_KEY"),
    QBO_REDIRECT_URI: runtimeValue("QBO_REDIRECT_URI"),
  };
  const missing = Object.entries(runtime).filter(([, value]) => !value).map(([name]) => name);
  const expectedRedirectUri = requestUrl ? `${new URL(requestUrl).origin}/api/integrations/qbo/callback` : "";
  try {
    const config = qboConfig(requestUrl);
    const redirectMatchesSite = !expectedRedirectUri || config.redirectUri === expectedRedirectUri;
    return {
      configured: redirectMatchesSite,
      missing: redirectMatchesSite ? [] : ["QBO_REDIRECT_URI"],
      message: redirectMatchesSite ? "QuickBooks platform credentials are ready." : `QBO_REDIRECT_URI must exactly match ${expectedRedirectUri}.`,
      redirectUri: config.redirectUri,
      expectedRedirectUri,
      redirectMatchesSite,
      webhookConfigured: Boolean(config.webhookVerifierToken),
      minorVersion: config.minorVersion,
    };
  } catch (error) {
    return {
      configured: false,
      missing,
      message: error instanceof Error ? error.message : String(error),
      redirectUri: runtime.QBO_REDIRECT_URI || expectedRedirectUri,
      expectedRedirectUri,
      redirectMatchesSite: !runtime.QBO_REDIRECT_URI || runtime.QBO_REDIRECT_URI === expectedRedirectUri,
      webhookConfigured: Boolean(runtimeValue("QBO_WEBHOOK_VERIFIER_TOKEN")),
      minorVersion: runtimeValue("QBO_MINOR_VERSION") || "75",
    };
  }
}

function apiBase(environment: QboEnvironment) {
  return environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

function tokenAssociatedData(connectionId: string, kind: "access" | "refresh") {
  return `paneflow:qbo:${connectionId}:${kind}`;
}

function addSeconds(seconds: number, margin = 0) {
  return new Date(Date.now() + Math.max(0, seconds - margin) * 1000).toISOString();
}

async function decodeResponse(response: Response) {
  const text = await response.text();
  if (!text) return {} as QboApiEnvelope;
  try { return JSON.parse(text) as QboApiEnvelope; } catch { return { raw: text } as QboApiEnvelope; }
}

function apiError(response: Response, payload: QboApiEnvelope) {
  const error = payload.Fault?.Error?.[0];
  const code = error?.code || `HTTP_${response.status}`;
  const message = error?.Message || `QuickBooks request failed with HTTP ${response.status}.`;
  const detail = error?.Detail || message;
  return new QboApiError(message, {
    code,
    status: response.status,
    detail,
    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    conflict: code === "5010" || code === "6240" || code === "610",
  });
}

async function postTokenForm(config: QboRuntimeConfig, body: URLSearchParams) {
  const encodedCredentials = btoa(`${config.clientId}:${config.clientSecret}`);
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { Authorization: `Basic ${encodedCredentials}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await decodeResponse(response) as QboApiEnvelope & Partial<QboTokenResponse>;
  if (!response.ok || !payload.access_token || !payload.refresh_token) throw apiError(response, payload);
  return payload as QboTokenResponse;
}

export async function createQboAuthorizationUrl(
  actor: ActorIdentity,
  requestUrl: string,
  options: { environment: QboEnvironment; syncFrom: string; returnTo?: string },
) {
  await ensureDatabase();
  const config = qboConfig(requestUrl);
  const state = randomUrlSafeString(40);
  const stateHash = await sha256Hex(state);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const returnTo = options.returnTo?.startsWith("/") && !options.returnTo.startsWith("//") ? options.returnTo : "/?view=reports&tab=integrations";
  const syncFrom = new Date(options.syncFrom);
  if (Number.isNaN(syncFrom.getTime())) throw new Error("syncFrom must be a valid date.");
  await getD1().batch([
    getD1().prepare("DELETE FROM qbo_oauth_states WHERE expires_at<? OR (consumed_at IS NOT NULL AND consumed_at<?)").bind(now, new Date(Date.now() - 24 * 60 * 60_000).toISOString()),
    getD1().prepare(`INSERT INTO qbo_oauth_states
      (state_hash,actor_id,actor_email,environment,return_to,sync_from,created_at,expires_at,consumed_at)
      VALUES (?,?,?,?,?,?,?,?,NULL)`).bind(
        stateHash, actor.id, actor.email, options.environment, returnTo, syncFrom.toISOString(), now, expiresAt,
      ),
  ]);
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", accountingScope);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return { authorizationUrl: url.toString(), expiresAt };
}

type OAuthState = { actorId: string; actorEmail: string; environment: QboEnvironment; returnTo: string; syncFrom: string };

async function consumeOAuthState(state: string) {
  const stateHash = await sha256Hex(state);
  const now = new Date().toISOString();
  const record = await getD1().prepare(`UPDATE qbo_oauth_states SET consumed_at=?
    WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?
    RETURNING actor_id AS actorId,actor_email AS actorEmail,environment,return_to AS returnTo,sync_from AS syncFrom`)
    .bind(now, stateHash, now).first<OAuthState>();
  if (!record) throw new QboApiError("The QuickBooks authorization request expired or was already used.", { code: "INVALID_OAUTH_STATE", status: 400 });
  return record;
}

async function fetchCompanyInfo(environment: QboEnvironment, realmId: string, accessToken: string, minorVersion: string) {
  const url = new URL(`${apiBase(environment)}/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}`);
  url.searchParams.set("minorversion", minorVersion);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const payload = await decodeResponse(response);
  if (!response.ok) throw apiError(response, payload);
  const info = (payload.CompanyInfo ?? {}) as Record<string, unknown>;
  return {
    name: String(info.CompanyName || info.LegalName || "QuickBooks company"),
    country: String(info.Country || "CA"),
    currency: String(info.Currency || "CAD"),
  };
}

export async function completeQboAuthorization(requestUrl: string, params: { state: string; code: string; realmId: string }) {
  await ensureDatabase();
  const config = qboConfig(requestUrl);
  const oauthState = await consumeOAuthState(params.state);
  const otherConnection = await first<{ id: string; companyName: string }>(
    "SELECT id,company_name AS companyName FROM qbo_connections WHERE status='connected' AND realm_id<>? LIMIT 1",
    params.realmId,
  );
  if (otherConnection) {
    throw new QboApiError(`Disconnect ${otherConnection.companyName} before connecting a different QuickBooks company.`, {
      code: "QBO_CONNECTION_ALREADY_ACTIVE", status: 409,
    });
  }
  const tokens = await postTokenForm(config, new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: config.redirectUri,
  }));
  const company = await fetchCompanyInfo(oauthState.environment, params.realmId, tokens.access_token, config.minorVersion);
  const connectionId = `qbo-${params.realmId}`;
  const now = new Date().toISOString();
  const access = await encryptQboSecret(tokens.access_token, config.tokenEncryptionKey, tokenAssociatedData(connectionId, "access"));
  const refresh = await encryptQboSecret(tokens.refresh_token, config.tokenEncryptionKey, tokenAssociatedData(connectionId, "refresh"));
  const accessExpiresAt = addSeconds(tokens.expires_in, 30);
  const refreshExpiresAt = tokens.x_refresh_token_expires_in ? addSeconds(tokens.x_refresh_token_expires_in, 3600) : null;
  const actorLabel = `${oauthState.actorEmail} (${oauthState.actorId})`;
  const existing = await first<{ id: string }>("SELECT id FROM qbo_connections WHERE realm_id=?", params.realmId);
  const db = getD1();
  if (existing) {
    await db.prepare(`UPDATE qbo_connections SET environment=?,status='connected',company_name=?,country=?,home_currency=?,scopes=?,
      encrypted_access_token=?,encrypted_refresh_token=?,access_token_expires_at=?,refresh_token_expires_at=?,sync_from=?,initial_sync_status='queued',
      token_lock_owner=NULL,token_lock_until=NULL,connected_by=?,connected_at=?,updated_at=?,disconnected_at=NULL,last_error=NULL,version=version+1 WHERE id=?`)
      .bind(oauthState.environment, company.name, company.country, company.currency, accountingScope, access, refresh, accessExpiresAt,
        refreshExpiresAt, oauthState.syncFrom, actorLabel, now, now, existing.id).run();
    await db.prepare(`UPDATE qbo_sync_deliveries SET status='pending',attempts=0,available_at=?,locked_at=NULL,last_error_code=NULL,last_error=NULL,processed_at=NULL
      WHERE connection_id=? AND status='canceled' AND last_error='Connection disconnected.'`).bind(now, existing.id).run();
  } else {
    await db.prepare(`INSERT INTO qbo_connections
      (id,realm_id,environment,status,company_name,country,home_currency,scopes,encrypted_access_token,encrypted_refresh_token,
       access_token_expires_at,refresh_token_expires_at,sync_from,initial_sync_status,connected_by,connected_at,updated_at,version)
      VALUES (?,?,?,'connected',?,?,?,?,?,?,?,?,?,'queued',?,?,?,1)`)
      .bind(connectionId, params.realmId, oauthState.environment, company.name, company.country, company.currency, accountingScope,
        access, refresh, accessExpiresAt, refreshExpiresAt, oauthState.syncFrom, actorLabel, now, now).run();
  }
  await db.prepare(`INSERT INTO audit_events
    (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
    VALUES (?,'qbo_connection',?,'connected',?,?,?,?,?,?)`).bind(
      `audit-qbo-${crypto.randomUUID()}`, existing?.id ?? connectionId, `QuickBooks company ${company.name} connected.`, actorLabel,
      oauthState.actorId, oauthState.actorEmail, JSON.stringify({ realmId: params.realmId, environment: oauthState.environment, syncFrom: oauthState.syncFrom }), now,
    ).run();
  return { connectionId: existing?.id ?? connectionId, companyName: company.name, returnTo: oauthState.returnTo };
}

export async function getQboConnection(connectionId: string) {
  return first<QboConnection>(`SELECT id,realm_id AS realmId,environment,status,company_name AS companyName,country,home_currency AS homeCurrency,
    scopes,encrypted_access_token AS encryptedAccessToken,encrypted_refresh_token AS encryptedRefreshToken,access_token_expires_at AS accessTokenExpiresAt,
    refresh_token_expires_at AS refreshTokenExpiresAt,sync_from AS syncFrom,initial_sync_status AS initialSyncStatus,token_lock_owner AS tokenLockOwner,
    token_lock_until AS tokenLockUntil,connected_by AS connectedBy,connected_at AS connectedAt,updated_at AS updatedAt,disconnected_at AS disconnectedAt,
    last_error AS lastError,version FROM qbo_connections WHERE id=?`, connectionId);
}

export async function listQboConnections() {
  await ensureDatabase();
  const result = await getD1().prepare(`SELECT id,realm_id AS realmId,environment,status,company_name AS companyName,country,home_currency AS homeCurrency,
    sync_from AS syncFrom,initial_sync_status AS initialSyncStatus,connected_by AS connectedBy,connected_at AS connectedAt,updated_at AS updatedAt,
    disconnected_at AS disconnectedAt,last_error AS lastError,version FROM qbo_connections ORDER BY connected_at DESC`).all<Record<string, unknown>>();
  return result.results;
}

async function accessToken(connection: QboConnection, config: QboRuntimeConfig, forceRefresh = false) {
  const freshUntil = new Date(connection.accessTokenExpiresAt).getTime() - 2 * 60_000;
  if (!forceRefresh && freshUntil > Date.now()) {
    return decryptQboSecret(connection.encryptedAccessToken, config.tokenEncryptionKey, tokenAssociatedData(connection.id, "access"));
  }
  const owner = `token-refresh-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + 30_000).toISOString();
  const claim = await getD1().prepare(`UPDATE qbo_connections SET token_lock_owner=?,token_lock_until=?
    WHERE id=? AND status='connected' AND (token_lock_until IS NULL OR token_lock_until<?)`)
    .bind(owner, lockUntil, connection.id, now).run();
  if (!claim.meta?.changes) throw new QboBusyError("Another request is refreshing the QuickBooks access token.");
  try {
    const latest = await getQboConnection(connection.id);
    if (!latest) throw new Error("QuickBooks connection was removed during token refresh.");
    if (!forceRefresh && new Date(latest.accessTokenExpiresAt).getTime() - 2 * 60_000 > Date.now()) {
      return decryptQboSecret(latest.encryptedAccessToken, config.tokenEncryptionKey, tokenAssociatedData(latest.id, "access"));
    }
    const refreshToken = await decryptQboSecret(latest.encryptedRefreshToken, config.tokenEncryptionKey, tokenAssociatedData(latest.id, "refresh"));
    const tokens = await postTokenForm(config, new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
    const encryptedAccess = await encryptQboSecret(tokens.access_token, config.tokenEncryptionKey, tokenAssociatedData(latest.id, "access"));
    const encryptedRefresh = await encryptQboSecret(tokens.refresh_token, config.tokenEncryptionKey, tokenAssociatedData(latest.id, "refresh"));
    await getD1().prepare(`UPDATE qbo_connections SET encrypted_access_token=?,encrypted_refresh_token=?,access_token_expires_at=?,
      refresh_token_expires_at=COALESCE(?,refresh_token_expires_at),token_lock_owner=NULL,token_lock_until=NULL,updated_at=?,last_error=NULL,version=version+1
      WHERE id=? AND token_lock_owner=?`).bind(
        encryptedAccess, encryptedRefresh, addSeconds(tokens.expires_in, 30),
        tokens.x_refresh_token_expires_in ? addSeconds(tokens.x_refresh_token_expires_in, 3600) : null,
        new Date().toISOString(), latest.id, owner,
      ).run();
    return tokens.access_token;
  } catch (error) {
    const invalidGrant = error instanceof QboApiError && (error.code === "invalid_grant" || error.status === 401 || error.status === 400);
    await getD1().prepare(`UPDATE qbo_connections SET status=?,token_lock_owner=NULL,token_lock_until=NULL,last_error=?,updated_at=? WHERE id=? AND token_lock_owner=?`)
      .bind(invalidGrant ? "reauthorization_required" : "connected", error instanceof Error ? error.message : String(error), new Date().toISOString(), connection.id, owner).run();
    throw error;
  }
}

export async function qboRequest(connectionId: string, path: string, options: QboRequestOptions = {}) {
  const connection = await getQboConnection(connectionId);
  if (!connection) throw new QboApiError("QuickBooks connection was not found.", { code: "QBO_CONNECTION_NOT_FOUND", status: 404 });
  if (connection.status !== "connected") throw new QboApiError(`QuickBooks connection is ${connection.status}.`, { code: "QBO_NOT_CONNECTED", status: 409 });
  const config = qboConfig();
  const token = await accessToken(connection, config);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${apiBase(connection.environment)}/v3/company/${encodeURIComponent(connection.realmId)}${normalizedPath}`);
  url.searchParams.set("minorversion", config.minorVersion);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  if (options.requestId) {
    const requestId = options.requestId.trim();
    if (!requestId || requestId.length > 50) throw new QboApiError("QuickBooks request IDs must contain 1 to 50 characters.", { code: "QBO_INVALID_REQUEST_ID", status: 400 });
    url.searchParams.set("requestid", requestId);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new QboApiError("QuickBooks request timed out.", { code: "QBO_TIMEOUT", status: 408, retryable: true });
    throw new QboApiError(error instanceof Error ? error.message : "QuickBooks network request failed.", { code: "QBO_NETWORK", status: 503, retryable: true });
  } finally {
    clearTimeout(timeout);
  }
  const payload = await decodeResponse(response);
  if (response.status === 401 && options.retryOnAuth !== false) {
    await getD1().prepare("UPDATE qbo_connections SET access_token_expires_at='1970-01-01T00:00:00.000Z' WHERE id=?").bind(connectionId).run();
    return qboRequest(connectionId, path, { ...options, retryOnAuth: false });
  }
  if (response.status === 401) {
    await getD1().prepare("UPDATE qbo_connections SET status='reauthorization_required',last_error='QuickBooks rejected the refreshed access token.',updated_at=? WHERE id=?")
      .bind(new Date().toISOString(), connectionId).run();
  }
  if (!response.ok || payload.Fault) throw apiError(response, payload);
  return payload;
}

export async function qboQuery(connectionId: string, query: string) {
  return qboRequest(connectionId, "/query", { query: { query } });
}

export async function disconnectQbo(connectionId: string, actor: ActorIdentity) {
  const connection = await getQboConnection(connectionId);
  if (!connection) throw new QboApiError("QuickBooks connection was not found.", { code: "QBO_CONNECTION_NOT_FOUND", status: 404 });
  const config = qboConfig();
  let revokeWarning: string | null = null;
  try {
    const refreshToken = await decryptQboSecret(connection.encryptedRefreshToken, config.tokenEncryptionKey, tokenAssociatedData(connection.id, "refresh"));
    const response = await fetch(revokeEndpoint, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: refreshToken }),
    });
    if (!response.ok) revokeWarning = `Intuit token revocation returned HTTP ${response.status}.`;
  } catch (error) {
    revokeWarning = error instanceof Error ? error.message : String(error);
  }
  const now = new Date().toISOString();
  const destroyedAccess = await encryptQboSecret(`revoked-${randomUrlSafeString(32)}`, config.tokenEncryptionKey, tokenAssociatedData(connection.id, "access"));
  const destroyedRefresh = await encryptQboSecret(`revoked-${randomUrlSafeString(32)}`, config.tokenEncryptionKey, tokenAssociatedData(connection.id, "refresh"));
  await getD1().batch([
    getD1().prepare(`UPDATE qbo_connections SET status='disconnected',encrypted_access_token=?,encrypted_refresh_token=?,access_token_expires_at=?,refresh_token_expires_at=?,
      disconnected_at=?,updated_at=?,token_lock_owner=NULL,token_lock_until=NULL,last_error=?,version=version+1 WHERE id=?`)
      .bind(destroyedAccess, destroyedRefresh, now, now, now, now, revokeWarning, connectionId),
    getD1().prepare(`UPDATE qbo_sync_deliveries SET status='canceled',processed_at=?,last_error='Connection disconnected.' WHERE connection_id=? AND status IN ('pending','processing','failed')`)
      .bind(now, connectionId),
    getD1().prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      VALUES (?,'qbo_connection',?,'disconnected','QuickBooks connection disconnected.',?,?,?,?,?)`)
      .bind(`audit-qbo-${crypto.randomUUID()}`, connectionId, actor.label, actor.id, actor.email, JSON.stringify({ revokeWarning }), now),
  ]);
  return { disconnected: true, revokeWarning };
}
