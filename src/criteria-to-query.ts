/**
 * Adapted from node-quickbooks v2.0.50
 * https://github.com/mcohen01/node-quickbooks
 * ISC license. Copyright (c) 2014 Michael Cohen.
 *
 * Mirrors: module.query, module.criteriaToString, module.toCriterion,
 * module.checkProperty.
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

type Criterion = {
  field: unknown;
  value: unknown;
  operator: unknown;
};

export type PreparedEntityQuery = {
  query: string;
  fetchAll: boolean;
  limit: number;
  criteria: unknown;
};

function isNodeObject(value: unknown): value is Record<string, any> {
  return value === Object(value);
}

function checkProperty(field: unknown, name: string): boolean {
  return Boolean(field && (field as string).toLowerCase() === name);
}

function toCriterion(criterion: unknown): Criterion | Criterion[] {
  // underscore's _.keys returns [] for primitives, so a stray array entry
  // adds no SQL. Object.keys would otherwise index a string.
  if (!isNodeObject(criterion)) return [];
  const fields = Object.keys(criterion);
  if (fields.includes("field") && fields.includes("value")) {
    return {
      field: criterion.field,
      value: criterion.value,
      operator: criterion.operator || "=",
    };
  }

  return fields.map((key) => ({
    field: key,
    value: criterion[key],
    operator: Array.isArray(criterion[key]) ? "IN" : "=",
  }));
}

// underscore's deep flatten. A plain object has no length, so it contributes
// nothing — module.criteriaToString relies on that.
function flatten(input: unknown, output: Criterion[] = []): Criterion[] {
  if (
    input == null ||
    typeof (input as { length?: unknown }).length !== "number"
  ) {
    return output;
  }

  const values = input as unknown[];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (Array.isArray(value)) flatten(value, output);
    else output.push(value as Criterion);
  }

  return output;
}

export function criteriaToString(criteria: unknown): string {
  if (typeof criteria === "string") {
    return criteria.indexOf(" ") === 0 ? criteria : " " + criteria;
  }

  const converted = Array.isArray(criteria)
    ? criteria.map((entry) => toCriterion(entry))
    : toCriterion(criteria as Record<string, unknown>);
  const flattened = flatten(converted);
  let sql = "";
  let limit: unknown;
  let offset: unknown;
  let desc: unknown;
  let asc: unknown;

  for (let index = 0; index < flattened.length; index++) {
    const criterion = flattened[index];
    if (checkProperty(criterion.field, "fetchall")) continue;
    if (checkProperty(criterion.field, "limit")) {
      limit = criterion.value;
      continue;
    }
    if (checkProperty(criterion.field, "offset")) {
      offset = criterion.value;
      continue;
    }
    if (checkProperty(criterion.field, "desc")) {
      desc = criterion.value;
      continue;
    }
    if (checkProperty(criterion.field, "asc")) {
      asc = criterion.value;
      continue;
    }
    if (sql != "") sql += " and ";
    sql += criterion.field + " " + criterion.operator + " ";
    const quote = (value: unknown) =>
      typeof value === "string"
        ? "'" + value.replace(/'/g, "\\'") + "'"
        : value;
    if (Array.isArray(criterion.value)) {
      sql += "(" + criterion.value.map(quote).join(",") + ")";
    } else {
      sql += quote(criterion.value);
    }
  }

  if (sql != "") sql = " where " + sql;
  if (asc) sql += " orderby " + asc + " asc";
  if (desc) sql += " orderby " + desc + " desc";
  sql += " startposition " + (offset || 1);
  sql += " maxresults " + (limit || 1000);

  return sql;
}

function rewriteCount(query: string, obj: unknown): string {
  if (!isNodeObject(obj)) return query;
  let rewritten = query;
  for (const property in obj) {
    if (obj[property] && property.toLowerCase() === "count") {
      rewritten = rewritten.replace("select * from", "select count(*) from");
      delete obj[property];
    }
  }

  return rewritten;
}

// Copies node-quickbooks module.query's criteria handling, including the
// `splice(i, i + 1)` removal when an array element carried `count`.
export function buildEntityQuery(
  entity: string,
  rawCriteria: unknown,
): PreparedEntityQuery {
  let criteria = rawCriteria;
  if (typeof criteria !== "function" && isNodeObject(criteria)) {
    criteria = JSON.parse(JSON.stringify(criteria));
  }

  let query = "select * from " + entity;
  query = rewriteCount(query, criteria);

  if (Array.isArray(criteria)) {
    for (let index = 0; index < criteria.length; index++) {
      if (isNodeObject(criteria[index])) {
        const keyCount = Object.keys(criteria[index]).length;
        query = rewriteCount(query, criteria[index]);
        if (keyCount !== Object.keys(criteria[index]).length) {
          criteria.splice(index, index + 1);
        }
      }
    }
  }

  let fetchAll = false;
  let limit = 1000;

  if (Array.isArray(criteria)) {
    const limitEntry = criteria.find(
      (entry) => entry && entry.field && entry.field === "limit",
    );
    if (limitEntry) limit = limitEntry.value;
    const offsetEntry = criteria.find(
      (entry) => entry && entry.field && entry.field === "offset",
    );
    if (!offsetEntry) criteria.push({ field: "offset", value: 1 });
    const fetchAllEntry = criteria.find(
      (entry) => entry && entry.field && entry.field === "fetchAll",
    );
    if (fetchAllEntry && fetchAllEntry.value) fetchAll = true;
  } else if (isNodeObject(criteria) && typeof criteria !== "function") {
    limit = criteria.limit = criteria.limit || 1000;
    criteria.offset = criteria.offset || 1;
    if (criteria.fetchAll) fetchAll = true;
  }

  if (criteria && typeof criteria !== "function") {
    query += criteriaToString(criteria);
  }

  return { query, fetchAll, limit, criteria };
}
