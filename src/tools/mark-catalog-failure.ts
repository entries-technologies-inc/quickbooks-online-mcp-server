/**
 * Catalog handlers report a QuickBooks failure as text (`Error creating bill`,
 * `Invalid criteria: ...`) and omit `isError`. Entries Core had to sniff that
 * text. This helper sets `isError: true` on those results so `formatError`
 * sees them. Success results are returned unchanged and do not gain `isError`.
 *
 * A ported upstream handler whose failure text uses a new prefix must extend
 * `FAILURE_TEXT_PREFIXES`. The catalog applies this to every tool, which is
 * also what the standalone server registers.
 */

const FAILURE_TEXT_PREFIXES = ["Error", "Invalid criteria:"] as const;

function isFailureText(text: string): boolean {
  return FAILURE_TEXT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export function markCatalogFailure<T>(result: T): T {
  if (!result || typeof result !== "object") return result;

  const record = result as { isError?: unknown; content?: unknown };
  if (record.isError === true || record.isError === false) return result;
  if (!Array.isArray(record.content)) return result;

  const first = record.content[0] as { type?: unknown; text?: unknown } | null;
  if (
    !first ||
    typeof first !== "object" ||
    first.type !== "text" ||
    typeof first.text !== "string" ||
    !isFailureText(first.text)
  ) {
    return result;
  }

  return { ...record, isError: true } as T;
}
