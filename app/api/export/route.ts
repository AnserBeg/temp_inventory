import { authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { buildExport, type ExportType } from "@/lib/server/exports";

export const dynamic = "force-dynamic";
const allowed = new Set<ExportType>(["inventory","movements","purchase-orders","vendor-bills","customer-invoices","audit","accounting","quickbooks"]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const validIsoDate = (value: string) => isoDate.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

export async function GET(request: Request) {
  try {
    const actor=await resolveActor(request);requireCapability(actor,"export");
    const searchParams=new URL(request.url).searchParams;
    const type=searchParams.get("type") as ExportType;
    if(!allowed.has(type)) return Response.json({error:{code:"INVALID_EXPORT_TYPE",message:"type must be inventory, movements, purchase-orders, vendor-bills, customer-invoices, audit, accounting, or quickbooks."}},{status:400});
    if(["vendor-bills","customer-invoices","accounting","quickbooks"].includes(type)&&!["accounting","manager","administrator"].includes(actor.role)) throw new AuthorizationError("Financial exports require accounting, manager, or administrator access.");
    if(type==="audit"&&!["manager","administrator"].includes(actor.role)) throw new AuthorizationError("The full audit export requires manager or administrator access.");
    const from=searchParams.get("from")??"",to=searchParams.get("to")??"";
    if(["accounting","quickbooks"].includes(type)&&(!validIsoDate(from)||!validIsoDate(to)||from>to)) return Response.json({error:{code:"INVALID_EXPORT_RANGE",message:"Accounting exports require real calendar dates in YYYY-MM-DD format, with from on or before to."}},{status:400});
    const result=await buildExport(type,actor,["accounting","quickbooks"].includes(type)?{from,to}:undefined);
    return new Response(result.body,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="paneflow-${type}-${new Date().toISOString().slice(0,10)}.csv"`,"Cache-Control":"private, no-store","X-Export-Row-Count":String(result.rowCount)}});
  } catch(error){if(error instanceof AuthorizationError)return authorizationResponse(error);const message=error instanceof Error?error.message:"Export failed.";return Response.json({error:{code:"EXPORT_FAILED",message}},{status:500});}
}
