import { actorPayload, authorizationResponse, AuthorizationError, requireCapability, resolveActor } from "@/lib/server/auth";
import { DomainError, executeInventoryCommand, getCounterSaleHelcimTender, type CommandResult, type InventoryCommand } from "@/lib/server/inventory-domain";
import { createCounterSaleHelcimCheckout, HelcimPaymentError, requireHelcimCounterCardConfiguration } from "@/lib/server/helcim-payments";
import { PolicyError } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

type CounterCheckoutRequest = { invoiceId?: unknown; command?: InventoryCommand };

export async function POST(request: Request) {
  let postedSale: CommandResult | null = null;
  try {
    const actor = await resolveActor(request);
    requireCapability(actor, "operationalWrite");
    requireCapability(actor, "financialWrite");
    const input = await request.json() as CounterCheckoutRequest;
    let invoiceId = String(input.invoiceId ?? "").trim();
    if (!invoiceId) {
      await requireHelcimCounterCardConfiguration();
      const command = input.command;
      const normalized = command?.command?.trim().toLowerCase().replaceAll(/[_\s-]/gu, "");
      if (!command || (normalized !== "countersale" && normalized !== "postcountersale")) {
        return Response.json({ error: { code: "COUNTER_SALE_REQUIRED", message: "A counter-sale command or invoiceId is required." } }, { status: 400 });
      }
      await getCounterSaleHelcimTender(command);
      command.payload = {
        ...(command.payload ?? {}),
        settlement: "helcim_card",
        paymentMethod: undefined,
        paymentReference: undefined,
        ...actorPayload(actor),
      };
      postedSale = await executeInventoryCommand(command);
      invoiceId = postedSale.invoiceId ?? "";
      if (!invoiceId) throw new DomainError("COUNTER_SALE_INVOICE_MISSING", "The counter sale did not produce an invoice.", 500);
    }
    const checkout = await createCounterSaleHelcimCheckout(invoiceId, actor);
    return Response.json({ ...checkout, sale: postedSale }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const sale = postedSale ? { sale: postedSale } : {};
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    if (error instanceof PolicyError) return Response.json({ ...sale, error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof DomainError) return Response.json({ ...sale, error: { code: error.code, message: error.message, currentVersion: error.currentVersion } }, { status: error.status });
    if (error instanceof HelcimPaymentError) return Response.json({ ...sale, error: { code: error.code, message: error.message } }, { status: error.status });
    return Response.json({ ...sale, error: { code: "COUNTER_CARD_CHECKOUT_FAILED", message: error instanceof Error ? error.message : "Helcim card checkout could not be started." } }, { status: 500 });
  }
}
