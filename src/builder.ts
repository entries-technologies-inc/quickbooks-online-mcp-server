import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runWithQuickbooksContext } from "./clients/quickbooks-client.js";
import { formatError } from "./helpers/format-error.js";
import { RegisterTool } from "./helpers/register-tool.js";
import type { ToolMiddleware, QboToolPredicate } from "./mw.js";
import { rename as renameTool } from "./mw.js";
import type { QboTool } from "./qbo-tool.js";
import { qboTools } from "./tools/catalog.js";
import { attachToolMeta } from "./tools/meta.js";
import type { QueryDefaults } from "./query-defaults.js";
import type { Transport } from "./transport.js";

export type { QboTool };

export type QboEmbedContext = {
  accessToken: string;
  realmId: string;
  isSandbox: boolean;
  baseUrl?: string;
  queryDefaults?: QueryDefaults;
};

export type QboToolsOptions = {
  transport: Transport;
  queryDefaults?: QueryDefaults;
};

/** Resolved on each tool call. `extra` is the MCP request extra when registered. */
export type QboEmbedContextResolver = (
  extra: unknown,
) => QboEmbedContext | Promise<QboEmbedContext>;

export type QboListedTool = QboTool & {
  run: (args: unknown, context: QboEmbedContext) => Promise<unknown>;
};

type ContextSource = QboEmbedContext | QboEmbedContextResolver;

type ExcludeSelector =
  string | string[] | QboToolPredicate | ((tool: QboTool) => boolean);

function toolIsExcluded(selector: ExcludeSelector): (tool: QboTool) => boolean {
  if (typeof selector === "string") return (tool) => tool.name === selector;
  if (Array.isArray(selector)) {
    const names = new Set(selector);

    return (tool) => names.has(tool.name);
  }
  if (typeof selector === "function") return selector;

  return (tool) => selector.test(tool);
}

export class QboTools {
  private tools: QboTool[];

  constructor(
    private readonly transport: Transport,
    private readonly queryDefaults: QueryDefaults | undefined,
    tools: QboTool[],
  ) {
    this.tools = tools;
  }

  exclude(selector: ExcludeSelector): this {
    const matches = toolIsExcluded(selector);
    this.tools = this.tools.filter((tool) => !matches(tool));

    return this;
  }

  override(toolName: string, handler: QboTool["handler"]): this {
    const tool = this.tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Unknown QuickBooks tool "${toolName}"`);
    tool.handler = handler;

    return this;
  }

  add(tool: QboTool): this {
    this.tools.push(tool);

    return this;
  }

  use(middleware: ToolMiddleware): this {
    this.tools = this.tools.map(middleware);

    return this;
  }

  rename(from: string, to: string): this {
    return this.use(renameTool(from, to));
  }

  list(): QboListedTool[] {
    return this.tools.map((tool) => ({
      ...tool,
      run: (args, context) => this.call(tool, args, context),
    }));
  }

  register(
    server: McpServer,
    options: { context: QboEmbedContext | QboEmbedContextResolver },
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
    context: QboEmbedContext | QboEmbedContextResolver;
  }): Record<string, QboTool["handler"]> {
    const handlersByName: Record<string, QboTool["handler"]> = {};
    for (const tool of this.tools) {
      handlersByName[tool.name] = this.handlerInContext(tool, options.context);
    }

    return handlersByName;
  }

  private handlerInContext(tool: QboTool, source: ContextSource): QboTool["handler"] {
    return (async (args: unknown, extra?: unknown) =>
      this.call(tool, args, source, extra)) as QboTool["handler"];
  }

  private async call(
    tool: QboTool,
    args: unknown,
    source: ContextSource,
    extra?: unknown,
  ): Promise<unknown> {
    try {
      const context = await resolveEmbedContext(source, extra);
      const queryDefaults = context.queryDefaults ?? this.queryDefaults;
      const runTool = tool.handler as (
        args: unknown,
        extra?: unknown,
      ) => Promise<unknown>;

      return await runWithQuickbooksContext(
        {
          accessToken: context.accessToken,
          realmId: context.realmId,
          isSandbox: context.isSandbox,
          baseUrl: context.baseUrl,
          transport: this.transport,
          queryDefaults,
        },
        () => (extra === undefined ? runTool(args) : runTool(args, extra)),
      );
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: formatError(error) }],
      };
    }
  }
}

function resolveEmbedContext(
  source: ContextSource,
  extra: unknown,
): QboEmbedContext | Promise<QboEmbedContext> {
  if (typeof source === "function") return source(extra);

  return source;
}

export function createQboTools(options: QboToolsOptions): QboTools {
  return new QboTools(
    options.transport,
    options.queryDefaults,
    qboTools.map((tool) => attachToolMeta(tool)),
  );
}
