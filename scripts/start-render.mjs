import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { env } from "./cloudflare-workers-render-stub.mjs";
import { applyRenderMigrations, LocalFileBucket, openRenderDatabase } from "./render-runtime.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const clientRoot = resolve(projectRoot, "dist", "client");
const serverEntry = resolve(projectRoot, "dist", "server", "index.js");

try {
  await access(serverEntry);
} catch {
  throw new Error("The Render server bundle is missing. Run `npm run build` before `npm run start:render`.");
}

const { database, filename, priorSize } = await openRenderDatabase({
  databaseUrl: process.env.DATABASE_URL,
  projectRoot,
});

try {
  await applyRenderMigrations(database, {
    migrationDirectory: resolve(projectRoot, "drizzle"),
    priorSize,
  });
} catch (error) {
  database.close();
  throw error;
}

const attachmentRoot = resolve(process.env.ATTACHMENTS_DIR?.trim() || resolve(filename, "..", "files"));
const fileBucket = new LocalFileBucket(attachmentRoot);

const workerEnvironmentKeys = [
  "ALLOW_LOCAL_DEV_AUTH", "BOOTSTRAP_DEMO_DATA", "GOOGLE_MAPS_API_KEY",
  "OUTBOX_WEBHOOK_URL", "OUTBOX_WEBHOOK_SECRET",
  "QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_TOKEN_ENCRYPTION_KEY", "QBO_REDIRECT_URI",
  "QBO_WEBHOOK_VERIFIER_TOKEN", "QBO_MINOR_VERSION",
  "HELCIM_API_TOKEN", "HELCIM_WEBHOOK_VERIFIER_TOKEN", "HELCIM_TOKEN_ENCRYPTION_KEY",
  "HELCIM_CHECKOUT_PAYMENT_METHODS", "HELCIM_PAYMENT_LINK_TTL_DAYS", "HELCIM_CHECKOUT_MODE",
  "HELCIM_INVOICE_HOST", "EMAIL_TOKEN_ENCRYPTION_KEY", "EMAIL_GOOGLE_CLIENT_ID",
  "EMAIL_GOOGLE_CLIENT_SECRET", "EMAIL_GOOGLE_REDIRECT_URI", "EMAIL_MICROSOFT_CLIENT_ID",
  "EMAIL_MICROSOFT_CLIENT_SECRET", "EMAIL_MICROSOFT_TENANT_ID", "EMAIL_MICROSOFT_REDIRECT_URI",
];

for (const key of workerEnvironmentKeys) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
env.DB = database;
env.FILES = fileBucket;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function clientPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "");
  if (!relative) return null;
  const target = resolve(clientRoot, relative);
  return target.startsWith(`${clientRoot}${sep}`) ? target : null;
}

async function assetResponse(request) {
  const pathname = new URL(request.url).pathname;
  const target = clientPath(pathname);
  if (!target) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readFile(target);
    return new Response(bytes, {
      headers: {
        "Content-Type": mimeTypes[extname(target).toLowerCase()] || "application/octet-stream",
        "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      },
    });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return new Response("Not found", { status: 404 });
    throw error;
  }
}

env.ASSETS = { fetch: assetResponse };
env.IMAGES = {
  input(body) {
    return {
      transform() {
        return {
          async output({ format }) {
            return { response: () => new Response(body, { headers: { "Content-Type": `image/${format || "webp"}` } }) };
          },
        };
      },
    };
  },
};

const { default: worker } = await import(pathToFileURL(serverEntry).href);
const port = Number.parseInt(process.env.PORT || "10000", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");

function cookieValue(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try { return decodeURIComponent(value.join("=")); } catch { return ""; }
  }
  return "";
}

