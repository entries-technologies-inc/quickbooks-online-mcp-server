import { createRequire } from "node:module";
import path from "node:path";
import axiosEsm, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import QuickBooks from "node-quickbooks";
import { applyQueryDefaults } from "../../src/query-defaults.js";
import { createQuickbooksProxy } from "../../src/quickbooks-proxy.js";
import type { QboHttpRequest } from "../../src/transport.js";

// Jest's native ESM loader and node-quickbooks' CJS require() can resolve two
// axios singletons. The library under test calls the CJS one, so the scripted
// adapter has to be installed there (and on the ESM singleton, when they differ).
const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
const axiosCjs = nodeRequire("axios") as typeof axiosEsm;
const axiosSingletons =
  axiosEsm === axiosCjs ? [axiosEsm] : [axiosEsm, axiosCjs];
const originalAdapters = axiosSingletons.map((axios) => axios.defaults.adapter);

const REALM = "1234567890";
const ENDPOINT = `https://sandbox-quickbooks.api.intuit.com/v3/company/${REALM}`;

type ScriptedResponse = {
  status?: number;
  body?: unknown;
  throwError?: Error;
};

type NormalizedRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  accept?: string;
};

type CallbackSummary = {
  error: unknown;
  data: unknown;
};

const capturedNode: InternalAxiosRequestConfig[] = [];
let script: ScriptedResponse[] = [];

function installAdapter(): void {
  const adapter = async (config: InternalAxiosRequestConfig) => {
    capturedNode.push(config);
    const next = script.shift() ?? { status: 200, body: {} };
    if (next.throwError) throw next.throwError;
    const status = next.status ?? 200;
    const response = {
      data: next.body ?? null,
      status,
      statusText: String(status),
      headers: {},
      config,
    };
    if (status < 200 || status >= 300) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        response,
      );
    }

    return response;
  };
  for (const axios of axiosSingletons) axios.defaults.adapter = adapter;
}

function restoreAdapters(): void {
  axiosSingletons.forEach((axios, index) => {
    axios.defaults.adapter = originalAdapters[index];
  });
}

function decodeQuery(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  for (const part of search.split("&")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    const key = decodeURIComponent(
      separator === -1 ? part : part.slice(0, separator),
    );
    const value = decodeURIComponent(
      separator === -1 ? "" : part.slice(separator + 1),
    );
    query[key] = value;
  }

  return query;
}

function headerValue(
  config: InternalAxiosRequestConfig,
  name: string,
): string | undefined {
  const headers = config.headers as unknown as {
    get?: (header: string) => unknown;
    [key: string]: unknown;
  };
  const fromGetter = headers?.get?.(name) ?? headers?.get?.(name.toLowerCase());
  const direct = headers?.[name] ?? headers?.[name.toLowerCase()];
  const value = fromGetter ?? direct;
  if (value == null || value === "") return undefined;
  const text = String(value);
  if (text === "application/json, text/plain, */*") return undefined;

  return text;
}

function normalizeNode(config: InternalAxiosRequestConfig): NormalizedRequest {
  const url = String(config.url ?? "");
  const rest = url.startsWith(ENDPOINT) ? url.slice(ENDPOINT.length) : url;
  const separator = rest.indexOf("?");
  const path = separator === -1 ? rest : rest.slice(0, separator);
  const query = separator === -1 ? {} : decodeQuery(rest.slice(separator + 1));
  for (const [key, value] of Object.entries(config.params ?? {})) {
    if (value == null) continue;
    query[key] = String(value);
  }
  let body = config.data as unknown;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = config.data;
    }
  }

  return {
    method: String(config.method).toUpperCase(),
    path,
    query,
    body: body === undefined ? undefined : body,
    accept: headerValue(config, "Accept"),
  };
}

function normalizeProxy(request: QboHttpRequest): NormalizedRequest {
  return {
    method: request.method,
    path: request.path,
    query: Object.fromEntries(
      Object.entries(request.query ?? {}).map(([key, value]) => [
        key,
        String(value),
      ]),
    ),
    body: request.body === undefined ? undefined : request.body,
    accept: request.accept,
  };
}

