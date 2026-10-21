import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runWithQuickbooksContext } from "./clients/quickbooks-client.js";
import { formatError as formatErrorMessage } from "./helpers/format-error.js";
import { RegisterTool } from "./helpers/register-tool.js";
import {
  rename as renameTool,
  type QboCredentials,
  type QboToolCallContext,
  type QboToolPredicate,
  type ToolMiddleware,
  type ToolRun,
} from "./mw.js";
import type { QboRunLayer, QboTool } from "./qbo-tool.js";
import { qboTools } from "./tools/catalog.js";
import { attachToolMeta } from "./tools/meta.js";
import type { QueryDefaults } from "./query-defaults.js";
import type { Transport } from "./transport.js";

export type { QboTool, QboCredentials, QboToolCallContext };

/** Same shape as {@link QboToolCallContext}. */
export type QboEmbedContext<TApp = unknown> = QboToolCallContext<TApp>;

export type QboFormatError = (error: unknown, tool: QboTool) => unknown;

export type QboToolsOptions<TApp = unknown> = {
  transport: Transport<TApp>;
  queryDefaults?: QueryDefaults;
  /**
   * Shapes a thrown middleware or handler error, including a missing `qbo`.
   * Also shapes a returned `{ content, isError: true }` result. That error is
   * an `Error` whose message is the text content.
   * When omitted, thrown errors use
   * `{ isError: true, content: [{ type: "text", text }] }` and a returned
   * `{ isError: true }` result is left as the handler returned it.
   */
  formatError?: QboFormatError;
};

/** Resolved on each tool call. `extra` is the MCP request extra when registered. */
export type QboEmbedContextResolver<TApp = unknown> = (
  extra: unknown,
) => QboToolCallContext<TApp> | Promise<QboToolCallContext<TApp>>;

export type QboListedTool<TApp = unknown> = QboTool & {
  /** `params` is the tool input, not an MCP `{ params }` wrapper. */
  run: (params: unknown, ctx: QboToolCallContext<TApp>) => Promise<unknown>;
};

type ContextSource<TApp> =
  | QboToolCallContext<TApp>
  | QboEmbedContextResolver<TApp>;

type ExcludeSelector =
  string | string[] | QboToolPredicate | ((tool: QboTool) => boolean);

export const MISSING_QBO_CONTEXT =
  "QuickBooks context missing: pass ctx.qbo or set it in middleware";

function defaultFormatCallError(error: unknown): unknown {
  return {
    isError: true,
    content: [{ type: "text" as const, text: formatErrorMessage(error) }],
  };
}

function isReturnedMcpError(
  result: unknown,
): result is { content?: unknown; isError: true } {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

/** Message is the text parts of `content`, joined when there is more than one. */
function errorFromReturnedMcpError(result: { content?: unknown }): Error {
  const content = result.content;
  if (!Array.isArray(content)) return new Error("Unknown error");

  const texts: string[] = [];
  for (const part of content) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      texts.push((part as { text: string }).text);
    }
  }

  return new Error(texts.length > 0 ? texts.join("\n") : "Unknown error");
}

/** MCP tools are registered as `{ params }`. `run` speaks the inner object. */
function paramsFromMcpArgs(args: unknown): unknown {
  return (args as { params: unknown }).params;
}

function toolIsExcluded(selector: ExcludeSelector): (tool: QboTool) => boolean {
  if (typeof selector === "string") return (tool) => tool.name === selector;
  if (Array.isArray(selector)) {
    const names = new Set(selector);

    return (tool) => names.has(tool.name);
  }
  if (typeof selector === "function") return selector;

  return (tool) => selector.test(tool);
}

export class QboTools<TApp = unknown> {
  private readonly tools: readonly QboTool[];

  constructor(
    private readonly transport: Transport<TApp>,
    private readonly queryDefaults: QueryDefaults | undefined,
    tools: readonly QboTool[],
    private readonly formatCallError: QboFormatError = defaultFormatCallError,
    private readonly formatReturnedErrors: boolean,
  ) {
    this.tools = tools;
  }

  exclude(selector: ExcludeSelector): QboTools<TApp> {
    const matches = toolIsExcluded(selector);

    return this.branch(this.tools.filter((tool) => !matches(tool)));
  }

  override(toolName: string, handler: QboTool["handler"]): QboTools<TApp> {
    const index = this.tools.findIndex((tool) => tool.name === toolName);
    if (index < 0) throw new Error(`Unknown QuickBooks tool "${toolName}"`);
    const tools = this.tools.slice();
    const current = tools[index] as QboTool;
    tools[index] = { ...current, handler };

    return this.branch(tools);
  }

