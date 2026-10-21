import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  attachToolMeta,
  createQboTools,
  describe as describeTool,
  entity,
  isRead,
  isWrite,
  name,
  op,
  pipe,
  rename,
  when,
  wrapRun,
  type QboTool,
} from "../../src/embed.js";
import { runWithQuickbooksContext } from "../../src/clients/quickbooks-client.js";
import { qboTools } from "../../src/tools/catalog.js";
import { TOOL_META } from "../../src/tools/meta.js";
import type { QboHttpRequest, Transport } from "../../src/transport.js";

const credentials = {
  accessToken: "token",
  realmId: "123",
  isSandbox: true,
  baseUrl: "https://sandbox-quickbooks.api.intuit.com",
};

const billBody = { Bill: { Id: "1", SyncToken: "0" }, time: "t" };

function recordedTransport(seen: QboHttpRequest[]) {
  return async (request: QboHttpRequest) => {
    seen.push(request);

    return { status: 200, body: billBody };
  };
}

function fakeServer() {
  const registrations: Array<{
    name: string;
    description: string;
    handler: (args: unknown) => Promise<unknown>;
  }> = [];
  const server = {
    tool: (
      toolName: string,
      description: string,
      _schema: unknown,
      handler: (args: unknown) => Promise<unknown>,
    ) => {
      registrations.push({ name: toolName, description, handler });
    },
  } as unknown as McpServer;

  return { registrations, server };
}

describe("tool metadata", () => {
  it("covers every registered tool, including void and the eleven reports", () => {
    const registeredNames = qboTools.map((tool) => tool.name).sort();

    expect(registeredNames).toHaveLength(142);
    expect(Object.keys(TOOL_META).sort()).toEqual(registeredNames);
    expect(TOOL_META["delete_invoice"]?.op).toEqual({
      kind: "void",
      entity: "Invoice",
    });
    expect(TOOL_META["get_general_ledger"]?.op).toEqual({
      kind: "report",
      report: "GeneralLedger",
    });
    expect(
      Object.values(TOOL_META).filter((meta) => meta.op.kind === "report"),
    ).toHaveLength(11);
    expect(TOOL_META["get-bill"]?.op).toEqual({ kind: "get", entity: "Bill" });
    expect(TOOL_META["search_bills"]?.op).toEqual({
      kind: "query",
      entity: "Bill",
    });
    expect(TOOL_META["create-bill"]?.op).toEqual({
      kind: "create",
      entity: "Bill",
    });
    expect(TOOL_META["get_profit_and_loss"]?.entity).toBeUndefined();
  });

  it("rejects a tool that has no operation metadata", () => {
    expect(() => attachToolMeta({ name: "not_a_tool" })).toThrow(
      'QuickBooks tool "not_a_tool" has no operation metadata',
    );
  });
});

