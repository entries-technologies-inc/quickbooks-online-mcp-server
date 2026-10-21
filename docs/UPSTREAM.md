# Upstream sync

This fork is `entries-technologies-inc/quickbooks-online-mcp-server`. Upstream is `intuit/quickbooks-online-mcp-server`. This note is for an agent reconciling an upstream merge. It was written against upstream `main` at `31a1dd5` (`fix: make tests and CI cross-platform`). Re-diff before you sync. Upstream moves.

**Hard rule.** Sync pull requests go only to `entries-technologies-inc/quickbooks-online-mcp-server`, base `main`. Never open a pull request, issue, or comment on `intuit/quickbooks-online-mcp-server`. Fetching upstream to diff is fine. Pushing, reviewing, or commenting there is not.

## What this fork is for

Entries Core loads QuickBooks tools as a library. It imports `@qboapi/qbo-mcp-server/embed` (and the package root, which is the same build). Core passes a `Transport` and a per-call context. It does not take a runtime dependency on `node-quickbooks`.

The standalone MCP server, OAuth browser flow, and `auth-server` are still in the tree. They are not what Core runs. Removing them is tracked in Linear ENT-894. Package versioning for Core is tracked in Linear ENT-893. Do not bump the version or delete those files as part of an upstream sync.

## How to take an upstream change

| Area | Rule |
| --- | --- |
| New or changed tool, handler, or zod schema | Port into our catalog. Register it from `src/tools/catalog.ts` with `TOOL_META`. Keep bill and vendor CRUD names snake_case (table below). Add or extend a jest test under `tests/unit`. Do not paste the tool back into `src/index.ts`. |
| `node-quickbooks` request shape (entity, query, report, minorversion, format) | Port into `src/quickbooks-proxy.ts`, `src/quickbooks-method-specs.ts`, `src/query-defaults.ts`, `src/criteria-to-query.ts`, or `src/report-query.ts`. Keep the ISC credit header. Update `tests/unit/node-quickbooks-parity.test.ts`. |
| `src/index.ts` wiring, `src/auth-server.ts`, `src/clients/quickbooks-oauth.ts`, `intuit-oauth` | Ignore. Those are the standalone server. ENT-894 removes them. A new tool that only shows up as an import in upstream `index.ts` is still ported, via the catalog, not via `index.ts`. |
| `.github/workflows/claude.yml`, `.github/workflows/claude-code-review.yml` | Ignore. We deleted them. |
| `ci.yml`, `dependency-audit.yml`, `CODEOWNERS` | Apply as-is. They match upstream today. |
| Security pin or override that does not put `node-quickbooks` back in `dependencies` | Apply as-is. Keep the `follow-redirects` `1.16.1` override. |
| Anything that imports `node-quickbooks`, `intuit-oauth`, `dotenv`, or `open` from a file the embed build compiles | Do not apply that import. The embed graph must stay free of those modules. |

Modify/delete conflicts: keep our deletion. If upstream edits a file we removed, resolve the conflict by leaving the file deleted. That is the Claude workflows today. Do not recreate them to get a clean merge.

Modify/modify conflicts on `src/clients/quickbooks-client.ts`: upstream's file is the `node-quickbooks` client. Ours is the transport client. Do not restore upstream's file. Port API-call behavior into the proxy. Leave token refresh and the browser flow in `quickbooks-oauth.ts` alone.

## Deviations

Compared with upstream `main` at `31a1dd5`.

### Package shape

`npm run build` (`tsc`) emits `dist/embed.js` and `dist/embed.d.ts`. It does not emit `dist/index.js`.

`tsconfig.json` sets `declaration: true` and excludes `src/index.ts`, `src/auth-server.ts`, and `src/clients/quickbooks-oauth.ts`. `tsconfig.cli.json` typechecks those three with `npx tsc -p tsconfig.cli.json --noEmit`. It is not the emit config.

`package.json`:

