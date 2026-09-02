import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { processOutboxBatch } from "@/lib/server/outbox";
import { processQboSyncBatch } from "@/lib/server/qbo-sync";
import { processQboWebhookBatch } from "@/lib/server/qbo-webhook";
import { processHelcimIntegrationBatch } from "@/lib/server/helcim-payments";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  OUTBOX_WEBHOOK_URL?: string;
  OUTBOX_WEBHOOK_SECRET?: string;
  QBO_CLIENT_ID?: string;
  QBO_CLIENT_SECRET?: string;
  QBO_TOKEN_ENCRYPTION_KEY?: string;
  QBO_REDIRECT_URI?: string;
  QBO_WEBHOOK_VERIFIER_TOKEN?: string;
  QBO_MINOR_VERSION?: string;
  HELCIM_API_TOKEN?: string;
  HELCIM_WEBHOOK_VERIFIER_TOKEN?: string;
  HELCIM_TOKEN_ENCRYPTION_KEY?: string;
  HELCIM_CHECKOUT_PAYMENT_METHODS?: string;
  HELCIM_PAYMENT_LINK_TTL_DAYS?: string;
  HELCIM_CHECKOUT_MODE?: string;
  HELCIM_INVOICE_HOST?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(): Promise<void> {
    const results = await Promise.allSettled([
      processOutboxBatch({ limit: 100 }),
      processQboWebhookBatch(100),
      processQboSyncBatch({ limit: 100 }),
      processHelcimIntegrationBatch(100),
    ]);
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) {
      console.error("Scheduled integration processing failed.", ...failures);
      throw new AggregateError(failures, `${failures.length} scheduled integration processor(s) failed.`);
    }
  },
};

export default worker;
