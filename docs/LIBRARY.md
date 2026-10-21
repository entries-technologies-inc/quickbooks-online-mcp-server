# QuickBooks Online tools as a library

Import the embed entry. It does not load the OAuth client, `dotenv`, or `open`.

```ts
import { createQboTools } from "@qboapi/qbo-mcp-server/embed";
```

Package: `@qboapi/qbo-mcp-server`. `zod` is a peer dependency. `npm run build` emits `dist/embed.js` and `dist/embed.d.ts`. `package.json` `exports["./embed"]` points `types` at the declarations.

Build one catalog and call it with a fresh context. Do not rebuild the 142 tools when a token changes.

## Quick start

```ts
import { createQboTools, isWrite } from "@qboapi/qbo-mcp-server/embed";

const tools = createQboTools<App>({ transport }).exclude(isWrite());

const bill = tools.list().find((tool) => tool.name === "get-bill");
await bill?.run(
  { params: { id: "1" } },
  {
    qbo: { accessToken, realmId, isSandbox: true },
    app,
  },
);
```

`run` arguments are `{ params }` matching the tool's zod schema. A thrown handler comes back as `{ isError: true, content: [{ type: "text", text }] }`.

## Transport

```ts
type Transport<TApp> = (
  request: QboHttpRequest,
  ctx: QboCallContext<TApp>,
) => Promise<QboHttpResponse>;
```

`request` is `{ op, method, path, query?, body?, accept? }`. `path` is the QuickBooks path (`/bill/1`, `/query`, `/reports/ProfitAndLoss`), not a full URL. `op.kind` is `get`, `query`, `report`, `create`, `update`, `delete`, or `void`. For entities, `op.entity` is the Intuit name (`Bill`, `BillPayment`), not the URL slug. Reports use `op.report`.

`ctx` carries `app` plus `realmId`, `accessToken`, `isSandbox`, `baseUrl`, and `queryDefaults`. The library fills those from `ctx.qbo` on the tool call before your transport runs. It also applies query defaults (`minorversion`, `format`) onto `request.query` first.

The library calls the transport raw. Retries and `requestid` are opt-in.

```ts
import type { Transport } from "@qboapi/qbo-mcp-server/embed";

const rawFetch: Transport<App> = async (request, ctx) => {
  const base =
    ctx.baseUrl ??
    (ctx.isSandbox
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com");
  const url = new URL(`/v3/company/${ctx.realmId}${request.path}`, base);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: request.accept ?? "application/json",
      ...(request.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      request.body === undefined ? undefined : JSON.stringify(request.body),
  });

  const raw = await response.text();
  return {
    status: response.status,
    body: raw ? JSON.parse(raw) : null,
    headers: Object.fromEntries(response.headers),
  };
};
```

`request.accept` is `application/pdf` for PDF reads. Parse those as bytes instead of JSON.

Other backends are the same function. A Nango proxy sketch sends the same path and query through Nango, with Nango's secret and the connection id taken from `ctx.app`, and returns `{ status, body, headers }`. A node-quickbooks-shaped backend does not call `getBill` / `createInvoice` itself: this library already builds that HTTP request. Implement `Transport` and send `request` with a bearer token, as above.

## withRequestId and withRetry

Neither wrapper is applied for you.

```ts
import { withRequestId, withRetry } from "@qboapi/qbo-mcp-server/embed";

const transport = withRequestId(withRetry()(rawFetch));
```

`withRequestId` sets `query.requestid` on writes (`create`, `update`, `delete`, `void`) when it is missing. Reads pass through. An id already on the query is kept. The check uses `request.op.kind` only.

`withRetry` retries `429`, `500`, `502`, `503`, and `504` (override with `retryOn`). The default budget is 3 attempts. The wait is exponential from 250ms with jitter, capped at 10s. A `Retry-After` header on `response.headers` replaces that wait and is capped the same way. Reads also retry when the inner transport throws. A write retries only when `query.requestid` is already set.

Put `withRequestId` outside `withRetry`. The id is chosen once and sent on every attempt. QuickBooks treats it as an idempotency key. `withRetry` will not retry a write that arrives without `requestid`, so generating the id inside the retry loop does not retry the write. A new id per attempt would also make a replay look like a different write.

`withRetry()(transport)` keeps the transport's app type. `ctx.app` inside the wrapped transport is the same `TApp` you passed to `createQboTools`.

## Call context

```ts
type QboToolCallContext<TApp> = {
  qbo?: {
    accessToken: string;
    realmId: string;
    isSandbox: boolean;
    baseUrl?: string;
    queryDefaults?: QueryDefaults;
  };
  app: TApp;
  extra?: unknown;
};
```

`qbo` and `app` stay separate. `qbo` may be omitted on the way in. The tool chain can set it. If it is still missing when the handler runs, the call fails with `QuickBooks context missing: pass ctx.qbo or set it in middleware`.

`queryDefaults` on `qbo`, when set, overrides the defaults passed to `createQboTools`. `false` omits that query param.

`extra` is the raw MCP request extra when the tool runs through `register` or `handlers`. `run` leaves it unset unless you set `ctx.extra` yourself. Middleware reads it on the context. It is not a second argument.

```ts
const tools = createQboTools<App>({ transport, queryDefaults });
```

`App` is `ctx.app` in `wrapRun` and in the transport. No cast. Passed straight into `.use()`, `wrapRun` infers `App`. A middleware you store on its own takes the type argument: `wrapRun<App>(...)`.

`QboEmbedContext<TApp>` is the same type.

## Tool middleware

`wrapRun` wraps the run chain. `next` is the rest of the chain. Pass a new context to replace it. There is no separate `withContext` helper.

