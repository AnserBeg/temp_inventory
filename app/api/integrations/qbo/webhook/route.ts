import { recordQboWebhook } from "@/lib/server/qbo-webhook";

export async function POST(request: Request) {
  try { return await recordQboWebhook(request); }
  catch (error) { return Response.json({ error: { code: "QBO_WEBHOOK_FAILED", message: error instanceof Error ? error.message : String(error) } }, { status: 500 }); }
}