- `license` is `Apache-2.0` (upstream's field was `MIT`). The `LICENSE` file is unchanged from upstream.
- `main` and `exports["."]` point at the embed build, with the same `types` / `import` / `default` shape as `exports["./embed"]`.
- `bin` is removed. The `auth` script is removed.
- `zod` is a peer dependency (`^4`) and a dev dependency (`4.3.6`). Upstream depended on zod 3.
- `@modelcontextprotocol/sdk` is `^1.30.0` (upstream was `^1.26.0`).
- `intuit-oauth` is pinned to `git+https://github.com/arsindelve/oauth-jsclient.git#e3494ff788ed8cc86e71658801e4f8c3065ace47`, not the npm `^4.2.5` package. ENT-894 is what removes this dependency.
- `node-quickbooks` is a devDependency, for parity tests only. Upstream had it in `dependencies`.
- `overrides` still pins `node-quickbooks`'s `fast-xml-parser`, `underscore`, and `uuid`, and pins `follow-redirects` to `1.16.1`.

### Transport instead of node-quickbooks

Handlers call `QuickbooksClient` from `src/clients/quickbooks-client.ts`. That file must not import `node-quickbooks`, `intuit-oauth`, `dotenv`, or `open`. With an injected context it builds `createQuickbooksProxy`. Otherwise it uses the OAuth fallback registered from `src/index.ts`.

Ported from node-quickbooks 2.0.50, each with an ISC credit header (Copyright 2014 Michael Cohen):

- `src/quickbooks-proxy.ts`
- `src/quickbooks-method-specs.ts`
- `src/query-defaults.ts`
- `src/criteria-to-query.ts`
- `src/report-query.ts`

The proxy get trap only treats own properties of `QUICKBOOKS_METHOD_SPECS` as methods (`Object.prototype.hasOwnProperty.call`). Inherited names (`toString`, and the rest) go through `Reflect.get`. `String(proxy)` must not hit the transport.

`QboHttpRequest.op` is the semantic operation (`get`, `query`, `report`, `create`, `update`, `delete`, `void`). Entity names are Intuit names (`Bill`), not URL slugs.

### Embed API

`src/embed.ts` is the public entry. `createQboTools` builds one catalog. Callers pass context per call. Do not rebuild the catalog when a token changes.

- Context is `{ qbo?, app, extra? }`. `qbo` and `app` stay separate. `qbo` may carry extra fields. Missing `qbo` at the handler throws `QuickBooks context missing: pass ctx.qbo or set it in middleware`.
- `run(params, ctx)` takes the tool params, not `{ params }`. MCP `register` / `handlers` still use `{ params }` at the boundary.
- `exclude`, `use`, `rename`, `override`, and `add` return a new catalog. `rename` accepts `(from, to)` or `(name) => string`. `add` and `rename` throw `Duplicate QuickBooks tool name "..."` when the result would have two tools with the same name.
- Middleware runs in registration order. The first `.use()` is outermost.
- `withRequestId` and `withRetry` are exported and not applied by default. The order is `withRequestId(withRetry()(transport))`.
- `formatError` is optional. The default error shape is `{ isError: true, content: [{ type: "text", text }] }`.

`./embed` does not export `runWithQuickbooksContext` or `createQuickbooksProxy`. The public `Transport<TApp>` and `QboToolCallContext` require `app`.

### Tool names

File names stay hyphenated. These eight registered names are snake_case. Upstream still uses the hyphen. A sync that copies `toolName` from upstream must rename them again.

| Upstream | This fork |
| --- | --- |
| `create-bill` | `create_bill` |
| `update-bill` | `update_bill` |
| `delete-bill` | `delete_bill` |
| `get-bill` | `get_bill` |
| `create-vendor` | `create_vendor` |
| `update-vendor` | `update_vendor` |
| `delete-vendor` | `delete_vendor` |
| `get-vendor` | `get_vendor` |

Every other tool name was already snake_case on both sides. `src/tools/catalog.ts` is the list `src/index.ts` registers. `src/tools/meta.ts` has one entry per name. `delete_invoice` is `void`.

Write tools Entries Core calls use `z.strictObject()`. `src/helpers/register-tool.ts` still warns on unknown keys for plain `z.object()` schemas, and it still treats both `create_` and `create-` as disable prefixes. `src/helpers/currency-fields.helper.ts` is fork-only multicurrency input.

### Standalone server

`src/index.ts` loops `qboTools` and registers an OAuth fallback. Upstream inlined every tool import in `index.ts`. Keep our loop. `ListInvoices` and `ListAccounts` stay unregistered.

`src/clients/quickbooks-oauth.ts` is the old client, moved out of `quickbooks-client.ts` so the embed build can exclude it. It still has its own async-local store. Nothing on the embed path writes to that store. Do not merge it back into `quickbooks-client.ts`.

### Workflows

Deleted, and they stay deleted:

- `.github/workflows/claude.yml`
- `.github/workflows/claude-code-review.yml`

`.github/workflows/ci.yml`, `.github/workflows/dependency-audit.yml`, and `.github/CODEOWNERS` match upstream. There is no CodeRabbit config file in this repo or in upstream `31a1dd5`. CodeRabbit on our pull requests is the Entries organization app, not a file to sync.

### Tests and docs

Tests are jest under `tests/unit`, run with `node --experimental-vm-modules`. The coverage gate is 100% except the floors in `jest.config.js`. The OAuth floor is `src/clients/quickbooks-oauth.ts` (upstream pointed that floor at `quickbooks-client.ts`). Search-tool floors cover dead arms in `search-accounts`, `search-invoices`, and `search-items`.

`docs/LIBRARY.md` is the embed guide. The README embed section links here and there. Upstream has neither.

## Planned work that is not this sync

- ENT-894: remove the standalone server (`src/index.ts`, `src/auth-server.ts`, `src/clients/quickbooks-oauth.ts`) and the `intuit-oauth` dependency.
- ENT-893: version this package for Entries Core.

Leave both for those issues. An upstream sync does not do them.
