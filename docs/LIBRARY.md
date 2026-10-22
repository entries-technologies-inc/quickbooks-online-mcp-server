# QuickBooks Online tools for AI agents

This library gives your app a complete, customizable, and tested catalog of QuickBooks Online MCP tools (read, create, update and delete for bills, invoices, vendors, customers, accounts, reports and more) that you embed directly in your own server instead of running a separate MCP process. You bring the credentials per call, from your own OAuth or token store, and shape the catalog with plain functions: drop tools, rename them, rewrite descriptions or schemas, add access checks, inject context, and control errors, all in one ordered middleware chain. The same catalog can be registered on your own MCP server, turned into Vercel AI SDK or other framework tools with a plain `.map`, or called directly from code.

## What you can build

- **Background jobs and queues:** run tools straight from a worker (Inngest, BullMQ, cron) to reconcile overnight, chase overdue invoices or sync vendors, with safe retries and duplicate-write protection.
- **Event-driven pipelines:** react to a QuickBooks webhook, a Stripe payment or an email by reading or updating invoices, bills and customers from code, with no model involved.
- **A self-hosted MCP server:** a few lines on a home server or a $5 VPS that gives Claude Desktop or Cursor access to your own books.
- **Serverless and edge functions:** each call carries its own credentials and the transport is plain `fetch`, so tools run fine in Lambda, Vercel or Cloudflare-style runtimes.
- **Multi-company AI assistants:** one agent serving many QuickBooks companies, with access checks and client context added in middleware.
- **Human-in-the-loop write flows:** swap the built-in create tools for draft-and-approve versions so nothing posts without sign-off.
- **CLIs and scripts:** one-off migrations, bulk cleanups or month-end reports, written against the same tested tools instead of hand-rolled API calls.
- **Testing and demos:** point the transport at a mock or the sandbox to build fixtures, or demo an integration without touching real books.

## Features

- **Embeddable:** runs inside your own app or server. There's no separate process to deploy or keep alive.
- **Multi-tenant:** every call carries its own QuickBooks company and credentials, so one app can safely serve many companies at once.
- **Fully customizable:** hide, rename or rewrite any tool, change what it accepts, or add your own, without forking the catalog.
- **Middleware:** add access checks, logging, context or post-write sync in one place, in a familiar run-in-order style like Express or Hono.
- **Your own app context:** your users, organizations and clients flow through every tool call, so tools can act on behalf of the right person.
- **Consistent errors:** every failure comes back in one predictable shape that you control.
- **Lightweight, customizable transport:** a small, dependency-light HTTP client you can swap or extend, with optional safe retries and duplicate-write protection.
- **Multicurrency:** create and update transactions in foreign currencies with their exchange rates (invoices, payments, receipts, credit memos, purchase orders, vendor credits, deposits and transfers), and set the currency on vendors and accounts.
- **Improvements on the stock QuickBooks MCP server:** bug fixes and refinements on top of the official server, with upstream changes reviewed and pulled in regularly.
- **Works anywhere:** plug into an MCP server, an AI SDK, a background job or a plain script.
- **Well tested:** hundreds of tests covering the tools, customization and transport.

## QuickBooks Online tools as a library

Import the embed entry. It does not load the OAuth client, `dotenv`, or `open`.

```ts
import { createQboTools } from "@qboapi/qbo-mcp-server/embed";
```

Package: `@qboapi/qbo-mcp-server`. `zod` is a peer dependency. `npm run build` emits `dist/embed.js` and `dist/embed.d.ts`. `package.json` `exports["./embed"]` points `types` at the declarations.

Build one catalog and call it with a fresh context. Do not rebuild the 142 tools when a token changes.

Catalog tool names are snake_case (`get_bill`, `create_vendor`). Upstream still registers eight bill and vendor tools with hyphens (`create-bill`, `update-bill`, `delete-bill`, `get-bill`, `create-vendor`, `update-vendor`, `delete-vendor`, `get-vendor`). Syncs from upstream must keep those names snake_case. `rename(from, to)` and `rename(fn)` stay available when a caller wants a different name. How this fork differs from upstream, and how to merge it: [docs/UPSTREAM.md](UPSTREAM.md).

## Quick start

```ts
import { createQboTools, isWrite } from "@qboapi/qbo-mcp-server/embed";

const tools = createQboTools<App>({ transport }).exclude(isWrite());

const bill = tools.list().find((tool) => tool.name === "get_bill");
await bill?.run(
  { id: "1" },
  {
    qbo: { accessToken, realmId, isSandbox: true },
    app,
  },
);
```

`run(params, ctx)` takes the tool's params directly (`{ id: "1" }` for get_bill). `wrapRun` receives that same object as `args`. A thrown handler comes back as `{ isError: true, content: [{ type: "text", text }] }` unless you pass `formatError`. A catalog handler that fails returns `{ content, isError: true }` (for example `Error creating bill`). That result goes through `formatError` when you set one, and is left as returned when you do not. Success results do not set `isError`.

## Transport

```ts
type Transport<TApp> = (
  request: QboHttpRequest,
  ctx: QboCallContext<TApp>,
) => Promise<QboHttpResponse>;
```

