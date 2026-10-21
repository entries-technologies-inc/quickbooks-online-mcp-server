/**
 * Adapted from node-quickbooks v2.0.50
 * https://github.com/mcohen01/node-quickbooks
 * ISC license. Copyright (c) 2014 Michael Cohen.
 *
 * Mirrors: module.report, module.reportCriteria.
 * Behaviour is intentionally identical to that version and is locked by
 * comparison tests against node-quickbooks 2.0.50.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

// node-quickbooks appends `?key=value&` (including a trailing ampersand) onto
// the report path, then lets axios add minorversion and format. The transport
// query is the same keys without that trailing empty parameter.
export function reportQuery(criteria: unknown): Record<string, string> {
  if (!criteria || typeof criteria === "function") return {};

  const query: Record<string, string> = {};
  for (const key in criteria as Record<string, unknown>) {
    query[key] = String((criteria as Record<string, unknown>)[key]);
  }

  return query;
}
