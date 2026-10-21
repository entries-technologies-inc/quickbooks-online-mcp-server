/**
 * Adapted from node-quickbooks v2.0.50
 * https://github.com/mcohen01/node-quickbooks
 * ISC license. Copyright (c) 2014 Michael Cohen.
 *
 * Mirrors: module.create, module.read, module.update, module.delete,
 * module.void, module.request (sparse, operation, requestId,
 * allowDuplicateDocNum, Fault-as-error), module.unwrap, module.capitalize.
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

import { inspect } from "node:util";
import { buildEntityQuery } from "./criteria-to-query.js";
import { applyQueryDefaults } from "./query-defaults.js";
import {
  QUICKBOOKS_METHOD_SPECS,
  type MethodSpec,
} from "./quickbooks-method-specs.js";
import { reportQuery } from "./report-query.js";
import type {
  QboCallContext,
  QboHttpRequest,
  QboOperation,
} from "./transport.js";

type QboCallback = (error: unknown, data?: unknown, response?: unknown) => void;

export type QuickbooksProxy = {
  realmId: string;
  [method: string]: any;
};

type RawResult = {
  error: unknown;
  body: unknown;
  response: { status: number; data: unknown } | undefined;
};

function isNodeObject(value: unknown): value is Record<string, any> {
  return value === Object(value);
}

export function capitalize(name: string): string {
  return name.substring(0, 1).toUpperCase() + name.substring(1);
}

function isFault(body: unknown): boolean {
  if (!isNodeObject(body)) return false;
  const fault = body.Fault;
  if (!fault) return false;
  const errors = (fault as { Error?: { length?: number } }).Error;

  return Boolean(errors && errors.length);
}

function asCallback(callback: unknown): QboCallback | undefined {
  return typeof callback === "function" ? (callback as QboCallback) : undefined;
}

function unwrap(
  callback: QboCallback | undefined,
  entityName: string,
): QboCallback {
  if (!callback) return () => undefined;

  return (error, data, response) => {
    if (error) {
      callback(error, null, response);
      return;
    }
    const record = (data || {}) as Record<string, unknown>;
    const name = capitalize(entityName);
    callback(error, record[name] || data, response);
  };
}

function liftEntityQueryFlags(
  entity: unknown,
  query: Record<string, string>,
): void {
  if (!isNodeObject(entity)) return;
  if (entity.allowDuplicateDocNum) {
    delete entity.allowDuplicateDocNum;
    query.include = "allowduplicatedocnum";
  }
  if (entity.requestId) {
    query.requestid = String(entity.requestId);
    delete entity.requestId;
  }
}

async function execute(
  context: QboCallContext,
  request: QboHttpRequest,
): Promise<RawResult> {
  const prepared: QboHttpRequest = {
    ...request,
    query: applyQueryDefaults(request.query, context.queryDefaults),
  };

  try {
    const response = await context.transport(prepared, context);
    const body = response.body;
    if (response.status < 200 || response.status >= 300) {
      return {
        error: new Error(`Request failed with status code ${response.status}`),
        body,
        response: { status: response.status, data: body },
      };
    }
    if (isFault(body)) {
      return {
        error: body,
        body,
        response: { status: response.status, data: body },
      };
    }

    return {
      error: null,
      body,
      response: { status: response.status, data: body },
    };
  } catch (error) {
    return { error, body: null, response: undefined };
  }
}

function deliver(
  result: RawResult,
  callback: unknown,
  entityName?: string,
): void {
  const wrapped =
    entityName === undefined
      ? asCallback(callback)
      : unwrap(asCallback(callback), entityName);
  if (!wrapped) return;
  wrapped(result.error, result.body, result.response);
}

function entityPath(entityName: string, id: unknown): string {
  let path = "/" + entityName.toLowerCase();
  if (id) path += "/" + id;

  return path;
}

function operationFor(
  kind: QboOperation["kind"],
  entityName: string,
): QboOperation {
  if (kind === "report") {
    return { kind: "report", report: entityName };
  }

  return { kind, entity: capitalize(entityName) };
}

function send(
  context: QboCallContext,
  kind: QboOperation["kind"],
  entityName: string,
  method: "GET" | "POST",
  path: string,
  query: Record<string, string>,
  body: unknown,
  callback: unknown,
  unwrapEntity?: string,
): void {
  const request: QboHttpRequest = {
    op: operationFor(kind, entityName),
    method,
    path,
    query,
  };
  if (body !== null && body !== undefined) request.body = body;
  if (/pdf$/.test(path)) request.accept = "application/pdf";

  void execute(context, request).then((result) => {
    deliver(result, callback, unwrapEntity);
  });
}

function read(
  context: QboCallContext,
  entityName: string,
  id: unknown,
  callback: unknown,
): void {
  send(
    context,
    "get",
    entityName,
    "GET",
    entityPath(entityName, id),
    {},
    null,
    callback,
    entityName,
  );
}

function create(
  context: QboCallContext,
  entityName: string,
  entity: unknown,
  callback: unknown,
): void {
  const query: Record<string, string> = {};
  liftEntityQueryFlags(entity, query);
  send(
    context,
    "create",
    entityName,
    "POST",
    entityPath(entityName, null),
    query,
    entity,
    callback,
    entityName,
  );
}

function missingIdentity(value: unknown): boolean {
  return value === undefined || String(value) === "";
}

function update(
  context: QboCallContext,
  entityName: string,
  entity: Record<string, any>,
  callback: unknown,
  includeFlag?: string,
  includeValue?: string,
): void {
  let includeFromFlag: string | undefined;
  if (
    includeFlag &&
    entity[includeFlag] &&
    entity[includeFlag].toString() === "true"
  ) {
    includeFromFlag = includeValue;
    delete entity[includeFlag];
  }

  if (missingIdentity(entity.Id) || missingIdentity(entity.SyncToken)) {
    if (entityName !== "exchangerate") {
      throw new Error(
        entityName +
          " must contain Id and SyncToken fields: " +
          inspect(entity, { showHidden: false, depth: null }),
      );
    }
  }

  if (!Object.prototype.hasOwnProperty.call(entity, "sparse")) {
    entity.sparse = true;
  }

  const query: Record<string, string> = { operation: "update" };
  if (includeFromFlag) query.include = includeFromFlag;
  if (entity.void && entity.void.toString() === "true") {
    query.include = "void";
    delete entity.void;
  }
  liftEntityQueryFlags(entity, query);
  send(
    context,
    "update",
    entityName,
    "POST",
    entityPath(entityName, null),
    query,
    entity,
    callback,
    entityName,
  );
}

function postOperation(
  context: QboCallContext,
  kind: "delete" | "void",
  entityName: string,
  entity: unknown,
  callback: unknown,
): void {
  const query: Record<string, string> = { operation: kind };
  liftEntityQueryFlags(entity, query);
  send(
    context,
    kind,
    entityName,
    "POST",
    entityPath(entityName, null),
    query,
    entity,
    callback,
  );
}

function deleteOrVoid(
  context: QboCallContext,
  kind: "delete" | "void",
  entityName: string,
  idOrEntity: unknown,
  callback: unknown,
): void {
  const settled = asCallback(callback) ?? (() => undefined);
  if (isNodeObject(idOrEntity)) {
    postOperation(context, kind, entityName, idOrEntity, settled);
    return;
  }

  read(context, entityName, idOrEntity, (error: unknown, entity?: unknown) => {
    if (error) {
      settled(error);
      return;
    }
    postOperation(context, kind, entityName, entity, settled);
  });
}

async function runQuery(
  context: QboCallContext,
  entityName: string,
  rawCriteria: unknown,
): Promise<unknown> {
  const prepared = buildEntityQuery(entityName, rawCriteria);
  const result = await execute(context, {
    op: { kind: "query", entity: capitalize(entityName) },
    method: "GET",
    path: "/query",
    query: { query: prepared.query },
  });
  if (result.error) throw result.error;

  // node-quickbooks reads QueryResponse before the fetchAll check, so a null
  // body or a body without QueryResponse rejects the query.
  const data = result.body as {
    QueryResponse: Record<string, any>;
    time?: string;
  };
  const fields = Object.keys(data.QueryResponse);
  const key = fields.find(
    (field) => field.toLowerCase() === entityName.toLowerCase(),
  );
  if (prepared.fetchAll && data.QueryResponse.maxResults === prepared.limit) {
    const criteria = prepared.criteria as any;
    if (Array.isArray(criteria)) {
      for (const entry of criteria) {
        if (entry.field === "offset")
          entry.value = entry.value + prepared.limit;
      }
    } else {
      criteria.offset = criteria.offset + prepared.limit;
    }
    const more = (await runQuery(context, entityName, criteria)) as {
      QueryResponse?: Record<string, any>;
      time?: string;
    };
    data.QueryResponse[key as string] = data.QueryResponse[
      key as string
    ].concat((more.QueryResponse && more.QueryResponse[key as string]) || []);
    data.QueryResponse.maxResults =
      data.QueryResponse.maxResults +
      ((more.QueryResponse && more.QueryResponse.maxResults) || 0);
    data.time = more.time || data.time;
  }

  return data;
}

function find(
  context: QboCallContext,
  entityName: string,
  criteria: unknown,
  callback: unknown,
): void {
  runQuery(context, entityName, criteria).then(
    (data) => {
      const settle = (asCallback(callback) || criteria) as QboCallback;
      settle(null, data);
    },
    (error: unknown) => {
      const settle = (asCallback(callback) || criteria) as QboCallback;
      settle(error, error);
    },
  );
}

function report(
  context: QboCallContext,
  reportName: string,
  options: unknown,
  callback: unknown,
): void {
  const criteria = typeof options === "function" ? undefined : options;
  const settle = typeof options === "function" ? options : callback;
  const query = reportQuery(criteria);
  send(
    context,
    "report",
    reportName,
    "GET",
    "/reports/" + reportName,
    query,
    null,
    settle,
  );
}

function invoke(
  context: QboCallContext,
  spec: MethodSpec,
  args: unknown[],
): void {
  if (spec.kind === "voidPayment") {
    const payment = args[0] as Record<string, any>;
    payment.void = true;
    payment.sparse = true;
    update(context, "payment", payment, args[1]);
    return;
  }
  if (spec.kind === "create") {
    create(context, spec.entity, args[0], args[1]);
    return;
  }
  if (spec.kind === "get") {
    if (spec.noId) {
      read(context, spec.entity, null, args[0]);
      return;
    }
    const id = spec.idSuffix ? String(args[0]) + spec.idSuffix : args[0];
    read(context, spec.entity, id, args[1]);
    return;
  }
  if (spec.kind === "update") {
    update(
      context,
      spec.entity,
      args[0] as Record<string, any>,
      args[1],
      spec.includeFlag,
      spec.includeValue,
    );
    return;
  }
  if (spec.kind === "delete" || spec.kind === "void") {
    deleteOrVoid(context, spec.kind, spec.entity, args[0], args[1]);
    return;
  }
  if (spec.kind === "query") {
    find(context, spec.entity, args[0], args[1]);
    return;
  }
  report(context, spec.report, args[0], args[1]);
}

export function createQuickbooksProxy(
  context: QboCallContext,
): QuickbooksProxy {
  const target = { realmId: context.realmId };

  return new Proxy(target, {
    get(current, property, receiver) {
      if (property === "realmId") return context.realmId;
      if (typeof property !== "string") {
        return Reflect.get(current, property, receiver);
      }
      const spec = QUICKBOOKS_METHOD_SPECS[property];
      if (!spec) return undefined;

      return (...args: unknown[]) => invoke(context, spec, args);
    },
  }) as QuickbooksProxy;
}
