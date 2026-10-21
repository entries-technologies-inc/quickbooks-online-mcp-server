import { randomUUID } from "node:crypto";
import type {
  QboHttpResponse,
  QboOperation,
  Transport,
  TransportMiddleware,
} from "./transport.js";

const WRITE_KINDS = new Set<QboOperation["kind"]>([
  "create",
  "update",
  "delete",
  "void",
]);

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export type WithRequestIdOptions = {
  /** Used instead of `crypto.randomUUID` when a write has no request id. */
  generate?: () => string;
};

export type WithRetryOptions = {
  /** Attempts including the first call. Default 3. */
  maxAttempts?: number;
  /** First exponential step, in milliseconds, before jitter. Default 250. */
  baseDelayMs?: number;
  /** Cap for backoff and for `Retry-After`. Default 10_000. */
  maxDelayMs?: number;
  /** Completed responses retry only when this returns true. */
  retryOn?: (status: number) => boolean;
  /** Used instead of `setTimeout`. Tests record the delay here. */
  sleep?: (ms: number) => Promise<void>;
};

function isWrite(kind: QboOperation["kind"]): boolean {
  return WRITE_KINDS.has(kind);
}

function defaultRetryOn(status: number): boolean {
  return RETRY_STATUSES.has(status);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === wanted,
  );

  return match?.[1];
}

function retryAfterMs(
  headers: Record<string, string> | undefined,
  now: number,
): number | undefined {
  const raw = headerValue(headers, "retry-after");
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;

  return Math.max(0, parsed - now);
}

function delayMs(
  attempt: number,
  headers: Record<string, string> | undefined,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const fromHeader = retryAfterMs(headers, Date.now());
  if (fromHeader !== undefined) return Math.min(maxDelayMs, fromHeader);
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(maxDelayMs, exponential);

  return capped * (0.5 + Math.random() * 0.5);
}

function applyRequestId(options?: WithRequestIdOptions): TransportMiddleware {
  const generate = options?.generate ?? randomUUID;

  return (next) => (request, context) => {
    if (!isWrite(request.op.kind) || request.query?.requestid) {
      return next(request, context);
    }

    return next(
      {
        ...request,
        query: { ...request.query, requestid: generate() },
      },
      context,
    );
  };
}

/**
 * Opt-in. Not applied by `createQboTools`.
 *
 * Adds `query.requestid` on writes (`create`, `update`, `delete`, `void`)
 * when that field is missing. Reads (`get`, `query`, `report`) are forwarded
 * unchanged. An id already on the query, including one the library lifted
 * from the tool body, is kept. The decision uses `request.op.kind` only.
 *
 * Pass a transport to wrap it immediately, or pass options (or nothing) to
 * get a `TransportMiddleware`.
 *
 * Put this outside retry:
 * `withRequestId(withRetry()(transport))`.
 * The id is chosen once and placed on the request `withRetry` sends on
 * every attempt. QuickBooks treats `requestid` as an idempotency key.
 * `withRetry` also refuses to retry a write until that field is present, so
 * generating the id inside the retry loop neither retries the write nor
 * keeps a stable key. Generating a fresh id per attempt would make each
 * replay look like a different write.
 */
export function withRequestId(next: Transport): Transport;
export function withRequestId(
  options?: WithRequestIdOptions,
): TransportMiddleware;
export function withRequestId(
  optionsOrNext?: WithRequestIdOptions | Transport,
): TransportMiddleware | Transport {
  if (typeof optionsOrNext === "function") {
    return applyRequestId()(optionsOrNext);
  }

  return applyRequestId(optionsOrNext);
}

/**
 * Opt-in. Not applied by `createQboTools`.
 *
 * Retries `429` and `500` / `502` / `503` / `504` (override with `retryOn`).
 * Default budget is 3 attempts. Between attempts the wait is exponential
 * from `baseDelayMs` (250), times a jitter factor in `[0.5, 1)`, and never
 * above `maxDelayMs` (10s). A parseable `Retry-After` header replaces that
 * backoff and is capped the same way. The header is read from
 * `QboHttpResponse.headers` when the transport supplies it.
 *
 * Reads retry on those statuses and on errors thrown by the inner transport.
 * Writes retry only when `query.requestid` is already set; otherwise the
 * first response or the first thrown error is returned as-is. After the last
 * attempt a thrown error is rethrown.
 *
 * Wrap underneath request ids:
 * `withRequestId(withRetry()(transport))`.
 * See `withRequestId` for why that order matters.
 */
export function withRetry(options: WithRetryOptions = {}): TransportMiddleware {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const retryOn = options.retryOn ?? defaultRetryOn;
  const sleep = options.sleep ?? defaultSleep;

  return (next) => async (request, context) => {
    const retryable =
      !isWrite(request.op.kind) || Boolean(request.query?.requestid);
    let attempt = 1;
    let response: QboHttpResponse | undefined;

    while (response === undefined) {
      try {
        const current = await next(request, context);
        if (attempt >= maxAttempts || !retryable || !retryOn(current.status)) {
          response = current;
        } else {
          await sleep(
            delayMs(attempt, current.headers, baseDelayMs, maxDelayMs),
          );
          attempt += 1;
        }
      } catch (error) {
        if (attempt >= maxAttempts || !retryable) throw error;
        await sleep(delayMs(attempt, undefined, baseDelayMs, maxDelayMs));
        attempt += 1;
      }
    }

    return response;
  };
}
