import { InventoryApp } from "./inventory-app";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [, params] = await Promise.all([requireChatGPTUser("/"), searchParams]);
  const initialView = typeof params.view === "string" ? params.view : undefined;
  const initialTab = typeof params.tab === "string" ? params.tab : undefined;
  const initialPurchaseOrderId = typeof params.po === "string" ? params.po : undefined;
  const initialWorklistQuery = typeof params.number === "string" ? params.number : undefined;
  return <InventoryApp initialView={initialView} initialTab={initialTab} initialPurchaseOrderId={initialPurchaseOrderId} initialWorklistQuery={initialWorklistQuery} />;
}