```ts
import { describe, isWrite, when, wrapRun } from "@qboapi/qbo-mcp-server/embed";

const logged = createQboTools<App>({ transport }).use(
  wrapRun((next, tool) => async (args, ctx) => {
    console.log(tool.name, ctx.app.tenant);
    return next(args, ctx);
  }),
);
```

Access check. A throw becomes an `isError` result.

```ts
const guarded = logged.use(
  wrapRun((next, tool) => async (args, ctx) => {
    if (isWrite().test(tool) && !ctx.app.canWrite) {
      throw new Error("write blocked");
    }
    return next(args, ctx);
  }),
);
```

Inject QuickBooks credentials from app data. The handler and the transport then see that `qbo`.

```ts
const injectQbo = wrapRun<App>((next) => async (args, ctx) => {
  const accessToken = await ctx.app.tokenFor(ctx.app.realmId);
  return next(args, {
    ...ctx,
    qbo: {
      accessToken,
      realmId: ctx.app.realmId,
      isSandbox: ctx.app.sandbox,
    },
  });
});
const withAuth = guarded.use(injectQbo);
```

Post-write hook. `tool.meta.op` is the operation that just ran.

```ts
const audited = withAuth.use(
  when(
    isWrite(),
    wrapRun((next, tool) => async (args, ctx) => {
      const result = await next(args, ctx);
      await ctx.app.afterWrite(tool.meta.op, result);
      return result;
    }),
  ),
);
```

`.use()` applies each middleware outside the ones already applied. The last `wrapRun` runs first.

`ToolMiddleware<TApp>` is `(tool) => tool`. Changing a description per tool is that function. `describe` stays a string.

```ts
const described = audited.use((tool) => ({
  ...tool,
  description: `${tool.description} (${tool.meta.op.kind})`,
}));
const oneDescription = described.use(describe("one description for every tool"));
```

Copy the tool when you change it (`{ ...tool }`). That keeps `wrapRun` layers. Returning the same object is fine when you do not change it.

## Predicates

`exclude` and `when` take a tool name, a list of names, `(tool) => boolean`, or a predicate.

| Helper | Matches |
| --- | --- |
| `isRead()` | `get`, `query`, `report` |
| `isWrite()` | `create`, `update`, `delete`, `void` |
| `op(kind)` | that `meta.op.kind` |
| `entity("Bill")` | that Intuit entity. Reports do not match. |
| `name("get-bill")` | that tool name |
| `pred((tool) => ...)` | your test |

`and`, `or`, and `not` combine predicates. `when(predicate, middleware)` runs the middleware only when the predicate matches.

```ts
import {
  entity,
  isRead,
  isWrite,
  name,
  op,
  pred,
} from "@qboapi/qbo-mcp-server/embed";

const narrowed = oneDescription
  .exclude(isWrite())
  .exclude(name("get_invoice_pdf"))
  .exclude(["read_item", "search_bills"])
  .exclude(entity("Invoice").and(op("void")))
  .exclude(pred((tool) => tool.meta.op.kind === "report"));
```

`isRead().not()` matches every write, including void. `name("get-bill").or(entity("Invoice"))` matches either side. `exclude(isWrite())` drops every write (`delete_invoice` is a void).

## Builder

`exclude`, `use`, `rename`, `override`, and `add` return a new `QboTools` and do not change the receiver. One catalog can be branched per caller.

```ts
const aliases = new Map([["get-bill", "read_bill"]]);
const base = createQboTools<App>({ transport }).use(injectQbo);
const readOnly = base.exclude(isWrite());
const aliased = base.rename((toolName) => aliases.get(toolName) ?? toolName);
```

`base` still has writes and the original names.

`rename` also takes a pair: `.rename("create-bill", "create_bill")`. `override(name, handler)` replaces the MCP handler and leaves `wrapRun` layers in place. `add(tool)` appends a tool. The tool needs `name`, `description`, `schema`, `handler`, and `meta`.

`register` and `handlers` do not copy the catalog. They close over the tools on that builder.

## Calling tools

Listed tools:

```ts
const listed = tools.list();
await listed.find((tool) => tool.name === "get-bill")?.run(
  { params: { id: "1" } },
  { qbo, app },
);
```

`list()` returns a new array. Mutating that array does not change the builder.

Register on an MCP server. `context` is an object or `(extra) => ctx | Promise<ctx>`, called on every invocation. `extra` is also stored on `ctx.extra`.

```ts
tools.register(server, {
  context: (extra) => ({ qbo, app }),
});
```

Handlers are the same functions, keyed by tool name. The MCP handler is still `(args, extra) => result`.

```ts
const handlers = tools.handlers({ context: { qbo, app } });
await handlers["get-bill"]?.({ params: { id: "1" } }, extra);
```

## Another framework

`list().map` is the adapter. The zod schema is the `params` object, so wrap the model's arguments.

```ts
import { tool } from "ai";

const aiTools = Object.fromEntries(
  tools.list().map((qboTool) => [
    qboTool.name,
    tool({
      description: qboTool.description,
      inputSchema: qboTool.schema,
      execute: (params) => qboTool.run({ params }, { qbo, app }),
    }),
  ]),
);
```

## Errors

`run`, `register`, and `handlers` catch throws. The result is:

```ts
{ isError: true, content: [{ type: "text", text: "Error: <message>" }] }
```

That includes a missing `qbo`, a throw inside `wrapRun`, and a throw from the tool handler. QuickBooks faults that a handler catches itself are whatever content that handler returns.

## Tool metadata

Every tool has `meta.op`:

```ts
{ kind: "get", entity: "Bill" }
{ kind: "void", entity: "Invoice" }
{ kind: "report", report: "GeneralLedger" }
```

`meta.entity` is set for entity tools and omitted for reports. `meta.op.kind` is what `isRead`, `isWrite`, and `op` use.
