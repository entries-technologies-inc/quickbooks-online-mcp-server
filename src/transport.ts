import type { QueryDefaults } from "./query-defaults.js";

// Semantic operation carried beside the raw HTTP request so transport
// middleware can tell reads from writes without parsing the path.
// `entity` is the Intuit entity name (Bill, BillPayment), not the URL slug.
export type QboOperation =
  | {
      kind: "get" | "query" | "create" | "update" | "delete" | "void";
      entity: string;
    }
  | { kind: "report"; report: string };

export type QboHttpRequest = {
  op: QboOperation;
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  accept?: string;
};

export type QboHttpResponse = {
  status: number;
  body: unknown;
  /**
   * Response headers, when the transport has them. `withRetry` reads
   * `Retry-After` from this map (names are matched case-insensitively).
   */
  headers?: Record<string, string>;
};

export type QboCallContext = {
  realmId: string;
  transport: Transport;
  accessToken?: string;
  isSandbox?: boolean;
  baseUrl?: string;
  queryDefaults?: QueryDefaults;
};

export type Transport = (
  request: QboHttpRequest,
  context: QboCallContext,
) => Promise<QboHttpResponse>;

export type TransportMiddleware = (next: Transport) => Transport;
