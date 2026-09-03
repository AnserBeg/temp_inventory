import { HelcimPaymentError, processHelcimIntegrationBatch, recordHelcimWebhook } from "@/lib/server/helcim-payments";
import { runWithTenant } from "@/lib/server/tenancy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const accepted = await recordHelcimWebhook(request);
    if (accepted.tenantId) try { await runWithTenant({ tenantId: accepted.tenantId }, () => processHelcimIntegrationBatch(10)); } catch { /* durable webhook processing continues on the schedule */ }
    return Response.json({ accepted: accepted.accepted, duplicate: accepted.duplicate, unmatched: accepted.unmatched }, { status: accepted.duplicate || accepted.unmatched ? 200 : 202 });
  } catch (error) {
    if (error instanceof HelcimPaymentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    return Response.json({ error: { code: "HELCIM_WEBHOOK_FAILED", message: "The webhook could not be accepted." } }, { status: 500 });
  }
}
