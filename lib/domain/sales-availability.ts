export type SalesAvailability = {
  required: number;
  reserved: number;
  uncovered: number;
  availableNow: number;
  incomingBeforeDate: number;
  shortage: number;
};

const nonNegative = (value: number) => Number.isFinite(value) ? Math.max(value, 0) : 0;

/**
 * Split open sales demand into stock that is already committed to this order, stock that is
 * still free to reserve, qualifying incoming supply, and the genuinely uncovered remainder.
 * "Available now" intentionally excludes reservations so the same unit cannot be promised to
 * another order; the reservation must therefore cover demand before a shortage is calculated.
 */
export function calculateSalesAvailability(
  openQuantity: number,
  reservedQuantity: number,
  availableQuantity: number,
  incomingQuantity: number,
): SalesAvailability {
  const required = nonNegative(openQuantity);
  const reserved = Math.min(required, nonNegative(reservedQuantity));
  const uncovered = Math.max(required - reserved, 0);
  const availableNow = Math.min(uncovered, nonNegative(availableQuantity));
  const incomingBeforeDate = Math.min(
    Math.max(uncovered - availableNow, 0),
    nonNegative(incomingQuantity),
  );
  const shortage = Math.max(uncovered - availableNow - incomingBeforeDate, 0);

  return { required, reserved, uncovered, availableNow, incomingBeforeDate, shortage };
}