async function authenticate(request) {
  const headers = new Headers(request.headers);
  headers.delete("oai-authenticated-user-id");
  headers.delete("oai-authenticated-user-email");
  headers.delete("oai-authenticated-user-full-name");
  headers.delete("oai-authenticated-user-full-name-encoding");
  headers.delete("x-paneflow-tenant-id");
  headers.delete("authorization");

  const token = cookieValue(request, "paneflow_session");
  if (!token) return new Request(request, { headers });
  const tokenHash = createHash("sha256").update(token).digest("base64url");
  const now = new Date().toISOString();
  const session = await database.prepare(`SELECT s.id AS sessionId,s.user_id AS userId,s.tenant_id AS sessionTenantId,s.last_seen_at AS lastSeenAt,
    u.email,u.full_name AS fullName,t.id AS tenantId,t.slug AS tenantSlug,t.name AS tenantName
    FROM app_sessions s
    JOIN app_users u ON u.user_id=s.user_id AND u.active=1
    JOIN tenant_memberships tm ON tm.user_id=s.user_id AND tm.tenant_id=s.tenant_id AND tm.active=1
    JOIN tenants t ON t.id=s.tenant_id AND t.status='active'
    WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(tokenHash, now).first();
  if (!session) return new Request(request, { headers });

  let tenant = { id: session.tenantId, slug: session.tenantSlug, name: session.tenantName };
  const requestedTenantId = cookieValue(request, "paneflow_tenant");
  if (requestedTenantId && requestedTenantId !== session.sessionTenantId) {
    const requested = await database.prepare(`SELECT t.id,t.slug,t.name FROM tenant_memberships tm
      JOIN tenants t ON t.id=tm.tenant_id AND t.status='active'
      WHERE tm.user_id=? AND tm.tenant_id=? AND tm.active=1 LIMIT 1`).bind(session.userId, requestedTenantId).first();
    if (requested) tenant = requested;
  }

  headers.set("oai-authenticated-user-id", session.userId);
  headers.set("oai-authenticated-user-email", String(session.email).toLowerCase());
  headers.set("oai-authenticated-user-full-name", encodeURIComponent(session.fullName));
  headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  headers.set("x-paneflow-tenant-id", tenant.id);
  if (new Date(session.lastSeenAt).getTime() < Date.now() - 15 * 60_000) {
    void database.prepare("UPDATE app_sessions SET last_seen_at=? WHERE id=?").bind(now, session.sessionId).run().catch(() => {});
  }
  return new Request(request, { headers });
}

function requestOrigin(request) {
  const forwarded = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwarded === "https" ? "https" : "http";
  const host = request.headers.host || `127.0.0.1:${port}`;
  return `${protocol}://${host}`;
}

function toFetchRequest(request) {
  const url = new URL(request.url || "/", requestOrigin(request));
  const init = { method: request.method, headers: request.headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeResponse(nodeResponse, response, method) {
  nodeResponse.statusCode = response.status;
  if (response.statusText) nodeResponse.statusMessage = response.statusText;
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") nodeResponse.setHeader(key, value);
  });
  if (cookies.length) nodeResponse.setHeader("set-cookie", cookies);
  if (method === "HEAD" || !response.body) {
    await response.body?.cancel();
    nodeResponse.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), nodeResponse);
}

const server = createServer(async (nodeRequest, nodeResponse) => {
  try {
    const request = toFetchRequest(nodeRequest);
    const pathname = new URL(request.url).pathname;

    if (pathname === "/healthz") {
      database.sqlite.prepare("SELECT 1").get();
      await writeResponse(nodeResponse, Response.json({ ok: true }), nodeRequest.method);
      return;
    }

    const staticTarget = clientPath(pathname);
    if (staticTarget) {
      try {
        await access(staticTarget);
        nodeResponse.statusCode = 200;
        nodeResponse.setHeader("Content-Type", mimeTypes[extname(staticTarget).toLowerCase()] || "application/octet-stream");
        nodeResponse.setHeader("Cache-Control", pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600");
        if (nodeRequest.method === "HEAD") nodeResponse.end();
        else await pipeline(createReadStream(staticTarget), nodeResponse);
        return;
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "EISDIR") throw error;
      }
    }

    const authenticated = await authenticate(request);

    const background = [];
    const context = {
      waitUntil(promise) { background.push(Promise.resolve(promise)); },
      passThroughOnException() {},
    };
    const response = await worker.fetch(authenticated, env, context);
    await writeResponse(nodeResponse, response, nodeRequest.method);
    if (background.length) void Promise.allSettled(background);
  } catch (error) {
    console.error("[render] Request failed.", error);
    if (!nodeResponse.headersSent) {
      nodeResponse.statusCode = 500;
      nodeResponse.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    nodeResponse.end("Internal server error");
  }
});

server.listen(port, "0.0.0.0", () => {
  const authMode = String(process.env.ALLOW_LOCAL_DEV_AUTH).toLowerCase() === "true" ? "UNSAFE local-development authentication" : "organization login and database sessions";
  console.info(`[render] PaneFlow listening on 0.0.0.0:${port}.`);
  console.info(`[render] Database: ${filename}`);
  console.info(`[render] Attachments: ${attachmentRoot}`);
  console.info(`[render] Authentication: ${authMode}`);
});

let scheduledRunning = false;
const scheduledTimer = setInterval(async () => {
  if (scheduledRunning || typeof worker.scheduled !== "function") return;
  scheduledRunning = true;
  try {
    await worker.scheduled({ scheduledTime: Date.now(), cron: "*/5 * * * *" }, env);
  } catch (error) {
    console.error("[render] Scheduled integration processing failed.", error);
  } finally {
    scheduledRunning = false;
  }
}, 5 * 60_000);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[render] Received ${signal}; shutting down.`);
  clearInterval(scheduledTimer);
  const forceTimer = setTimeout(() => process.exit(1), 25_000);
  forceTimer.unref();
  server.closeIdleConnections?.();
  await new Promise((resolveClose) => server.close(resolveClose));
  database.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