`request` is `{ op, method, path, query?, body?, accept? }`. `path` is the QuickBooks path (`/bill/1`, `/query`, `/reports/ProfitAndLoss`), not a full URL. `op.kind` is `get`, `query`, `report`, `create`, `update`, `delete`, or `void`. For entities, `op.entity` is the Intuit name (`Bill`, `BillPayment`), not the URL slug. Reports use `op.report`.

`ctx` carries `app` plus `realmId`, `accessToken`, `isSandbox`, `baseUrl`, and `queryDefaults`. It does not include the transport function. A unit test can call your transport with `{ realmId, accessToken, baseUrl, isSandbox, app }`. The library fills those fields from `ctx.qbo` before your transport runs, and applies query defaults (`minorversion`, `format`) onto `request.query` first.

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

`queryDefaults` on `qbo`, when set, overrides the defaults passed to `createQboTools`. `false` omits that query param. `qbo` is structural: a session object with extra fields (a connection id, for example) can be passed as `ctx.qbo` without copying the credential fields off it.

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

Middleware runs in the order added (first added is outermost). Code after `next` runs on the way back, so a later middleware finishes before an earlier one.

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
| `name("get_bill")` | that tool name |
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

`isRead().not()` matches every write, including void. `name("get_bill").or(entity("Invoice"))` matches either side. `exclude(isWrite())` drops every write (`delete_invoice` is a void).

## Builder

`exclude`, `use`, `rename`, `override`, and `add` return a new `QboTools` and do not change the receiver. One catalog can be branched per caller.

```ts
const aliases = new Map([["get_bill", "read_bill"]]);
const base = createQboTools<App>({ transport }).use(injectQbo);
const readOnly = base.exclude(isWrite());
const aliased = base.rename((toolName) => aliases.get(toolName) ?? toolName);
```

`base` still has writes and the original names.

`rename` also takes a pair: `.rename("create_bill", "make_bill")`. `override(name, handler)` replaces the MCP handler and leaves `wrapRun` layers in place. `add(tool)` appends a tool. The tool needs `name`, `description`, `schema`, `handler`, and `meta`.

`register` and `handlers` do not copy the catalog. They close over the tools on that builder.

## Calling tools

Listed tools:

```ts
const listed = tools.list();
await listed.find((tool) => tool.name === "get_bill")?.run(
  { id: "1" },
  { qbo, app },
);
```

`list()` returns a new array. Mutating that array does not change the builder. `QboTools<App>` and `QboListedTool<App>` are exported from `./embed` for a catalog parameter.

Register on an MCP server. `context` is an object or `(extra) => ctx | Promise<ctx>`, called on every invocation. `extra` is also stored on `ctx.extra`.

```ts
tools.register(server, {
  context: (extra) => ({ qbo, app }),
});
```

Handlers are the MCP functions, keyed by tool name. The MCP handler is still `(args, extra) => result`, and `args` is `{ params }` because that is how the tool is registered. `run` does not use that wrapper. The library unwraps `params` before `wrapRun`, and wraps them again only when it calls the original handler.

```ts
const handlers = tools.handlers({ context: { qbo, app } });
await handlers["get_bill"]?.({ params: { id: "1" } }, extra);
```

## Another framework

`list().map` is the adapter. The zod schema is the tool params, and `run` takes those params directly.

```ts
import { tool } from "ai";

const aiTools = Object.fromEntries(
  tools.list().map((qboTool) => [
    qboTool.name,
    tool({
      description: qboTool.description,
      inputSchema: qboTool.schema,
      execute: (params) => qboTool.run(params, { qbo, app }),
    }),
  ]),
);
```

## Errors

`run`, `register`, and `handlers` catch throws from middleware and from the tool handler, including a missing `qbo`. The default result is:

```ts
{ isError: true, content: [{ type: "text", text: "Error: <message>" }] }
```

Pass `formatError` to return your own shape instead of catching around `run`:

```ts
const tools = createQboTools<App>({
  transport,
  formatError: (error, tool) => ({
    isError: true,
    tool: tool.name,
    message: error instanceof Error ? error.message : String(error),
  }),
});
```

`formatError` is `(error, tool) => unknown`. A branched catalog keeps the same function. It runs for a throw and for a returned MCP error result (`{ content, isError: true }`). The value passed for a returned result is an `Error` whose message is the text content, for example `Error creating bill`. Several text parts are joined with newlines. Content that is not text becomes `Unknown error`. When `formatError` is omitted, a returned `{ isError: true }` result is unchanged.

Every catalog tool, including the list the standalone server registers, passes its result through `markCatalogFailure`. Failure text that starts with `Error` or `Invalid criteria:` is returned as `{ content, isError: true }`. A success result is the handler's object, with no `isError` field.

## Tool metadata

Every tool has `meta.op`:

```ts
{ kind: "get", entity: "Bill" }
{ kind: "void", entity: "Invoice" }
{ kind: "report", report: "GeneralLedger" }
```

`meta.entity` is set for entity tools and omitted for reports. `meta.op.kind` is what `isRead`, `isWrite`, and `op` use.
