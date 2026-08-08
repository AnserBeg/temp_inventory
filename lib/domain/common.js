/**
 * A business-rule failure with a stable machine-readable code.
 */
export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainError(
      "INVALID_COMMAND",
      `${field} is required.`,
      { field },
    );
  }
  return value.trim();
}

export function requireQuantity(value, field = "quantity", options = {}) {
  const { allowZero = false } = options;
  const minimum = allowZero ? 0 : Number.EPSILON;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new DomainError(
      "INVALID_QUANTITY",
      `${field} must be a finite ${allowZero ? "non-negative" : "positive"} number.`,
      { field, value },
    );
  }
  return value;
}

export function assertAtMost(value, maximum, code, message, details = {}) {
  if (value > maximum) {
    throw new DomainError(code, message, { ...details, value, maximum });
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function commandFingerprint(commandName, command) {
  const payload = { ...command };
  delete payload.idempotencyKey;
  delete payload.expectedVersion;
  return JSON.stringify(stableValue({ commandName, payload }));
}

/**
 * Runs a pure aggregate command with optimistic concurrency and idempotency.
 * A replay produces no movements, so callers cannot accidentally post stock twice.
 */
export function executeCommand(state, commandName, command, perform) {
  const idempotencyKey = requireText(command.idempotencyKey, "idempotencyKey");
  const fingerprint = commandFingerprint(commandName, command);
  const previous = state.commandLog?.[idempotencyKey];

  // Check idempotency before version: a successful retry carries the original version.
  if (previous) {
    if (previous.fingerprint !== fingerprint) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for a different command payload.",
        { idempotencyKey, commandName },
      );
    }
    return {
      state,
      movements: [],
      impact: { ...previous.impact, replayed: true, applied: false },
      duplicate: true,
    };
  }

  if (
    command.expectedVersion !== undefined &&
    command.expectedVersion !== state.version
  ) {
    throw new DomainError(
      "VERSION_CONFLICT",
      `Expected version ${command.expectedVersion}, but the record is at version ${state.version}.`,
      { expectedVersion: command.expectedVersion, currentVersion: state.version },
    );
  }

  const result = perform();
  const impact = { ...result.impact, replayed: false, applied: true };
  const nextState = {
    ...result.state,
    version: state.version + 1,
    commandLog: {
      ...(state.commandLog ?? {}),
      [idempotencyKey]: { fingerprint, commandName, impact },
    },
  };

  return {
    state: nextState,
    movements: result.movements ?? [],
    impact,
    duplicate: false,
  };
}

export function createMovement({
  id,
  type,
  productId,
  quantity,
  source,
  destination,
  reference,
}) {
  requireText(id, "movement.id");
  requireText(type, "movement.type");
  requireText(productId, "movement.productId");
  requireQuantity(quantity, "movement.quantity");
  if (!source?.id || !source?.kind || !destination?.id || !destination?.kind) {
    throw new DomainError(
      "INVALID_MOVEMENT",
      "A movement requires typed source and destination locations.",
    );
  }
  if (source.id === destination.id) {
    throw new DomainError(
      "INVALID_MOVEMENT",
      "A movement source and destination must be different.",
      { locationId: source.id },
    );
  }
  return Object.freeze({
    id,
    type,
    productId,
    quantity,
    source: Object.freeze({ ...source }),
    destination: Object.freeze({ ...destination }),
    reference: reference ? Object.freeze({ ...reference }) : undefined,
  });
}
