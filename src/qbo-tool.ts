import type { ZodType } from "zod";
import type { ToolDefinition } from "./types/tool-definition.js";
import type { QboToolMeta } from "./tools/meta.js";

export type QboTool = ToolDefinition<ZodType> & {
  meta: QboToolMeta;
  /**
   * `wrapRun` layers in the order they were added. The first entry is
   * outermost. An own enumerable field so `{ ...tool }` keeps them. The
   * builder composes this list in reverse when the tool runs; `override`
   * replaces `handler` and leaves this list in place.
   */
  runLayers?: readonly QboRunLayer[];
};

export type QboRunLayer = (
  next: (args: unknown, ctx: any) => Promise<unknown>,
  tool: QboTool,
) => (args: unknown, ctx: any) => Promise<unknown>;