function summarize(error: unknown, data: unknown): CallbackSummary {
  if (error instanceof Error) return { error: error.message, data };

  return { error: error ?? null, data };
}

async function flush(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function copyArg(value: unknown): unknown {
  if (typeof value === "function" || value === undefined) return value;

  return structuredClone(value);
}

function makeNode(): QuickBooks {
  return new QuickBooks(
    "consumer-key",
    "consumer-secret",
    "access-token",
    false,
    REALM,
    true,
    false,
    null,
    "2.0",
    "refresh-token",
  );
}

async function callBoth(
  method: string,
  args: unknown[],
  responses: ScriptedResponse[],
): Promise<{
  nodeRequests: NormalizedRequest[];
  proxyRequests: QboHttpRequest[];
  nodeCallback: CallbackSummary;
  proxyCallback: CallbackSummary;
}> {
  const nodeArgs = args.map(copyArg);
  const proxyArgs = args.map(copyArg);
  let nodeCallback: CallbackSummary = { error: "not called", data: undefined };
  let proxyCallback: CallbackSummary = { error: "not called", data: undefined };
  const nodeCallbackFn = (error: unknown, data?: unknown) => {
    nodeCallback = summarize(error, data);
  };
  const proxyCallbackFn = (error: unknown, data?: unknown) => {
    proxyCallback = summarize(error, data);
  };

  capturedNode.length = 0;
  script = responses.map((response) => ({ ...response }));
  const nodeClient = makeNode() as unknown as Record<
    string,
    (...params: unknown[]) => void
  >;
  nodeClient[method](...nodeArgs, nodeCallbackFn);
  await flush();
  const nodeRequests = capturedNode.map(normalizeNode);

  const proxyRequests: QboHttpRequest[] = [];
  script = responses.map((response) => ({ ...response }));
  const proxy = createQuickbooksProxy({
    realmId: REALM,
    transport: async (request) => {
      proxyRequests.push(request);
      const next = script.shift() ?? { status: 200, body: {} };
      if (next.throwError) throw next.throwError;

      return { status: next.status ?? 200, body: next.body ?? null };
    },
  }) as unknown as Record<string, (...params: unknown[]) => void>;
  proxy[method](...proxyArgs, proxyCallbackFn);
  await flush();

  return { nodeRequests, proxyRequests, nodeCallback, proxyCallback };
}

async function expectParity(
  method: string,
  args: unknown[],
  responses: ScriptedResponse[],
  ops: Array<QboHttpRequest["op"]>,
): Promise<void> {
  const result = await callBoth(method, args, responses);
  const proxyHttp = result.proxyRequests.map(normalizeProxy);
  expect(proxyHttp).toEqual(result.nodeRequests);
  expect(result.proxyRequests.map((request) => request.op)).toEqual(ops);
  expect(result.proxyCallback).toEqual(result.nodeCallback);
}

const bill = { Id: "1", SyncToken: "0", TotalAmt: 5 };
const savedBill = { Bill: { Id: "1", SyncToken: "1", TotalAmt: 5 }, time: "t" };

describe("node-quickbooks parity", () => {
  beforeEach(() => {
    installAdapter();
    script = [];
    capturedNode.length = 0;
  });

  afterEach(() => {
    restoreAdapters();
  });

  it("gets a bill and unwraps the entity", async () => {
    await expectParity(
      "getBill",
      ["265"],
      [{ body: savedBill }],
      [{ kind: "get", entity: "Bill" }],
    );
  });

  it("gets preferences with no id", async () => {
    await expectParity(
      "getPreferences",
      [],
      [{ body: { Preferences: { Id: "1" }, time: "t" } }],
      [{ kind: "get", entity: "Preferences" }],
    );
  });

  it("omits a falsy read id the way node-quickbooks does", async () => {
    await expectParity(
      "getBill",
      [0],
      [{ body: savedBill }],
      [{ kind: "get", entity: "Bill" }],
    );
  });

  it("requests an invoice pdf with the pdf accept header", async () => {
    await expectParity(
      "getInvoicePdf",
      ["10"],
      [{ body: { Invoice: "pdf" } }],
      [{ kind: "get", entity: "Invoice" }],
    );
  });

  it("creates a bill and unwraps the result", async () => {
    await expectParity(
      "createBill",
      [null],
      [{ body: savedBill }],
      [{ kind: "create", entity: "Bill" }],
    );
    await expectParity(
      "createBill",
      [{ TotalAmt: 5, requestId: "req-1", allowDuplicateDocNum: true }],
      [{ body: savedBill }],
      [{ kind: "create", entity: "Bill" }],
    );
  });

  it("creates without a callback", async () => {
    script = [{ body: savedBill }];
    expect(() =>
      makeNode().createBill({ TotalAmt: 1 }, () => undefined),
    ).not.toThrow();
    await flush();
    const proxy = createQuickbooksProxy({
      realmId: REALM,
      transport: async () => ({ status: 200, body: savedBill }),
    });
    expect(() => proxy.createBill({ TotalAmt: 1 })).not.toThrow();
    await flush();
  });

  it("updates a bill, setting sparse only when it is absent", async () => {
    await expectParity(
      "updateBill",
      [{ ...bill }],
      [{ body: savedBill }],
      [{ kind: "update", entity: "Bill" }],
    );
    await expectParity(
      "updateBill",
      [{ ...bill, sparse: false }],
      [{ body: savedBill }],
      [{ kind: "update", entity: "Bill" }],
    );
  });

  it("rejects an update that is missing Id or SyncToken", () => {
    const nodeClient = makeNode();
    const proxy = createQuickbooksProxy({
      realmId: REALM,
      transport: async () => ({ status: 200, body: {} }),
    });
    const cases = [
      {},
      { Id: "", SyncToken: "0" },
      { Id: "1" },
      { Id: "1", SyncToken: "" },
    ];
    for (const entity of cases) {
      expect(() =>
        nodeClient.updateBill(structuredClone(entity), () => undefined),
      ).toThrow(/must contain Id and SyncToken/);
      expect(() =>
        proxy.updateBill(structuredClone(entity), () => undefined),
      ).toThrow(/must contain Id and SyncToken/);
    }
  });

  it("allows an exchange rate update without Id and SyncToken", async () => {
    await expectParity(
      "updateExchangeRate",
      [{ Rate: 1.2 }],
      [{ body: { ExchangeRate: { Rate: 1.2 } } }],
      [{ kind: "update", entity: "Exchangerate" }],
    );
  });

  it("turns a true void flag into include=void and leaves a false flag on the body", async () => {
    await expectParity(
      "updateBill",
      [{ ...bill, void: true }],
      [{ body: savedBill }],
      [{ kind: "update", entity: "Bill" }],
    );
    await expectParity(
      "updateBill",
      [{ ...bill, void: "false" }],
      [{ body: savedBill }],
      [{ kind: "update", entity: "Bill" }],
    );
  });

  it("maps updateItem's doNotUpdateAccountOnTxns flag", async () => {
    await expectParity(
      "updateItem",
      [{ ...bill, doNotUpdateAccountOnTxns: true }],
      [{ body: { Item: bill } }],
      [{ kind: "update", entity: "Item" }],
    );
    await expectParity(
      "updateItem",
      [{ ...bill, doNotUpdateAccountOnTxns: "false" }],
      [{ body: { Item: bill } }],
      [{ kind: "update", entity: "Item" }],
    );
    await expectParity(
      "updateItem",
      [{ ...bill }],
      [{ body: { Item: bill } }],
      [{ kind: "update", entity: "Item" }],
    );
  });

  it("voids a payment through update", async () => {
    await expectParity(
      "voidPayment",
      [{ ...bill }],
      [{ body: { Payment: bill } }],
      [{ kind: "update", entity: "Payment" }],
    );
  });

  it("deletes an object without unwrapping and voids an object", async () => {
    await expectParity(
      "deleteBill",
      [{ ...bill }],
      [{ body: { Bill: bill, time: "t" } }],
      [{ kind: "delete", entity: "Bill" }],
    );
    await expectParity(
      "voidInvoice",
      [{ ...bill }],
      [{ body: { Invoice: bill, time: "t" } }],
      [{ kind: "void", entity: "Invoice" }],
    );
  });

  it("reads a string id before deleting it", async () => {
    await expectParity(
      "deleteBill",
      ["1"],
      [
        { body: savedBill },
        { body: { Bill: { Id: "1", status: "Deleted" }, time: "t2" } },
      ],
      [
        { kind: "get", entity: "Bill" },
        { kind: "delete", entity: "Bill" },
      ],
    );
  });

  it("stops a string delete when the read returns a fault", async () => {
    const fault = { Fault: { Error: [{ Message: "missing", code: "610" }] } };
    await expectParity(
      "deleteBill",
      ["1"],
      [{ body: fault }],
      [{ kind: "get", entity: "Bill" }],
    );
  });

  it("deletes without a callback", async () => {
    script = [{ body: { Bill: bill, time: "t" } }];
    expect(() =>
      makeNode().deleteBill({ ...bill }, () => undefined),
    ).not.toThrow();
    await flush();
    const proxy = createQuickbooksProxy({
      realmId: REALM,
      transport: async () => ({ status: 200, body: { Bill: bill, time: "t" } }),
    });
    expect(() => proxy.deleteBill({ ...bill })).not.toThrow();
    await flush();
  });

  it("surfaces a Fault body and an HTTP error as the callback error", async () => {
    const fault = { Fault: { Error: [{ Message: "bad", Detail: "no" }] } };
    await expectParity(
      "getBill",
      ["1"],
      [{ body: fault }],
      [{ kind: "get", entity: "Bill" }],
    );
    await expectParity(
      "getBill",
      ["1"],
      [{ status: 400, body: { oops: true } }],
      [{ kind: "get", entity: "Bill" }],
    );
    await expectParity(
      "deleteBill",
      [{ ...bill }],
      [{ status: 400, body: { oops: true } }],
      [{ kind: "delete", entity: "Bill" }],
    );
    await expectParity(
      "getBill",
      ["1"],
      [{ body: { Fault: { Error: [] } } }],
      [{ kind: "get", entity: "Bill" }],
    );
    await expectParity(
      "getBill",
      ["1"],
      [{ body: { Fault: {} } }],
      [{ kind: "get", entity: "Bill" }],
    );
    await expectParity(
      "getBill",
      ["1"],
      [{ body: "plain" }],
      [{ kind: "get", entity: "Bill" }],
    );
    await expectParity(
      "getBill",
      ["1"],
      [{ body: null }],
      [{ kind: "get", entity: "Bill" }],
    );
    await expectParity(
      "getBill",
      ["1"],
      [{ body: { time: "t" } }],
      [{ kind: "get", entity: "Bill" }],
    );
  });

  it("passes a transport failure to the callback", async () => {
    await expectParity(
      "getBill",
      ["1"],
      [{ throwError: new Error("socket hang up") }],
      [{ kind: "get", entity: "Bill" }],
    );
  });

  it("finds bills for the criteria shapes node-quickbooks accepts", async () => {
    const rows = { QueryResponse: { Bill: [bill], maxResults: 1 }, time: "t" };
    const cases: unknown[] = [
      { DocNumber: "A'B&C+D" },
      [{ field: "DocNumber", value: "A", operator: "=" }],
      [
        { field: "limit", value: 2 },
        { field: "offset", value: 5 },
      ],
      [
        { field: "limit", value: 0 },
        { field: "offset", value: 0 },
      ],
      { count: true },
      { count: false, DocNumber: "A" },
      [{ count: true }, { field: "DocNumber", value: "A" }],
      { Id: ["1", "2"] },
      { asc: "TxnDate", desc: "MetaData.LastUpdatedTime", TotalAmt: 5 },
      { limit: 0, offset: 0 },
      { field: "DocNumber", value: "A" },
      [{ DocNumber: "A" }],
      [
        { field: "", value: "x" },
        { field: "offset", value: 3 },
        { field: "limit", value: 2 },
      ],
      " where Active = true",
      "DocNumber = '9'",
      [
        { field: "fetchAll", value: false },
        { field: "Name", value: "Ada" },
      ],
      ["not-a-criterion", { field: "DocNumber", value: "A" }],
    ];
    for (const criteria of cases) {
      await expectParity(
        "findBills",
        [criteria],
        [{ body: rows }],
        [{ kind: "query", entity: "Bill" }],
      );
    }
  });

  it("uses a lone function as the find callback when the query succeeds or fails", async () => {
    const rows = { QueryResponse: { Bill: [], maxResults: 0 }, time: "t" };
    const fault = { Fault: { Error: [{ Message: "query" }] } };

    const run = async (response: ScriptedResponse) => {
      capturedNode.length = 0;
      script = [{ ...response }];
      let nodeCallback: CallbackSummary = {
        error: "not called",
        data: undefined,
      };

      (
        makeNode() as unknown as {
          findBills: (cb: (error: unknown, data?: unknown) => void) => void;
        }
      ).findBills((error, data) => {
        nodeCallback = summarize(error, data);
      });
      await flush();
      const nodeRequests = capturedNode.map(normalizeNode);

      const proxyRequests: QboHttpRequest[] = [];
      script = [{ ...response }];
      let proxyCallback: CallbackSummary = {
        error: "not called",
        data: undefined,
      };

      const proxy = createQuickbooksProxy({
        realmId: REALM,
        transport: async (request) => {
          proxyRequests.push(request);
          const next = script.shift() ?? { status: 200, body: {} };
          if (next.throwError) throw next.throwError;

          return { status: next.status ?? 200, body: next.body ?? null };
        },
      });

      proxy.findBills((error: unknown, data?: unknown) => {
        proxyCallback = summarize(error, data);
      });
      await flush();

      expect(proxyRequests.map(normalizeProxy)).toEqual(nodeRequests);
      expect(proxyRequests.map((request) => request.op)).toEqual([
        { kind: "query", entity: "Bill" },
      ]);
      expect(proxyCallback).toEqual(nodeCallback);
    };

    await run({ body: rows });
    await run({ body: fault });
  });

  it("accepts the callback as the only find argument and ignores a missing criteria", async () => {
    const rows = { QueryResponse: { Bill: [], maxResults: 0 }, time: "t" };
    const onlyCallback = await callBoth(
      "findBills",
      [() => undefined],
      [{ body: rows }],
    );
    expect(onlyCallback.proxyRequests[0]?.op).toEqual({
      kind: "query",
      entity: "Bill",
    });
    expect(normalizeProxy(onlyCallback.proxyRequests[0]!)).toEqual(
      onlyCallback.nodeRequests[0],
    );

    const noCriteria = await callBoth(
      "findBills",
      [undefined],
      [{ body: rows }],
    );
    expect(normalizeProxy(noCriteria.proxyRequests[0]!)).toEqual(
      noCriteria.nodeRequests[0],
    );
  });

  it("pages fetchAll for object and array criteria", async () => {
    const first = {
      QueryResponse: { Bill: [{ Id: "1" }], maxResults: 1 },
      time: "t1",
    };
    const second = { QueryResponse: { maxResults: 0 }, time: "" };
    await expectParity(
      "findBills",
      [{ fetchAll: true, limit: 1 }],
      [{ body: first }, { body: second }],
      [
        { kind: "query", entity: "Bill" },
        { kind: "query", entity: "Bill" },
      ],
    );
    await expectParity(
      "findBills",
      [
        [
          { field: "fetchAll", value: true },
          { field: "limit", value: 1 },
        ],
      ],
      [
        { body: first },
        {
          body: {
            QueryResponse: { Bill: [{ Id: "2" }], maxResults: 0 },
            time: "t2",
          },
        },
      ],
      [
        { kind: "query", entity: "Bill" },
        { kind: "query", entity: "Bill" },
      ],
    );
    await expectParity(
      "findBills",
      [{ fetchAll: true, limit: 1 }],
      [
        {
          body: {
            QueryResponse: { Bill: [{ Id: "1" }], maxResults: 0 },
            time: "t",
          },
        },
      ],
      [{ kind: "query", entity: "Bill" }],
    );
    await expectParity(
      "findBills",
      [{ fetchAll: true, limit: 1 }],
      [{ body: null }],
      [{ kind: "query", entity: "Bill" }],
    );
    await expectParity(
      "findBills",
      [{ fetchAll: true, limit: 1 }],
      [{ body: {} }],
      [{ kind: "query", entity: "Bill" }],
    );
  });

  it("rejects a query fault with the fault body", async () => {
    const fault = { Fault: { Error: [{ Message: "query" }] } };
    await expectParity(
      "findBills",
      [{}],
      [{ body: fault }],
      [{ kind: "query", entity: "Bill" }],
    );
  });

  it("runs a report, an empty report, and a report whose options are the callback", async () => {
    const report = { Header: { ReportName: "ProfitAndLoss" }, Rows: {} };
    await expectParity(
      "reportProfitAndLoss",
      [{ start_date: "2020-01-01", end_date: "2020-01-31" }],
      [{ body: report }],
      [{ kind: "report", report: "ProfitAndLoss" }],
    );
    await expectParity(
      "reportProfitAndLoss",
      [{}],
      [{ body: report }],
      [{ kind: "report", report: "ProfitAndLoss" }],
    );
    const onlyCallback = await callBoth(
      "reportProfitAndLoss",
      [() => undefined],
      [{ body: report }],
    );
    expect(onlyCallback.proxyRequests[0]?.op).toEqual({
      kind: "report",
      report: "ProfitAndLoss",
    });
    expect(normalizeProxy(onlyCallback.proxyRequests[0]!)).toEqual(
      onlyCallback.nodeRequests[0],
    );
    expect(onlyCallback.proxyCallback).toEqual(onlyCallback.nodeCallback);
  });

  it("does not call a report when no callback was given", async () => {
    const proxyRequests: QboHttpRequest[] = [];
    const proxy = createQuickbooksProxy({
      realmId: REALM,
      transport: async (request) => {
        proxyRequests.push(request);
        return { status: 200, body: {} };
      },
    });
    proxy.reportProfitAndLoss();
    await flush();
    expect(proxyRequests).toHaveLength(1);
    expect(proxyRequests[0]?.op).toEqual({
      kind: "report",
      report: "ProfitAndLoss",
    });
  });

  it("returns undefined for an unknown method and ignores symbol properties", () => {
    const proxy = createQuickbooksProxy({
      realmId: REALM,
      transport: async () => ({ status: 200, body: {} }),
    });
    expect(proxy.realmId).toBe(REALM);
    expect(proxy.deleteCustomer).toBeUndefined();
    expect((proxy as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
  });

  it("applies overridable minorversion and format defaults before the transport", () => {
    expect(applyQueryDefaults(undefined, undefined)).toEqual({
      minorversion: "75",
      format: "json",
    });
    expect(applyQueryDefaults({ minorversion: "" }, undefined)).toEqual({
      minorversion: "75",
      format: "json",
    });
    expect(applyQueryDefaults({ minorversion: "76" }, undefined)).toEqual({
      minorversion: "76",
      format: "json",
    });
    expect(
      applyQueryDefaults(
        { minorversion: "75", format: "json" },
        {
          minorversion: false,
          format: false,
        },
      ),
    ).toEqual({});
    expect(
      applyQueryDefaults({}, { minorversion: "73", format: "xml" }),
    ).toEqual({
      minorversion: "73",
      format: "xml",
    });
  });

  it("lets the call context override query defaults", async () => {
    const seen: QboHttpRequest[] = [];
    const proxy = createQuickbooksProxy({
      realmId: REALM,
      queryDefaults: { minorversion: "73", format: false },
      transport: async (request) => {
        seen.push(request);
        return { status: 200, body: savedBill };
      },
    });
    await new Promise<void>((resolve) => {
      proxy.getBill("1", () => resolve());
    });
    expect(seen[0]?.query).toEqual({ minorversion: "73" });
    expect(seen[0]?.op).toEqual({ kind: "get", entity: "Bill" });
  });

  it("does not call the transport for inherited object methods", async () => {
    const seen: string[] = [];
    const proxy = createQuickbooksProxy({
      realmId: REALM,
      transport: async (request) => {
        seen.push(request.path);
        return { status: 200, body: {} };
      },
    });

    expect(String(proxy)).toBe("[object Object]");
    expect(proxy.toString()).toBe("[object Object]");
    expect(seen).toEqual([]);

    await new Promise<void>((resolve) => {
      proxy.getBill("1", () => resolve());
    });
    expect(seen).toEqual(["/bill/1"]);
  });
});
