import { env } from "cloudflare:workers";
import { hasCapability, type ActorIdentity } from "./auth";
import { all, first, getD1 } from "./inventory-db";
import { decryptEmailSecret, encryptEmailSecret, randomUrlSafeString, sha256Hex } from "./email-crypto";
import type { EmailConnectionState, EmailConnectionSummary, EmailProvider, EmailSenderType } from "./email-types";

const COMPANY_MAILBOX_OWNER = "__company__";

type ProviderConfig = {
  provider: EmailProvider;
  label: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  authorizeUrl: string;
  tokenUrl: string;
};

type StoredConnection = {
  userId: string;
  senderType: EmailSenderType;
  provider: EmailProvider;
  emailAddress: string;
  status: string;
  scopes: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: string;
  connectedAt: string;
  lastError: string | null;
};

type OAuthState = {
  userId: string;
  userEmail: string;
  userName: string;
  provider: EmailProvider;
  connectionType: EmailSenderType;
  returnTo: string;
  expiresAt: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export class EmailConfigurationError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = "EMAIL_NOT_CONFIGURED", status = 503) {
    super(message); this.code = code; this.status = status;
  }
}

export class EmailProviderError extends Error {
  code: string;
  status: number;
  detail?: string;
  constructor(message: string, code = "EMAIL_PROVIDER_ERROR", status = 502, detail?: string) {
    super(message); this.code = code; this.status = status; this.detail = detail;
  }
}

