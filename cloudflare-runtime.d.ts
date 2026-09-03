type D1Value = unknown;

interface D1Result<T = unknown> {
  success: boolean;
  results: T[];
  meta?: Record<string, unknown>;
  error?: string;
}

interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
  exec(query: string): Promise<D1Result>;
}

interface R2ObjectBody {
  body: ReadableStream<Uint8Array>;
}

interface R2Bucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    FILES?: R2Bucket;
    ALLOW_LOCAL_DEV_AUTH?: string;
    BOOTSTRAP_DEMO_DATA?: string;
    ENVIRONMENT?: string;
    GOOGLE_MAPS_API_KEY?: string;
    [key: string]: unknown;
  };
}
