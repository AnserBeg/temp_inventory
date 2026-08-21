export type QboEnvironment = "sandbox" | "production";
export type QboConnectionStatus = "connected" | "disconnected" | "error" | "reauthorization_required";
export type QboDeliveryStatus = "pending" | "processing" | "succeeded" | "failed" | "conflict" | "canceled";
export type QboOperation = "upsert" | "void" | "deactivate" | "reconcile";

export type QboRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  tokenEncryptionKey: string;
  redirectUri: string;
  webhookVerifierToken?: string;
  minorVersion: string;
};

export type QboConnection = {
  id: string;
  realmId: string;
  environment: QboEnvironment;
  status: QboConnectionStatus;
  companyName: string;
  country: string;
  homeCurrency: string;
  scopes: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string | null;
  syncFrom: string;
  initialSyncStatus: "not_started" | "queued" | "running" | "completed" | "failed";
  tokenLockOwner: string | null;
  tokenLockUntil: string | null;
  connectedBy: string;
  connectedAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
  lastError: string | null;
  version: number;
};

export type QboEntityLink = {
  id: string;
  connectionId: string;
  localEntityType: string;
  localEntityId: string;
  qboEntityType: string;
  qboEntityId: string;
  qboSyncToken: string;
  localVersion: number | null;
  sourceHash: string | null;
  qboLastUpdatedAt: string | null;
  status: string;
  lastSyncedAt: string;
  lastError: string | null;
};

export type QboDelivery = {
  id: string;
  connectionId: string;
  outboxEventId: string | null;
  dedupeKey: string;
  localEntityType: string;
  localEntityId: string;
  operation: QboOperation;
  sourceVersion: number | null;
  payloadJson: string;
  status: QboDeliveryStatus;
  attempts: number;
  availableAt: string;
  lockedAt: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  qboEntityType: string | null;
  qboEntityId: string | null;
  requestHash: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type QboReference = { value: string; name?: string };

export type QboFault = {
  Error?: Array<{ Message?: string; Detail?: string; code?: string; element?: string }>;
  type?: string;
};

export type QboApiEnvelope = {
  Fault?: QboFault;
  QueryResponse?: Record<string, unknown>;
  time?: string;
  [key: string]: unknown;
};

export type QboTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
};

export type QboMappedEntity = {
  qboEntityType: string;
  body: Record<string, unknown>;
  localVersion?: number | null;
  sourceHash: string;
};

export type QboAccountMapping = {
  logicalKey: string;
  qboAccountId: string;
  qboAccountName: string;
  qboAccountType: string;
  active: number;
};

export type QboReferenceMapping = {
  mappingType: string;
  localValue: string;
  qboEntityId: string;
  qboEntityName: string;
  metadataJson: string;
  active: number;
};

export type QboMappingContext = {
  accounts: Map<string, QboAccountMapping>;
  references: Map<string, QboReferenceMapping>;
  links: Map<string, QboEntityLink>;
};

export type QboRequestOptions = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  requestId?: string;
  timeoutMs?: number;
  retryOnAuth?: boolean;
};

export type QboProcessResult = {
  projected: number;
  attempted: number;
  succeeded: number;
  failed: number;
  conflicts: number;
  deferred: number;
};