function runtimeValue(key: string) {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function encryptionSecret() {
  const secret = runtimeValue("EMAIL_TOKEN_ENCRYPTION_KEY");
  if (secret.length < 32) throw new EmailConfigurationError("Email sending requires EMAIL_TOKEN_ENCRYPTION_KEY with at least 32 characters.");
  return secret;
}

function callbackUrl(requestUrl: string, provider: EmailProvider) {
  const explicit = runtimeValue(provider === "google" ? "EMAIL_GOOGLE_REDIRECT_URI" : "EMAIL_MICROSOFT_REDIRECT_URI");
  return explicit || new URL(`/api/integrations/email/callback/${provider}`, requestUrl).toString();
}

function providerConfig(provider: EmailProvider, requestUrl: string): ProviderConfig {
  const google = provider === "google";
  const clientId = runtimeValue(google ? "EMAIL_GOOGLE_CLIENT_ID" : "EMAIL_MICROSOFT_CLIENT_ID");
  const clientSecret = runtimeValue(google ? "EMAIL_GOOGLE_CLIENT_SECRET" : "EMAIL_MICROSOFT_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new EmailConfigurationError(`${google ? "Google" : "Microsoft"} email OAuth is not configured.`);
  encryptionSecret();
  const tenant = runtimeValue("EMAIL_MICROSOFT_TENANT_ID") || "common";
  return google ? {
    provider, label: "Google Workspace / Gmail", clientId, clientSecret,
    redirectUri: callbackUrl(requestUrl, provider),
    scopes: "openid email https://www.googleapis.com/auth/gmail.send",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  } : {
    provider, label: "Microsoft 365 / Outlook", clientId, clientSecret,
    redirectUri: callbackUrl(requestUrl, provider),
    scopes: "openid profile email offline_access User.Read Mail.Send",
    authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
  };
}

function providerLabel(provider: EmailProvider) {
  return provider === "google" ? "Google Workspace / Gmail" : "Microsoft 365 / Outlook";
}

function safeReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value.slice(0, 2_000) : "/";
}

function connectionSql() {
  return `SELECT user_id AS userId,CASE WHEN user_id='${COMPANY_MAILBOX_OWNER}' THEN 'company' ELSE 'personal' END AS senderType,
    provider,email_address AS emailAddress,status,scopes,
    encrypted_access_token AS encryptedAccessToken,encrypted_refresh_token AS encryptedRefreshToken,
    access_token_expires_at AS accessTokenExpiresAt,connected_at AS connectedAt,last_error AS lastError
    FROM email_connections WHERE user_id=? LIMIT 1`;
}

export async function getEmailConnectionState(actor: ActorIdentity, requestUrl: string): Promise<EmailConnectionState> {
  const configuredProviders = (["google", "microsoft"] as EmailProvider[]).flatMap((provider) => {
    try { const config = providerConfig(provider, requestUrl); return [{ provider, label: config.label }]; }
    catch { return []; }
  });
  const [companyRow, personalRow, approvalSetting, approvedSetting] = await Promise.all([
    first<StoredConnection>(connectionSql(), COMPANY_MAILBOX_OWNER),
    first<StoredConnection>(connectionSql(), actor.id),
    first<{ valueJson: string }>("SELECT value_json AS valueJson FROM system_settings WHERE key='email.purchaseOrderApprovalRecipient'"),
    first<{ valueJson: string }>("SELECT value_json AS valueJson FROM system_settings WHERE key='email.purchaseOrderApprovedRecipients'"),
  ]);
  const summary = (row: StoredConnection | null): EmailConnectionSummary | null => row ? {
    senderType: row.senderType,
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    emailAddress: row.emailAddress,
    status: row.status,
    connectedAt: row.connectedAt,
    ...(row.lastError ? { lastError: row.lastError } : {}),
  } : null;
  const companyConnection = summary(companyRow);
  const personalConnection = summary(personalRow);
  const defaultSender: EmailSenderType | null = companyRow?.status === "connected"
    ? "company"
    : personalRow?.status === "connected" ? "personal" : null;
  let purchaseOrderApprovalEmail = "";
  let purchaseOrderApprovedEmails = "";
  try {
    const value = approvalSetting ? JSON.parse(approvalSetting.valueJson) : "";
    if (typeof value === "string") purchaseOrderApprovalEmail = value;
  } catch { /* A malformed setting is treated as unset and can be replaced from the UI. */ }
  try {
    const value = approvedSetting ? JSON.parse(approvedSetting.valueJson) : "";
    if (typeof value === "string") purchaseOrderApprovedEmails = value;
  } catch { /* A malformed setting is treated as unset and can be replaced from the UI. */ }
  return {
    configuredProviders,
    companyConnection,
    personalConnection,
    defaultSender,
    canManageCompany: hasCapability(actor, "administer"),
    purchaseOrderApprovalEmail,
    purchaseOrderApprovedEmails,
    connection: defaultSender === "company" ? companyConnection : defaultSender === "personal" ? personalConnection : null,
  };
}

function validEmailAddress(value: string) {
  return value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(value);
}

function normalizedEmailList(value: string) {
  const emails = [...new Set(value.split(/[;,]/u).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (emails.length > 20) throw new EmailProviderError("Enter no more than 20 approval notification addresses.", "TOO_MANY_APPROVED_PO_EMAILS", 400);
  if (emails.some((email) => !validEmailAddress(email))) {
    throw new EmailProviderError("Enter valid email addresses separated by commas.", "INVALID_APPROVED_PO_EMAIL", 400);
  }
  return emails.join(", ");
}

export async function setPurchaseOrderApprovalEmail(actor: ActorIdentity, value: string) {
  if (!hasCapability(actor, "administer")) {
    throw new EmailProviderError("Only a company administrator can change approval email alerts.", "COMPANY_EMAIL_FORBIDDEN", 403);
  }
  const emailAddress = value.trim().toLowerCase();
  if (emailAddress && !validEmailAddress(emailAddress)) {
    throw new EmailProviderError("Enter a valid email address for purchase-order approvals.", "INVALID_APPROVAL_EMAIL", 400);
  }
  const now = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO system_settings (key,value_json,description,version,updated_by,updated_at)
      VALUES ('email.purchaseOrderApprovalRecipient',?,'Receives an email when a purchase-order draft is created.',1,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,description=excluded.description,
        version=system_settings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(JSON.stringify(emailAddress), actor.label, now),
    db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      VALUES (?,'system_setting','email.purchaseOrderApprovalRecipient','approval_email_updated',?,?,?,?,?,?)`)
      .bind(`audit-email-${crypto.randomUUID()}`, emailAddress ? `Draft purchase-order approval alerts will be sent to ${emailAddress}.` : "Draft purchase-order approval alerts were turned off.", actor.label, actor.id, actor.email, JSON.stringify({ emailAddress }), now),
  ]);
  return { purchaseOrderApprovalEmail: emailAddress };
}

export async function setPurchaseOrderApprovedEmails(actor: ActorIdentity, value: string) {
  if (!hasCapability(actor, "administer")) {
    throw new EmailProviderError("Only a company administrator can change approved purchase-order alerts.", "COMPANY_EMAIL_FORBIDDEN", 403);
  }
  const emailAddresses = normalizedEmailList(value);
  const now = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO system_settings (key,value_json,description,version,updated_by,updated_at)
      VALUES ('email.purchaseOrderApprovedRecipients',?,'Additional recipients notified when a draft purchase order is approved.',1,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,description=excluded.description,
        version=system_settings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(JSON.stringify(emailAddresses), actor.label, now),
    db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      VALUES (?,'system_setting','email.purchaseOrderApprovedRecipients','approved_po_emails_updated',?,?,?,?,?,?)`)
      .bind(`audit-email-${crypto.randomUUID()}`, emailAddresses ? `Approved purchase-order alerts will also be sent to ${emailAddresses}.` : "Additional approved purchase-order alerts were turned off.", actor.label, actor.id, actor.email, JSON.stringify({ emailAddresses: emailAddresses ? emailAddresses.split(", ") : [] }), now),
  ]);
  return { purchaseOrderApprovedEmails: emailAddresses };
}

export async function createEmailAuthorizationUrl(actor: ActorIdentity, requestUrl: string, input: { provider: EmailProvider; senderType?: EmailSenderType; returnTo?: string }) {
  const senderType = input.senderType ?? "personal";
  if (senderType === "company" && !hasCapability(actor, "administer")) {
    throw new EmailProviderError("Only a company administrator can connect the company email.", "COMPANY_EMAIL_FORBIDDEN", 403);
  }
  const config = providerConfig(input.provider, requestUrl);
  const state = randomUrlSafeString(32);
  const stateHash = await sha256Hex(state);
  const now = new Date();
  const expires = new Date(now.valueOf() + 10 * 60_000);
  await getD1().batch([
    getD1().prepare("DELETE FROM email_oauth_states WHERE expires_at<=? OR consumed_at IS NOT NULL").bind(now.toISOString()),
    getD1().prepare(`INSERT INTO email_oauth_states
      (state_hash,user_id,user_email,user_name,provider,connection_type,return_to,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(stateHash, actor.id, actor.email, actor.name, input.provider, senderType, safeReturnTo(input.returnTo ?? "/"), now.toISOString(), expires.toISOString()),
  ]);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("state", state);
  if (senderType === "personal") url.searchParams.set("login_hint", actor.email);
  if (input.provider === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
  } else {
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("prompt", "select_account");
  }
  return { authorizationUrl: url.toString() };
}

async function parseProviderResponse(response: Response, context: string) {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* provider returned non-JSON */ }
  if (!response.ok) {
    const detail = String(body.error_description ?? body.error?.toString() ?? text).slice(0, 1_000);
    throw new EmailProviderError(`${context} failed.`, "EMAIL_PROVIDER_REJECTED", response.status, detail);
  }
  return body;
}

async function exchangeCode(config: ProviderConfig, code: string) {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.redirectUri, grant_type: "authorization_code" }),
  });
  return await parseProviderResponse(response, "Email authorization") as TokenResponse;
}

async function mailboxAddress(provider: EmailProvider, accessToken: string) {
  const url = provider === "google"
    ? "https://www.googleapis.com/oauth2/v3/userinfo"
    : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
  const body = await parseProviderResponse(await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } }), "Mailbox lookup");
  const email = String(provider === "google" ? body.email ?? "" : body.mail ?? body.userPrincipalName ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new EmailProviderError("The provider did not return a usable mailbox address.", "EMAIL_ADDRESS_UNAVAILABLE", 409);
  return email;
}

export async function completeEmailAuthorization(requestUrl: string, input: { provider: EmailProvider; state: string; code: string }) {
  const stateHash = await sha256Hex(input.state);
  const now = new Date().toISOString();
  const state = await first<OAuthState>(`SELECT user_id AS userId,user_email AS userEmail,user_name AS userName,provider,
    connection_type AS connectionType,return_to AS returnTo,expires_at AS expiresAt
    FROM email_oauth_states WHERE state_hash=? AND consumed_at IS NULL AND expires_at>? LIMIT 1`, stateHash, now);
  if (!state || state.provider !== input.provider) throw new EmailProviderError("This email authorization expired or was already used.", "EMAIL_OAUTH_STATE_INVALID", 400);
  const claim = await getD1().prepare("UPDATE email_oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL").bind(now, stateHash).run();
  if (Number(claim.meta?.changes ?? 0) !== 1) throw new EmailProviderError("This email authorization expired or was already used.", "EMAIL_OAUTH_STATE_INVALID", 400);

  const config = providerConfig(input.provider, requestUrl);
  const tokens = await exchangeCode(config, input.code);
  if (!tokens.access_token || !tokens.refresh_token) throw new EmailProviderError("The provider did not issue the offline mailbox access required for sending. Reconnect and grant all requested permissions.", "EMAIL_REFRESH_TOKEN_MISSING", 409);
  const emailAddress = await mailboxAddress(input.provider, tokens.access_token);
  const senderType = state.connectionType ?? "personal";
  const ownerId = senderType === "company" ? COMPANY_MAILBOX_OWNER : state.userId;
  const owner = await first<{ userId: string }>("SELECT user_id AS userId FROM email_connections WHERE provider=? AND email_address=? AND user_id<>? LIMIT 1", input.provider, emailAddress, ownerId);
  if (owner) throw new EmailProviderError("That mailbox is already connected as another sender for this company.", "EMAIL_ALREADY_CONNECTED", 409);
  const secret = encryptionSecret();
  const accessData = `email:${ownerId}:${input.provider}:access`;
  const refreshData = `email:${ownerId}:${input.provider}:refresh`;
  const encryptedAccess = await encryptEmailSecret(tokens.access_token, secret, accessData);
  const encryptedRefresh = await encryptEmailSecret(tokens.refresh_token, secret, refreshData);
  const expiresAt = new Date(Date.now() + Math.max(Number(tokens.expires_in ?? 3_600), 60) * 1_000).toISOString();
  const actorLabel = `${state.userName} <${state.userEmail}>`;
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO email_connections
      (user_id,provider,email_address,status,scopes,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,connected_at,updated_at,disconnected_at,last_error,version)
      VALUES (?,?,?,'connected',?,?,?,?,?,?,NULL,NULL,1)
      ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,email_address=excluded.email_address,status='connected',scopes=excluded.scopes,
      encrypted_access_token=excluded.encrypted_access_token,encrypted_refresh_token=excluded.encrypted_refresh_token,
      access_token_expires_at=excluded.access_token_expires_at,connected_at=excluded.connected_at,updated_at=excluded.updated_at,
      disconnected_at=NULL,last_error=NULL,version=email_connections.version+1`)
      .bind(ownerId, input.provider, emailAddress, tokens.scope ?? config.scopes, encryptedAccess, encryptedRefresh, expiresAt, now, now),
    db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      VALUES (?,'email_connection',?,'email_connected',?,?,?,?,?,?)`)
      .bind(`audit-email-${crypto.randomUUID()}`, ownerId, `${senderType === "company" ? "Company" : "Personal"} ${providerLabel(input.provider)} mailbox connected.`, actorLabel, state.userId, state.userEmail, JSON.stringify({ provider: input.provider, emailAddress, senderType }), now),
    db.prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at)
      VALUES (?,'email.mailbox_connected','email_connection',?,?,'pending',0,?,?)`)
      .bind(`outbox-email-${crypto.randomUUID()}`, ownerId, JSON.stringify({ userId: state.userId, provider: input.provider, emailAddress, senderType }), now, now),
  ]);
  return { returnTo: safeReturnTo(state.returnTo), emailAddress, provider: input.provider, senderType };
}

