import {
  DomainError,
  createMovement,
  executeCommand,
  requireQuantity,
  requireText,
} from "./common.js";

const ON_HAND_KINDS = new Set([
  "internal",
  "receiving",
  "quarantine",
  "damaged",
  "staging",
  "in_transit",
  "returns",
]);
const USABLE_KINDS = new Set(["internal", "receiving", "staging"]);

function locationDefaults(location) {
  const kind = requireText(location.kind, "location.kind");
  return {
    id: requireText(location.id, "location.id"),
    kind,
    countsOnHand: location.countsOnHand ?? ON_HAND_KINDS.has(kind),
    usable: location.usable ?? USABLE_KINDS.has(kind),
  };
}

function balanceAt(state, productId, locationId) {
  return state.balances[productId]?.[locationId] ?? 0;
}

export function createInventoryLedger({ locations = [], openingBalances = [] } = {}) {
  const locationMap = Object.fromEntries(
    locations.map((location) => {
      const normalized = locationDefaults(location);
      return [normalized.id, normalized];
    }),
  );
  const balances = {};
  for (const opening of openingBalances) {
    const productId = requireText(opening.productId, "openingBalance.productId");
    const locationId = requireText(opening.locationId, "openingBalance.locationId");
    requireQuantity(opening.quantity, "openingBalance.quantity", { allowZero: true });
    if (!locationMap[locationId]) {
      throw new DomainError(
        "UNKNOWN_LOCATION",
        `Opening balance location ${locationId} is not defined.`,
        { locationId },
      );
    }
    balances[productId] = {
      ...(balances[productId] ?? {}),
      [locationId]: opening.quantity,
    };
  }
  return {
    kind: "inventory-ledger",
    locations: locationMap,
    balances,
    movements: [],
    version: 0,
    commandLog: {},
  };
}

export function movementBalance(movements) {
  const byProduct = {};
  let debits = 0;
  let credits = 0;
  for (const movement of movements) {
    requireQuantity(movement.quantity, "movement.quantity");
    byProduct[movement.productId] =
      (byProduct[movement.productId] ?? 0) - movement.quantity + movement.quantity;
    debits += movement.quantity;
    credits += movement.quantity;
  }
  return {
    debits,
    credits,
    net: credits - debits,
    netByProduct: byProduct,
    balanced:
      Math.abs(credits - debits) < 1e-9 &&
      Object.values(byProduct).every((quantity) => Math.abs(quantity) < 1e-9),
  };
}

function metricQuantity(state, productId, metric) {
  const productBalances = state.balances[productId] ?? {};
  return Object.entries(productBalances).reduce((total, [locationId, quantity]) => {
    return state.locations[locationId]?.[metric] ? total + quantity : total;
  }, 0);
}

export function getInventoryMetrics(state, productId, reservedQuantity = 0) {
  requireQuantity(reservedQuantity, "reservedQuantity", { allowZero: true });
  const onHandQuantity = metricQuantity(state, productId, "countsOnHand");
  const usableOnHandQuantity = metricQuantity(state, productId, "usable");
  return {
    onHandQuantity,
    usableOnHandQuantity,
    reservedQuantity,
    availableNowQuantity: usableOnHandQuantity - reservedQuantity,
  };
}

export function getLocationBalance(state, productId, locationId) {
  return balanceAt(state, productId, locationId);
}

