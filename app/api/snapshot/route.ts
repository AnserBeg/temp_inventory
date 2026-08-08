import { getInventorySnapshot } from "@/lib/server/inventory-domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getInventorySnapshot();
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load inventory.";
    return Response.json({ error: { code: "SNAPSHOT_FAILED", message } }, { status: 500 });
  }
}