describe("createQboTools", () => {
  it("filters, renames, overrides, and adds tools", () => {
    const tools = createQboTools({
      transport: async () => ({ status: 200, body: {} }),
    })
      .exclude("get_invoice_pdf")
      .exclude(["read_item", "search_bills"])
      .exclude((tool) => tool.name === "search_vendors")
      .exclude(name("search_customers"))
      .rename("create-bill", "create_bill")
      .rename("missing-tool", "unused");

    const listed = tools.list();
    const names = listed.map((tool) => tool.name);

    expect(names).not.toContain("get_invoice_pdf");
    expect(names).not.toContain("read_item");
    expect(names).not.toContain("search_bills");
    expect(names).not.toContain("search_vendors");
    expect(names).not.toContain("search_customers");
    expect(names).toContain("create_bill");
    expect(names).not.toContain("create-bill");
    listed.pop();
    expect(tools.list()).toHaveLength(listed.length + 1);

    const bill = tools.list().find((tool) => tool.name === "get-bill");
    expect(bill).toBeDefined();
    tools.add({
      ...(bill as QboTool),
      name: "get_custom",
      description: "custom",
      handler: async () => ({ content: [{ type: "text", text: "custom" }] }),
    });
    expect(tools.list().map((tool) => tool.name)).toContain("get_custom");
    expect(() => tools.override("not-registered", bill!.handler)).toThrow(
      'Unknown QuickBooks tool "not-registered"',
    );
    tools.override("get_custom", async () => ({
      content: [{ type: "text", text: "replaced" }],
    }));
    expect(
      tools.list().find((tool) => tool.name === "get_custom")?.description,
    ).toBe("custom");
  });

  it("applies middleware only when the predicate matches", () => {
    const tools = createQboTools({
      transport: async () => ({ status: 200, body: {} }),
    }).use(
      pipe(
        when(name("get-bill"), describeTool("bill by id")),
        when(name("get-vendor"), describeTool("vendor by id")),
        wrapRun((handler) => handler),
      ),
    );

    const bill = tools.list().find((tool) => tool.name === "get-bill");
    const vendor = tools.list().find((tool) => tool.name === "get-vendor");

    expect(bill?.description).toBe("bill by id");
    expect(vendor?.description).toBe("vendor by id");
    expect(pipe()(bill as QboTool)).toBe(bill);
    expect(rename("other", "nope")(bill as QboTool).name).toBe("get-bill");
  });

  it("matches reads, writes, entities, and operations", () => {
    const tools = createQboTools({
      transport: async () => ({ status: 200, body: {} }),
    });
    const toolByName = Object.fromEntries(
      tools.list().map((tool) => [tool.name, tool]),
    );

    const bill = toolByName["get-bill"] as QboTool;
    const invoiceDelete = toolByName["delete_invoice"] as QboTool;
    const profitAndLoss = toolByName["get_profit_and_loss"] as QboTool;

    expect(isRead().test(bill)).toBe(true);
    expect(isRead().test(invoiceDelete)).toBe(false);
    expect(isRead().test(profitAndLoss)).toBe(true);
    expect(isWrite().test(invoiceDelete)).toBe(true);
    expect(isWrite().test(bill)).toBe(false);
    expect(entity("Bill").test(bill)).toBe(true);
    expect(entity("Vendor").test(bill)).toBe(false);
    expect(entity("Bill").test(profitAndLoss)).toBe(false);
    expect(op("void").test(invoiceDelete)).toBe(true);
    expect(op("get").test(invoiceDelete)).toBe(false);
    expect(name("get-bill").and(isRead()).test(bill)).toBe(true);
    expect(name("get-bill").and(isWrite()).test(bill)).toBe(false);
    expect(name("missing").and(isRead()).test(bill)).toBe(false);
    expect(name("get-bill").or(isWrite()).test(bill)).toBe(true);
    expect(name("missing").or(name("get-bill")).test(bill)).toBe(true);
    expect(name("missing").or(name("also-missing")).test(bill)).toBe(false);
    expect(name("get-bill").not().test(bill)).toBe(false);
    expect(name("get-bill").not().test(invoiceDelete)).toBe(true);
    expect(isRead().and(entity("Bill")).test(profitAndLoss)).toBe(false);
  });

  it("runs a get through the mock transport and keeps the unknown-parameter warning", async () => {
    const seen: QboHttpRequest[] = [];
    const tools = createQboTools({
      transport: recordedTransport(seen),
      queryDefaults: { minorversion: "73" },
    }).rename("get-bill", "read_bill");

    const { registrations, server } = fakeServer();
    tools.register(server, { context: credentials });
    const registered = registrations.find((tool) => tool.name === "read_bill");

    const result = (await registered!.handler({
      params: { id: "1", extra: "ignored" },
    })) as { content: Array<{ text: string }> };

    expect(seen[0]?.op).toEqual({ kind: "get", entity: "Bill" });
    expect(seen[0]?.query).toMatchObject({
      minorversion: "73",
      format: "json",
    });
    expect(result.content[0]?.text).toBe(
      JSON.stringify({ Id: "1", SyncToken: "0" }),
    );
    expect(result.content[1]?.text).toContain("extra");
    expect(result.content[1]?.text).toContain("IGNORED");
  });

  it("lets the call context override query defaults and turns a throw into an MCP error", async () => {
    const seen: QboHttpRequest[] = [];
    const tools = createQboTools({
      transport: recordedTransport(seen),
      queryDefaults: { minorversion: "73" },
    });

    const handlers = tools.handlers({
      context: {
        ...credentials,
        queryDefaults: { minorversion: "76", format: false },
      },
    });

    const readBill = handlers["get-bill"] as (
      args: unknown,
    ) => Promise<unknown>;

    await readBill({ params: { id: "9" } });

    expect(seen[0]?.query).toEqual({ minorversion: "76" });

    tools.override("get-bill", async () => {
      throw new Error("boom");
    });
    const replaced = tools.handlers({ context: credentials });
    const failBill = replaced["get-bill"] as (
      args: unknown,
    ) => Promise<unknown>;

    const failedBill = (await failBill({ params: { id: "9" } })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(failedBill.isError).toBe(true);
    expect(failedBill.content[0]?.text).toBe("Error: boom");
  });

  it("runs every tool handler through a success and a fault response", async () => {
    const entityRecord = { Id: "1", SyncToken: "0" };
    const queryResponse: Record<string, unknown> = { maxResults: 0 };
    const successBody: Record<string, unknown> = {
      time: "t",
      QueryResponse: queryResponse,
      Header: { ReportName: "ProfitAndLoss" },
      Rows: {},
    };

    for (const meta of Object.values(TOOL_META)) {
      if (meta.op.kind === "report" || !meta.entity) continue;
      successBody[meta.entity] = entityRecord;
      queryResponse[meta.entity] = [entityRecord];
    }

    const loose = (): unknown => {
      const target: Record<PropertyKey, unknown> = { length: 0 };
      const proxy: object = new Proxy(target, {
        get(_inner, prop) {
          if (
            prop === Symbol.toPrimitive ||
            prop === "toString" ||
            prop === "valueOf"
          ) {
            return () => "1";
          }
          if (prop === "length") return 0;
          if (typeof prop === "symbol") return undefined;

          return proxy;
        },
      });

      return proxy;
    };

    const callAll = async (transport: Transport) => {
      const failures: string[] = [];
      for (const tool of qboTools) {
        // deleteVendor is not a node-quickbooks method. The handler throws
        // before it can return, so the tool wrapper is exercised separately.
        if (tool.name === "delete-vendor") continue;
        try {
          await Promise.race([
            runWithQuickbooksContext({ ...credentials, transport }, () =>
              (
                tool.handler as (
                  args: unknown,
                  extra?: unknown,
                ) => Promise<unknown>
              )({ params: loose() }, {}),
            ),
            new Promise((_resolve, reject) =>
              setTimeout(() => reject(new Error("timed out")), 500),
            ),
          ]);
        } catch (error) {
          failures.push(
            `${tool.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return failures;
    };

    const successTransport: Transport = async () => ({
      status: 200,
      body: successBody,
    });
    const faultTransport: Transport = async () => ({
      status: 200,
      body: { Fault: { Error: [{ Message: "no" }] } },
    });

    expect(await callAll(successTransport)).toEqual([]);
    expect(await callAll(faultTransport)).toEqual([]);

    const deleteVendor = qboTools.find((tool) => tool.name === "delete-vendor");
    const callDeleteVendor = (err: Error | null, deleted?: unknown) =>
      runWithQuickbooksContext(
        {
          ...credentials,
          quickbooks: {
            realmId: credentials.realmId,
            deleteVendor: (
              _vendor: unknown,
              callback: (error: unknown, result?: unknown) => void,
            ) => callback(err, deleted),
          },
        },
        () =>
          (
            deleteVendor!.handler as (
              args: unknown,
              extra?: unknown,
            ) => Promise<unknown>
          )({ params: { vendor: { Id: "1", SyncToken: "0" } } }, {}),
      );

    await callDeleteVendor(null, { Id: "1" });
    await callDeleteVendor(new Error("no"));
  });
});

describe("embed import graph", () => {
  it("does not load the OAuth client or node-quickbooks", () => {
    const root = path.resolve("src");
    const bannedSpecifiers = new Set([
      "node-quickbooks",
      "intuit-oauth",
      "dotenv",
      "open",
    ]);

    const bannedFiles = new Set([
      path.join(root, "index.ts"),
      path.join(root, "auth-server.ts"),
      path.join(root, "clients/quickbooks-oauth.ts"),
    ]);

    const pending = [path.join(root, "embed.ts")];
    const seen = new Set<string>();

    while (pending.length > 0) {
      const file = pending.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      expect(bannedFiles.has(file)).toBe(false);
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1] as string;
        expect(bannedSpecifiers.has(specifier)).toBe(false);
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        const candidate = resolved.endsWith(".js")
          ? resolved.replace(/\.js$/, ".ts")
          : `${resolved}.ts`;
        pending.push(candidate);
      }
    }

    expect(seen.size).toBeGreaterThan(10);
  });
});
