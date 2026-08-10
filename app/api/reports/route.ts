import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { arAging, customerStatement, isReportType, openOrdersByCustomer, replenishmentWorklist } from "@/lib/server/reports";

export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const validIsoDate = (value: string) => isoDate.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "read");
    const searchParams = new URL(request.url).searchParams;
    const type = searchParams.get("type");
    if (!isReportType(type)) {
      return Response.json({ error: { code: "INVALID_REPORT_TYPE", message: "type must be ar-aging, customer-statement, open-orders, or replenishment." } }, { status: 400 });
    }
    // Receivables detail is financial data, so it follows the same roles as financial exports.
    if ((type === "ar-aging" || type === "customer-statement") && !["accounting", "manager", "administrator"].includes(actor.role)) {
      throw new AuthorizationError("Receivables reports require accounting, manager, or administrator access.");
    }
    const asOfParam = searchParams.get("asOf") ?? "";
    if (asOfParam && !validIsoDate(asOfParam)) {
      return Response.json({ error: { code: "INVALID_REPORT_DATE", message: "asOf must be a real calendar date in YYYY-MM-DD format." } }, { status: 400 });
    }
    const asOf = asOfParam || new Date().toISOString().slice(0, 10);

    const report = type === "ar-aging" ? await arAging(asOf)
      : type === "customer-statement" ? await customerStatement(searchParams.get("partnerId") ?? "", asOf)
      : type === "open-orders" ? await openOrdersByCustomer()
      : await replenishmentWorklist(searchParams.get("warehouseId") ?? "");

    return Response.json({ type, ...report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    const message = error instanceof Error ? error.message : "The report could not be produced.";
    return Response.json({ error: { code: "REPORT_FAILED", message } }, { status: 500 });
  }
}
