import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createQboTools,
  describe as describeTool,
  isRead,
  isWrite,
  name,
  pipe,
  when,
  withRequestId,
  withRetry,
  wrapRun,
  type QboTool,
  type Transport,
} from "../../src/embed.js";

const credentials = {
  accessToken: "token",
  realmId: "123",
  isSandbox: true,
};

const billBody = { Bill: { Id: "1", SyncToken: "0" }, time: "t" };

const missingQbo = {
  isError: true,
  content: [
    {
      type: "text" as const,
      text: "Error: QuickBooks context missing: pass ctx.qbo or set it in middleware",
    },
  ],
};

type CoreApp = { userId: string; realmId: string };

function fakeServer() {
  const registrations: Array<{
    name: string;
    handler: (args: unknown, extra?: unknown) => Promise<unknown>;
  }> = [];
  const server = {
    tool: (
      toolName: string,
      _description: string,
      _schema: unknown,
      handler: (args: unknown, extra?: unknown) => Promise<unknown>,
    ) => {
      registrations.push({ name: toolName, handler });
    },
  } as unknown as McpServer;

  return { registrations, server };
}

describe("per-call app context", () => {
  it("types and delivers app to wrapRun and the transport", async () => {
    const seen: string[] = [];
    let middlewareApp = "";
    const raw: Transport<CoreApp> = async (_request, ctx) => {
      const userId: string = ctx.app.userId;
      seen.push(`${userId}:${ctx.realmId}`);

      return { status: 200, body: billBody };
    };
    const transport: Transport<CoreApp> = withRequestId(
      withRetry({ maxAttempts: 1, sleep: async () => undefined })(raw),
    );
    const tools = createQboTools<CoreApp>({ transport }).use(
      pipe(
        when(
          isRead(),
          wrapRun((next, tool) => async (args, ctx) => {
            const userId: string = ctx.app.userId;
            middlewareApp = `${userId}:${tool.name}:${tool.meta.op.kind}`;

            return next(args, ctx);
          }),
        ),
      ),
    );
    const bill = tools.list().find((tool) => tool.name === "get-bill");

    await bill?.run(
      { params: { id: "1" } },
      {
        qbo: credentials,
        app: { userId: "user-1", realmId: "realm-1" },
      },
    );

    expect(middlewareApp).toBe("user-1:get-bill:get");
    expect(seen).toEqual(["user-1:123"]);
  });

  it("lets middleware set or replace qbo before next", async () => {
    const seen: string[] = [];
    const tools = createQboTools<CoreApp>({
      transport: async (_request, ctx) => {
        seen.push(`${ctx.realmId}:${ctx.accessToken}`);

        return { status: 200, body: billBody };
      },
    }).use(
      wrapRun((next) => async (args, ctx) =>
        next(args, {
          ...ctx,
          qbo: {
            accessToken: "injected",
            realmId: ctx.app.realmId,
            isSandbox: true,
          },
        }),
      ),
    );
    const bill = tools.list().find((tool) => tool.name === "get-bill");

    await bill?.run(
      { params: { id: "1" } },
      { app: { userId: "user-1", realmId: "from-app" } },
    );
    await bill?.run(
      { params: { id: "1" } },
      {
        qbo: { accessToken: "original", realmId: "original", isSandbox: false },
        app: { userId: "user-1", realmId: "replaced" },
      },
    );

    expect(seen).toEqual(["from-app:injected", "replaced:injected"]);
  });

  it("returns a clear error when qbo is still missing after middleware", async () => {
    let called = 0;
    const stripping = createQboTools({
      transport: async () => {
        called += 1;

        return { status: 200, body: billBody };
      },
    }).use(
      wrapRun((next) => async (args, ctx) =>
        next(args, { ...ctx, qbo: undefined }),
      ),
    );
    const stripped = stripping.list().find((tool) => tool.name === "get-bill");

    await expect(
      stripped?.run(
        { params: { id: "1" } },
        { qbo: credentials, app: undefined },
      ),
    ).resolves.toEqual(missingQbo);

    const bare = createQboTools({
      transport: async () => {
        called += 1;

        return { status: 200, body: billBody };
      },
    });
    const bill = bare.list().find((tool) => tool.name === "get-bill");

    await expect(
      bill?.run({ params: { id: "1" } }, { app: undefined }),
    ).resolves.toEqual(missingQbo);
    expect(called).toBe(0);
  });

  it("runs stacked wrapRun middleware in registration order", async () => {
    const order: string[] = [];
    const tools = createQboTools({
      transport: async () => ({ status: 200, body: billBody }),
    })
      .use(
        wrapRun((next) => async (args, ctx) => {
          order.push("A-before");
          const result = await next(args, ctx);
          order.push("A-after");

          return result;
        }),
      )
      .use(
        wrapRun((next) => async (args, ctx) => {
          order.push("B-before");
          const result = await next(args, ctx);
          order.push("B-after");

          return result;
        }),
      );
    const bill = tools.list().find((tool) => tool.name === "get-bill");

    await bill?.run(
      { params: { id: "1" } },
      { qbo: credentials, app: undefined },
    );

    expect(order).toEqual(["A-before", "B-before", "B-after", "A-after"]);
  });

  it("keeps registration order across when and rename", async () => {
    const order: string[] = [];
    const layer = (label: string) =>
      wrapRun((next) => async (args, ctx) => {
        order.push(`${label}-before`);
        const result = await next(args, ctx);
        order.push(`${label}-after`);

        return result;
      });
    const tools = createQboTools({
      transport: async () => ({ status: 200, body: billBody }),
    })
      .use(layer("A"))
      .rename("get-bill", "read_bill")
      .use(when(name("read_bill"), layer("B")))
      .use(
        when(
          name("get-vendor"),
          wrapRun(() => async () => {
            order.push("skipped");

            return { content: [] };
          }),
        ),
      )
      .use(layer("C"));
    const bill = tools.list().find((tool) => tool.name === "read_bill");

    await bill?.run(
      { params: { id: "1" } },
      { qbo: credentials, app: undefined },
    );

    expect(tools.list().some((tool) => tool.name === "get-bill")).toBe(false);
    expect(order).toEqual([
      "A-before",
      "B-before",
      "C-before",
      "C-after",
      "B-after",
      "A-after",
    ]);
  });

  it("puts resolver app and the MCP extra on the middleware context", async () => {
    const seen: Array<{ source: string; extra: unknown; realmId: string }> = [];
    const tools = createQboTools<{ source: string }>({
      transport: async (_request, ctx) => {
        seen.push({
          source: ctx.app.source,
          extra: "transport",
          realmId: ctx.realmId,
        });

        return { status: 200, body: billBody };
      },
    }).use(
      wrapRun((next) => async (args, ctx) => {
        seen.push({
          source: ctx.app.source,
          extra: ctx.extra,
          realmId: ctx.qbo?.realmId ?? "",
        });

        return next(args, ctx);
      }),
    );
    const { registrations, server } = fakeServer();
    tools.register(server, {
      context: (extra) => ({
        qbo: { ...credentials, realmId: "reg-realm" },
        app: { source: "register" },
        extra,
      }),
    });
    const registered = registrations.find((tool) => tool.name === "get-bill");
    await (
      registered?.handler as (
        args: unknown,
        extra?: unknown,
      ) => Promise<unknown>
    )({ params: { id: "1" } }, { requestId: "reg" });

    const handlers = tools.handlers({
      context: async (extra) => {
        expect(extra).toEqual({ requestId: "hand" });

        return {
          qbo: { ...credentials, realmId: "hand-realm" },
          app: { source: "handlers" },
        };
      },
    });
    const readBill = handlers["get-bill"] as (
      args: unknown,
      extra?: unknown,
    ) => Promise<unknown>;
    await readBill({ params: { id: "1" } }, { requestId: "hand" });

    expect(seen).toEqual([
      { source: "register", extra: { requestId: "reg" }, realmId: "reg-realm" },
      { source: "register", extra: "transport", realmId: "reg-realm" },
      { source: "handlers", extra: { requestId: "hand" }, realmId: "hand-realm" },
      { source: "handlers", extra: "transport", realmId: "hand-realm" },
    ]);
  });
});