async function refreshAccessToken(connection: StoredConnection) {
  const config = providerConfig(connection.provider, "https://local.invalid/");
  const secret = encryptionSecret();
  const refreshToken = await decryptEmailSecret(connection.encryptedRefreshToken, secret, `email:${connection.userId}:${connection.provider}:refresh`);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token", scope: config.scopes }),
  });
  const tokens = await parseProviderResponse(response, "Email access refresh") as TokenResponse;
  if (!tokens.access_token) throw new EmailProviderError("The provider did not return a refreshed access token.", "EMAIL_REFRESH_FAILED", 401);
  const nextRefresh = tokens.refresh_token ?? refreshToken;
  const encryptedAccess = await encryptEmailSecret(tokens.access_token, secret, `email:${connection.userId}:${connection.provider}:access`);
  const encryptedRefresh = await encryptEmailSecret(nextRefresh, secret, `email:${connection.userId}:${connection.provider}:refresh`);
  const expiresAt = new Date(Date.now() + Math.max(Number(tokens.expires_in ?? 3_600), 60) * 1_000).toISOString();
  await getD1().prepare(`UPDATE email_connections SET encrypted_access_token=?,encrypted_refresh_token=?,access_token_expires_at=?,
    scopes=?,status='connected',last_error=NULL,updated_at=?,version=version+1 WHERE user_id=?`)
    .bind(encryptedAccess, encryptedRefresh, expiresAt, tokens.scope ?? connection.scopes, new Date().toISOString(), connection.userId).run();
  return tokens.access_token;
}

