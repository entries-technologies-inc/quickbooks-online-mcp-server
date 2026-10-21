import type { QboTool } from "./qbo-tool.js";
import type { QboOperation } from "./transport.js";

export type QboToolPredicate = {
  test: (tool: QboTool) => boolean;
  and: (other: QboToolPredicate) => QboToolPredicate;
  or: (other: QboToolPredicate) => QboToolPredicate;
  not: () => QboToolPredicate;
};

export type ToolMiddleware = (tool: QboTool) => QboTool;

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

export function when(
  predicate: QboToolPredicate,
  middleware: ToolMiddleware,
): ToolMiddleware {
  return (tool) => (predicate.test(tool) ? middleware(tool) : tool);
}

export function describe(description: string): ToolMiddleware {
  return (tool) => ({ ...tool, description });
}

export function rename(from: string, to: string): ToolMiddleware {
  return (tool) => (tool.name === from ? { ...tool, name: to } : tool);
}

export function wrapRun(
  wrap: (handler: QboTool["handler"], tool: QboTool) => QboTool["handler"],
): ToolMiddleware {
  return (tool) => ({ ...tool, handler: wrap(tool.handler, tool) });
}

export function pipe(...middlewares: ToolMiddleware[]): ToolMiddleware {
  return (tool) =>
    middlewares.reduce((current, middleware) => middleware(current), tool);
}