describe("immutable catalog", () => {
  it("branches two ways from one base and leaves the base in place", () => {
    const base = createQboTools<{ tenant: string }>({
      transport: async () => ({ status: 200, body: {} }),
    }).use(describeTool("shared"));
    const readOnly = base.exclude(isWrite());
    const renamed = base.rename((toolName) =>
      toolName === "get-bill" ? "read_bill" : toolName,
    );
    const bill = base.list().find((tool) => tool.name === "get-bill") as QboTool;
    const added = base.add({
      ...bill,
      name: "get_extra",
      description: "extra",
    });
    const overridden = base.override("get-bill", async () => ({
      content: [{ type: "text" as const, text: "replaced" }],
    }));

    const baseNames = base.list().map((tool) => tool.name);
    expect(baseNames).toContain("create-bill");
    expect(baseNames).toContain("get-bill");
    expect(baseNames).not.toContain("read_bill");
    expect(baseNames).not.toContain("get_extra");
    expect(base.list().find((tool) => tool.name === "get-bill")?.description).toBe(
      "shared",
    );

    const readOnlyNames = readOnly.list().map((tool) => tool.name);
    expect(readOnlyNames.some((toolName) => toolName === "create-bill")).toBe(
      false,
    );
    expect(readOnly.list().some((tool) => isWrite().test(tool))).toBe(false);
    expect(readOnlyNames).toContain("get-bill");
    expect(
      readOnly.list().find((tool) => tool.name === "get-bill")?.description,
    ).toBe("shared");

    const renamedNames = renamed.list().map((tool) => tool.name);
    expect(renamedNames).toContain("read_bill");
    expect(renamedNames).not.toContain("get-bill");
    expect(renamedNames).toContain("create-bill");
    expect(renamed.list().find((tool) => tool.name === "read_bill")?.description).toBe(
      "shared",
    );

    expect(added.list().map((tool) => tool.name)).toContain("get_extra");
    expect(
      overridden.list().find((tool) => tool.name === "get-bill")?.handler,
    ).not.toBe(base.list().find((tool) => tool.name === "get-bill")?.handler);
    expect(base.list().map((tool) => tool.name)).toEqual(baseNames);
  });

  it("renames with a function and still accepts the from/to form", () => {
    const base = createQboTools({
      transport: async () => ({ status: 200, body: {} }),
    });
    const aliases = new Map([
      ["get-bill", "read_bill"],
      ["create-bill", "write_bill"],
    ]);
    const renamed = base.rename((toolName) => aliases.get(toolName) ?? toolName);
    const paired = renamed.rename("read_bill", "fetch_bill");

    expect(base.list().map((tool) => tool.name)).toContain("get-bill");
    expect(base.list().map((tool) => tool.name)).toContain("create-bill");
    expect(renamed.list().map((tool) => tool.name)).toContain("read_bill");
    expect(renamed.list().map((tool) => tool.name)).toContain("write_bill");
    expect(renamed.list().map((tool) => tool.name)).not.toContain("get-bill");
    expect(renamed.list().map((tool) => tool.name)).toContain("get-vendor");
    expect(paired.list().map((tool) => tool.name)).toContain("fetch_bill");
    expect(paired.list().map((tool) => tool.name)).not.toContain("read_bill");
    expect(renamed.list().map((tool) => tool.name)).toContain("read_bill");
  });
});