async function accessToken(connection: StoredConnection, forceRefresh = false) {
  if (!forceRefresh && new Date(connection.accessTokenExpiresAt).valueOf() > Date.now() + 60_000) {
    return decryptEmailSecret(connection.encryptedAccessToken, encryptionSecret(), `email:${connection.userId}:${connection.provider}:access`);
  }
  try { return await refreshAccessToken(connection); }
  catch (error) {
    await getD1().prepare("UPDATE email_connections SET status='reauthorization_required',last_error=?,updated_at=?,version=version+1 WHERE user_id=?")
      .bind(error instanceof Error ? error.message.slice(0, 1_000) : "Email access refresh failed.", new Date().toISOString(), connection.userId).run();
    throw error;
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    value += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(value);
}

function utf8Base64(value: string) {
  return bytesToBase64(new TextEncoder().encode(value));
}

function encodedHeader(value: string) {
  return `=?UTF-8?B?${utf8Base64(value)}?=`;
}

type OutboundEmail = { recipients: string[]; subject: string; htmlBody: string; fileName?: string; pdf?: Uint8Array };

function mimeMessage(input: OutboundEmail & { sender: string }) {
  if (!input.fileName || !input.pdf) return [
    `From: ${input.sender}`,
    `To: ${input.recipients.join(", ")}`,
    `Subject: ${encodedHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(input.htmlBody).replace(/.{1,76}/g, "$&\r\n").trim(),
    "",
  ].join("\r\n");
  const boundary = `paneflow-${crypto.randomUUID()}`;
  const attachment = bytesToBase64(input.pdf).replace(/.{1,76}/g, "$&\r\n").trim();
  return [
    `From: ${input.sender}`,
    `To: ${input.recipients.join(", ")}`,
    `Subject: ${encodedHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(input.htmlBody).replace(/.{1,76}/g, "$&\r\n").trim(),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${input.fileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${input.fileName}"`,
    "",
    attachment,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function providerSend(connection: StoredConnection, token: string, input: OutboundEmail) {
  if (connection.provider === "google") {
    const raw = utf8Base64(mimeMessage({ sender: connection.emailAddress, ...input })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ raw }),
    });
    if (response.status === 401) return { unauthorized: true as const };
    const body = await parseProviderResponse(response, "Gmail send");
    return { unauthorized: false as const, messageId: String(body.id ?? response.headers.get("x-request-id") ?? "") };
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ message: {
      subject: input.subject,
      body: { contentType: "HTML", content: input.htmlBody },
      toRecipients: input.recipients.map((address) => ({ emailAddress: { address } })),
      ...(input.fileName && input.pdf ? { attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: input.fileName, contentType: "application/pdf", contentBytes: bytesToBase64(input.pdf) }] } : {}),
    }, saveToSentItems: true }),
  });
  if (response.status === 401) return { unauthorized: true as const };
  await parseProviderResponse(response, "Microsoft send");
  return { unauthorized: false as const, messageId: response.headers.get("request-id") ?? response.headers.get("client-request-id") ?? "" };
}

