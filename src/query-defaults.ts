/**
 * Adapted from node-quickbooks v2.0.50
 * https://github.com/mcohen01/node-quickbooks
 * ISC license. Copyright (c) 2014 Michael Cohen.
 *
 * Mirrors: the QuickBooks constructor default minorversion of 75, and
 * module.request setting params.minorversion and params.format = 'json'.
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

// `false` omits that query param. A string replaces the default.
// Undefined uses node-quickbooks' defaults: minorversion 75 and format json.
export type QueryDefaults = {
  minorversion?: string | false;
  format?: string | false;
};

export function applyQueryDefaults(
  query: Record<string, string> | undefined,
  defaults: QueryDefaults | undefined,
): Record<string, string> {
  const next: Record<string, string> = { ...(query ?? {}) };
  const minorversion =
    defaults?.minorversion === undefined ? "75" : defaults.minorversion;
  const format = defaults?.format === undefined ? "json" : defaults.format;

  if (minorversion === false) {
    delete next.minorversion;
  } else if (next.minorversion === undefined || next.minorversion === "") {
    // node-quickbooks: params.minorversion = params.minorversion || 75
    next.minorversion = minorversion;
  }

  if (format === false) {
    delete next.format;
  } else {
    // node-quickbooks overwrites format on every request.
    next.format = format;
  }

  return next;
}