  add(tool: QboTool): QboTools<TApp> {
    assertUniqueToolNames([
      ...this.tools.map((existing) => existing.name),
      tool.name,
    ]);

    return this.branch([...this.tools, tool]);
  }

  use(middleware: ToolMiddleware<TApp>): QboTools<TApp> {
    return this.branch(this.tools.map((tool) => middleware(tool)));
  }

  rename(from: string, to: string): QboTools<TApp>;
  rename(mapName: (name: string) => string): QboTools<TApp>;
  rename(
    fromOrMap: string | ((name: string) => string),
    to?: string,
  ): QboTools<TApp> {
    if (typeof fromOrMap === "function") {
      const renamed = this.tools.map((tool) => {
        const next = fromOrMap(tool.name);

        return next === tool.name ? tool : { ...tool, name: next };
      });
      assertUniqueToolNames(renamed.map((tool) => tool.name));

      return this.branch(renamed);
    }

    assertUniqueToolNames(
      this.tools.map((tool) =>
        tool.name === fromOrMap ? (to as string) : tool.name,
      ),
    );

    return this.use(renameTool(fromOrMap, to as string));
  }

  list(): QboListedTool<TApp>[] {
    return this.tools.map((tool) => ({
      ...tool,
      run: (args, ctx) => this.call(tool, args, ctx),
    }));
  }

  register(
    server: McpServer,
    options: { context: ContextSource<TApp> },
  ): this {
    for (const tool of this.tools) {
      RegisterTool(server, {
        ...tool,
        handler: this.handlerInContext(tool, options.context),
      });
    }

    return this;
  }

  handlers(options: {
    context: ContextSource<TApp>;
  }): Record<string, QboTool["handler"]> {
    const handlersByName: Record<string, QboTool["handler"]> = {};
    for (const tool of this.tools) {
      handlersByName[tool.name] = this.handlerInContext(tool, options.context);
    }

    return handlersByName;
  }

  private branch(tools: readonly QboTool[]): QboTools<TApp> {
    return new QboTools(
      this.transport,
      this.queryDefaults,
      tools,
      this.formatCallError,
      this.formatReturnedErrors,
    );
  }

  private handlerInContext(
    tool: QboTool,
    source: ContextSource<TApp>,
  ): QboTool["handler"] {
    return (async (args: unknown, extra?: unknown) =>
      this.call(tool, paramsFromMcpArgs(args), source, extra)) as QboTool["handler"];
  }

  private async call(
    tool: QboTool,
    args: unknown,
    source: ContextSource<TApp>,
    extra?: unknown,
  ): Promise<unknown> {
    let result: unknown;
    try {
      const resolved =
        typeof source === "function" ? await source(extra) : source;
      const ctx = extra === undefined ? resolved : { ...resolved, extra };

      result = await this.compose(tool)(args, ctx);
    } catch (error) {
      return this.formatCallError(error, tool);
    }

    if (this.formatReturnedErrors && isReturnedMcpError(result)) {
      return this.formatCallError(errorFromReturnedMcpError(result), tool);
    }

    return result;
  }

  private compose(tool: QboTool): ToolRun<TApp> {
    const terminal: ToolRun<TApp> = async (args, ctx) => {
      const qbo = ctx.qbo;
      if (!qbo) throw new Error(MISSING_QBO_CONTEXT);
      const queryDefaults = qbo.queryDefaults ?? this.queryDefaults;
      const runTool = tool.handler as (
        args: unknown,
        extra?: unknown,
      ) => Promise<unknown>;
      const mcpArgs = { params: args };

      return runWithQuickbooksContext(
        {
          accessToken: qbo.accessToken,
          realmId: qbo.realmId,
          isSandbox: qbo.isSandbox,
          baseUrl: qbo.baseUrl,
          transport: this.transport,
          queryDefaults,
          app: ctx.app,
        },
        () =>
          ctx.extra === undefined
            ? runTool(mcpArgs)
            : runTool(mcpArgs, ctx.extra),
      );
    };

    const layers = (tool.runLayers ?? []) as readonly QboRunLayer[];

    // Layers are stored in registration order. Compose from the end so the
    // first `.use()` stays outermost: A -> B -> handler, then B's post-next
    // code, then A's.
    return layers.reduceRight<ToolRun<TApp>>(
      (next, layer) => layer(next, tool) as ToolRun<TApp>,
      terminal,
    );
  }
}

function assertUniqueToolNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`Duplicate QuickBooks tool name "${name}"`);
    }
    seen.add(name);
  }
}

export function createQboTools<TApp = unknown>(
  options: QboToolsOptions<TApp>,
): QboTools<TApp> {
  return new QboTools(
    options.transport,
    options.queryDefaults,
    qboTools.map((tool) => attachToolMeta(tool)),
    options.formatError,
    options.formatError !== undefined,
  );
}