async function selectedConnection(actor: ActorIdentity, senderType?: EmailSenderType) {
  const requestedOwner = senderType === "company" ? COMPANY_MAILBOX_OWNER : senderType === "personal" ? actor.id : "";
  if (requestedOwner) {
    const requested = await first<StoredConnection>(connectionSql(), requestedOwner);
    if (!requested || requested.status !== "connected") {
      const label = senderType === "company" ? "company email" : "personal email";
      throw new EmailProviderError(`Connect the ${label} before sending a document.`, "EMAIL_NOT_CONNECTED", 409);
    }
    return requested;
  }
  const company = await first<StoredConnection>(connectionSql(), COMPANY_MAILBOX_OWNER);
  if (company?.status === "connected") return company;
  const personal = await first<StoredConnection>(connectionSql(), actor.id);
  if (personal?.status === "connected") return personal;
  throw new EmailProviderError("Set up a company or personal email before sending a document.", "EMAIL_NOT_CONNECTED", 409);
}

export async function getEmailSender(actor: ActorIdentity, senderType?: EmailSenderType) {
  const connection = await selectedConnection(actor, senderType);
  return { provider: connection.provider, senderEmail: connection.emailAddress, senderType: connection.senderType };
}

async function sendWithConnection(connection: StoredConnection, input: OutboundEmail) {
  let token = await accessToken(connection);
  let result = await providerSend(connection, token, input);
  if (result.unauthorized) {
    token = await accessToken(connection, true);
    result = await providerSend(connection, token, input);
  }
  if (result.unauthorized) {
    await getD1().prepare("UPDATE email_connections SET status='reauthorization_required',last_error='The provider rejected mailbox access.',updated_at=?,version=version+1 WHERE user_id=?")
      .bind(new Date().toISOString(), connection.userId).run();
    throw new EmailProviderError(`${connection.senderType === "company" ? "The company email" : "Your email"} needs to be authorized again.`, "EMAIL_REAUTHORIZATION_REQUIRED", 401);
  }
  return { provider: connection.provider, senderEmail: connection.emailAddress, senderType: connection.senderType, messageId: result.messageId };
}

