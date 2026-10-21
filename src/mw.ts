import type { QueryDefaults } from "./query-defaults.js";
import type { QboTool } from "./qbo-tool.js";
import type { QboOperation } from "./transport.js";

export type QboCredentials = {
  accessToken: string;
  realmId: string;
  isSandbox: boolean;
  baseUrl?: string;
  queryDefaults?: QueryDefaults;
  /** Extra session fields may ride along. Callers do not have to copy them off. */
  [extra: string]: unknown;
};

/**
 * Per-call context. `qbo` and `app` stay separate.
 * `qbo` may be omitted on the way in and filled in by tool middleware.
 * `extra` is the raw MCP request extra when the tool was invoked through
 * `register` or `handlers`. `run` leaves it unset unless the caller sets it.
 * It is not a separate argument to middleware.
 */
export type QboToolCallContext<TApp = unknown> = {
  qbo?: QboCredentials;
  app: TApp;
  extra?: unknown;
};

export type ToolRun<TApp = unknown> = (
  args: unknown,
  ctx: QboToolCallContext<TApp>,
) => Promise<unknown>;

/**
 * `TApp` is carried on the return type so `createQboTools<App>().use(wrapRun(...))`
 * infers `ctx.app` as `App`. The `__app` field is never set.
 */
export type ToolMiddleware<TApp = any> = (
  tool: QboTool,
) => QboTool & { readonly __app?: QboToolCallContext<TApp> };

export type QboToolPredicate = {
  test: (tool: QboTool) => boolean;
  and: (other: QboToolPredicate) => QboToolPredicate;
  or: (other: QboToolPredicate) => QboToolPredicate;
  not: () => QboToolPredicate;
};

const READ_KINDS = new Set<QboOperation["kind"]>(["get", "query", "report"]);
const WRITE_KINDS = new Set<QboOperation["kind"]>([
  "create",
  "update",
  "delete",
  "void",
]);

export function pred(match: (tool: QboTool) => boolean): QboToolPredicate {
  const predicate: QboToolPredicate = {
    test: match,
    and: (other) => pred((tool) => match(tool) && other.test(tool)),
    or: (other) => pred((tool) => match(tool) || other.test(tool)),
    not: () => pred((tool) => !match(tool)),
  };

  return predicate;
}

export function name(toolName: string): QboToolPredicate {
  return pred((tool) => tool.name === toolName);
}

export function entity(entityName: string): QboToolPredicate {
  return pred(
    (tool) =>
      tool.meta.op.kind !== "report" && tool.meta.op.entity === entityName,
  );
}

export function op(kind: QboOperation["kind"]): QboToolPredicate {
  return pred((tool) => tool.meta.op.kind === kind);
}

export function isRead(): QboToolPredicate {
  return pred((tool) => READ_KINDS.has(tool.meta.op.kind));
}

export function isWrite(): QboToolPredicate {
  return pred((tool) => WRITE_KINDS.has(tool.meta.op.kind));
}

export function when<TApp = any>(
  predicate: QboToolPredicate,
  middleware: ToolMiddleware<TApp>,
): ToolMiddleware<TApp> {
  return (tool) => (predicate.test(tool) ? middleware(tool) : tool);
}

export function describe<TApp = any>(description: string): ToolMiddleware<TApp> {
  return (tool) => ({ ...tool, description });
}

export function rename<TApp = any>(
  from: string,
  to: string,
): ToolMiddleware<TApp> {
  return (tool) => (tool.name === from ? { ...tool, name: to } : tool);
}

/**
 * Wrap the tool's run chain. `next` is the rest of the chain, not the MCP
 * handler. Return `next(args, ctx)` or `next(args, newCtx)` to replace the
 * call context. The innermost step reads `ctx.qbo` after every wrapper.
 */
export function wrapRun<TApp>(
  wrap: (next: ToolRun<TApp>, tool: QboTool) => ToolRun<TApp>,
): ToolMiddleware<TApp> {
  return (tool) => ({
    ...tool,
    runLayers: [...(tool.runLayers ?? []), wrap],
  });
}

export function pipe<TApp = any>(
  ...middlewares: ToolMiddleware<TApp>[]
): ToolMiddleware<TApp> {
  return (tool) =>
    middlewares.reduce((current, middleware) => middleware(current), tool);
}
