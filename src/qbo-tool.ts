import type { ZodType } from "zod";
import type { ToolDefinition } from "./types/tool-definition.js";
import type { QboToolMeta } from "./tools/meta.js";

export type QboTool = ToolDefinition<ZodType> & { meta: QboToolMeta };