export async function sendWithConnectedMailbox(actor: ActorIdentity, input: OutboundEmail, senderType?: EmailSenderType) {
  return sendWithConnection(await selectedConnection(actor, senderType), input);
}

/** System notifications always use the tenant's shared company sender, never a user's mailbox. */
export async function sendWithCompanyMailbox(input: OutboundEmail) {
  if (!input.recipients.length || input.recipients.some((recipient) => !validEmailAddress(recipient))) {
    throw new EmailProviderError("The system notification recipient is invalid.", "INVALID_EMAIL_RECIPIENT", 400);
  }
  if (!input.subject.trim() || /[\r\n]/u.test(input.subject)) {
    throw new EmailProviderError("The system notification subject is invalid.", "INVALID_EMAIL_SUBJECT", 400);
  }
  const connection = await first<StoredConnection>(connectionSql(), COMPANY_MAILBOX_OWNER);
  if (!connection || connection.status !== "connected") {
    throw new EmailProviderError("Connect the company email before system notifications can be sent.", "COMPANY_EMAIL_NOT_CONNECTED", 409);
  }
  return sendWithConnection(connection, input);
}

export async function disconnectEmail(actor: ActorIdentity, senderType: EmailSenderType = "personal") {
  if (senderType === "company" && !hasCapability(actor, "administer")) {
    throw new EmailProviderError("Only a company administrator can disconnect the company email.", "COMPANY_EMAIL_FORBIDDEN", 403);
  }
  const ownerId = senderType === "company" ? COMPANY_MAILBOX_OWNER : actor.id;
  const connection = await first<StoredConnection>(connectionSql(), ownerId);
  if (!connection) return { disconnected: true };
  if (connection.provider === "google") {
    try {
      const refresh = await decryptEmailSecret(connection.encryptedRefreshToken, encryptionSecret(), `email:${connection.userId}:${connection.provider}:refresh`);
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refresh }) });
    } catch { /* Local deletion still prevents PaneFlow from using the mailbox. */ }
  }
  const now = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM email_connections WHERE user_id=?").bind(ownerId),
    db.prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at)
      VALUES (?,'email_connection',?,'email_disconnected',?,?,?,?,?,?)`)
      .bind(`audit-email-${crypto.randomUUID()}`, ownerId, `${senderType === "company" ? "Company" : "Personal"} ${providerLabel(connection.provider)} mailbox disconnected.`, actor.label, actor.id, actor.email, JSON.stringify({ provider: connection.provider, emailAddress: connection.emailAddress, senderType }), now),
  ]);
  return { disconnected: true };
}

export async function listRecentEmailDeliveries(actor: ActorIdentity, limit = 20) {
  return all<Record<string, unknown>>(`SELECT id,provider,sender_type AS senderType,sender_email AS senderEmail,document_type AS documentType,document_id AS documentId,
    document_number AS documentNumber,recipients_json AS recipientsJson,subject,status,provider_message_id AS providerMessageId,
    last_error AS lastError,created_at AS createdAt,sent_at AS sentAt
    FROM document_email_deliveries WHERE user_id=? ORDER BY created_at DESC LIMIT ?`, actor.id, Math.min(Math.max(limit, 1), 100));
}
