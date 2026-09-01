"use strict";

/**
 * Minimal CommonJS replacement for query-string@6.
 *
 * intuit-oauth still `require()`s query-string@6, which depends on
 * decode-uri-component@0.2.2 (CVE-2026-45822). The patched
 * decode-uri-component@0.5.0 is ESM-only and breaks that require path.
 *
 * The only call sites are authorizeUri stringify() and createToken parse()
 * of the OAuth callback query. URLSearchParams covers those.
 */

function stringify(object) {
  const params = new URLSearchParams();
  if (!object || typeof object !== "object") {
    return "";
  }
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.append(String(key), String(value));
  }
  return params.toString();
}

function parse(query) {
  const input = String(query ?? "");
  const trimmed = input.startsWith("?") ? input.slice(1) : input;
  return Object.fromEntries(new URLSearchParams(trimmed));
}

module.exports = {
  parse,
  stringify,
};