export function postInventoryMovements(state, command) {
  return executeCommand(state, "post-inventory-movements", command, () => {
    if (!Array.isArray(command.movements) || command.movements.length === 0) {
      throw new DomainError(
        "MOVEMENTS_REQUIRED",
        "At least one inventory movement is required.",
      );
    }
    const movements = command.movements.map((movement) => createMovement(movement));
    if (command.allowNegative && !command.negativeOverrideReason) {
      throw new DomainError(
        "NEGATIVE_OVERRIDE_REASON_REQUIRED",
        "A reason is required to override negative inventory.",
      );
    }

    const priorIds = new Set(state.movements.map((movement) => movement.id));
    const batchIds = new Set();
    let locations = { ...state.locations };
    let balances = Object.fromEntries(
      Object.entries(state.balances).map(([productId, productBalances]) => [
        productId,
        { ...productBalances },
      ]),
    );

    const beforeByProduct = {};
    const afterByProduct = {};
    for (const movement of movements) {
      if (priorIds.has(movement.id) || batchIds.has(movement.id)) {
        throw new DomainError(
          "DUPLICATE_MOVEMENT",
          `Inventory movement ${movement.id} has already been posted.`,
          { movementId: movement.id },
        );
      }
      batchIds.add(movement.id);
      const source = locationDefaults(movement.source);
      const destination = locationDefaults(movement.destination);
      locations[source.id] = locations[source.id] ?? source;
      locations[destination.id] = locations[destination.id] ?? destination;

      if (beforeByProduct[movement.productId] === undefined) {
        beforeByProduct[movement.productId] = getInventoryMetrics(
          { ...state, locations },
          movement.productId,
        );
      }

      const productBalances = { ...(balances[movement.productId] ?? {}) };
      const sourceBefore = productBalances[source.id] ?? 0;
      const sourceAfter = sourceBefore - movement.quantity;
      const effectiveSource = locations[source.id];
      if (
        effectiveSource.countsOnHand &&
        sourceAfter < 0 &&
        !command.allowNegative
      ) {
        throw new DomainError(
          "NEGATIVE_INVENTORY_BLOCKED",
          `Posting would make ${movement.productId} negative at ${source.id}.`,
          {
            productId: movement.productId,
            locationId: source.id,
            availableQuantity: sourceBefore,
            requestedQuantity: movement.quantity,
          },
        );
      }
      productBalances[source.id] = sourceAfter;
      productBalances[destination.id] =
        (productBalances[destination.id] ?? 0) + movement.quantity;
      balances[movement.productId] = productBalances;
    }

    const next = { ...state, locations, balances };
    for (const productId of Object.keys(beforeByProduct)) {
      afterByProduct[productId] = getInventoryMetrics(next, productId);
    }
    return {
      state: {
        ...next,
        movements: [...state.movements, ...movements],
      },
      movements,
      impact: {
        onHandDeltaByProduct: Object.fromEntries(
          Object.keys(beforeByProduct).map((productId) => [
            productId,
            afterByProduct[productId].onHandQuantity -
              beforeByProduct[productId].onHandQuantity,
          ]),
        ),
        usableDeltaByProduct: Object.fromEntries(
          Object.keys(beforeByProduct).map((productId) => [
            productId,
            afterByProduct[productId].usableOnHandQuantity -
              beforeByProduct[productId].usableOnHandQuantity,
          ]),
        ),
        negativeOverride: Boolean(command.allowNegative),
      },
    };
  });
}

export function createInventoryCount({
  id,
  productId,
  locationId,
  bookQuantity,
  countedQuantity,
  locationKind = "internal",
}) {
  return {
    kind: "inventory-count",
    id: requireText(id, "id"),
    productId: requireText(productId, "productId"),
    locationId: requireText(locationId, "locationId"),
    locationKind,
    bookQuantity: requireQuantity(bookQuantity, "bookQuantity", { allowZero: true }),
    countedQuantity: requireQuantity(countedQuantity, "countedQuantity", {
      allowZero: true,
    }),
    status: "counted",
    postedAdjustmentQuantity: 0,
    version: 0,
    commandLog: {},
  };
}

export function deriveInventoryCount(count) {
  return {
    bookQuantity: count.bookQuantity,
    countedQuantity: count.countedQuantity,
    varianceQuantity: count.countedQuantity - count.bookQuantity,
    status: count.status,
  };
}

export function approveInventoryCount(count, command) {
  return executeCommand(count, "approve-inventory-count", command, () => {
    if (count.status !== "counted") {
      throw new DomainError(
        "COUNT_ALREADY_POSTED",
        "Only a counted, unposted inventory count can be approved.",
      );
    }
    const variance = count.countedQuantity - count.bookQuantity;
    if (variance !== 0) requireText(command.reason, "reason");
    const quantity = Math.abs(variance);
    const adjustment = {
      id: command.adjustmentLocationId ?? "INVENTORY-ADJUSTMENT",
      kind: "adjustment",
    };
    const countedLocation = { id: count.locationId, kind: count.locationKind };
    const movements =
      quantity === 0
        ? []
        : [
            createMovement({
              id: command.movementId ?? `count-adjustment:${command.idempotencyKey}`,
              type: "inventory-count-adjustment",
              productId: count.productId,
              quantity,
              source: variance > 0 ? adjustment : countedLocation,
              destination: variance > 0 ? countedLocation : adjustment,
              reference: { type: "inventory-count", id: count.id },
            }),
          ];
    return {
      state: {
        ...count,
        status: "posted",
        postedAdjustmentQuantity: variance,
      },
      movements,
      impact: {
        onHandDelta: variance,
        varianceQuantity: variance,
        message: "The count posts a movement for the variance; it does not overwrite history.",
      },
    };
  });
}
