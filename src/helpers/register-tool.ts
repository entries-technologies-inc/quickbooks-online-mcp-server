import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

/**
 * Defines CRUD categories for tools
 */
export const CRUD_CATEGORY = {
  WRITE:  "WRITE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  READ:   "READ",
} as const;

export type CrudCategory = typeof CRUD_CATEGORY[keyof typeof CRUD_CATEGORY];

/** 
 * Maps each CRUD category to its corresponding environment variable for disabling tools.
 */
export const DISABLE_ENV = {
  [CRUD_CATEGORY.WRITE]:  "QUICKBOOKS_DISABLE_WRITE",
  [CRUD_CATEGORY.UPDATE]: "QUICKBOOKS_DISABLE_UPDATE",
  [CRUD_CATEGORY.DELETE]: "QUICKBOOKS_DISABLE_DELETE",
} as const;

/** 
 * Maps every non-READ verb prefix to its category. Handles both underscore
 * and legacy hyphen separator variants (e.g. create-bill, update-vendor).
 * Insertion order is preserved in V8; all prefixes are distinct so order
 * does not affect correctness.
 */
export const PREFIX_CATEGORY_MAP: Record<string, CrudCategory> = {
  "create_": CRUD_CATEGORY.WRITE,
  "create-": CRUD_CATEGORY.WRITE,
  "update_": CRUD_CATEGORY.UPDATE,
  "update-": CRUD_CATEGORY.UPDATE,
  "delete_": CRUD_CATEGORY.DELETE,
  "delete-": CRUD_CATEGORY.DELETE,
};

/** 
 * Determines the CRUD category of a tool based on its name prefix.
 * Defaults to READ if no prefix matches.
 */
export function getCrudCategory(toolName: string): CrudCategory {
  for (const [prefix, category] of Object.entries(PREFIX_CATEGORY_MAP)) {
    if (toolName.startsWith(prefix)) return category;
  }
  return CRUD_CATEGORY.READ;
}

/** 
 * Checks if a tool is disabled based on its CRUD category and corresponding environment variable.
 * READ tools are never disabled.
 */
export function isToolDisabled(toolName: string): boolean {
  const category = getCrudCategory(toolName);
  if (category === CRUD_CATEGORY.READ) return false;
  return process.env[DISABLE_ENV[category]] === "true";
}

/**
 * Unsupported-parameter reporting (upstream #135), adapted for this fork.
 *
 * Plain `z.object()` schemas strip keys they do not declare. The call succeeds,
 * the value never reaches QuickBooks, and the caller is not told. Upstream
 * reports those keys instead of hard-failing: a stray parameter must not turn
 * a transaction into an error, and several search tools spread leftover params
 * into query criteria, so an unknown key has to be removed before the handler
 * runs or it becomes a real SQL filter.
 *
 * This fork also uses `z.strictObject()` on write tools Entries Core calls
 * (create_invoice, create_vendor, and the other strict schemas). Those already
 * reject unknown keys and advertise additionalProperties:false. Loosening them
 * here would change that contract, so strict schemas are registered unchanged.
 * Nested passthrough / z.any() values live under declared keys and are kept.
 */

/** Top-level keys a tool's params schema declares, or null if not an object schema. */
export function knownParamKeys(schema: unknown): Set<string> | null {
  const shape = (schema as any)?._def?.shape;
  if (!shape) return null;
  try {
    return new Set(Object.keys(typeof shape === "function" ? shape() : shape));
  } catch {
    return null;
  }
}

/**
 * z.strictObject sets catchall to ZodNever. Plain z.object() has no catchall
 * (strip). z.looseObject / .passthrough() set catchall to ZodUnknown.
 */
function catchallType(schema: unknown): string | undefined {
  const anySchema = schema as any;
  const catchall = anySchema?._zod?.def?.catchall ?? anySchema?._def?.catchall;
  if (!catchall) return undefined;
  return catchall?._zod?.def?.type ?? catchall?.type ?? catchall?._def?.type;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Keep unknown keys through validation so they can be reported rather than vanish. */
export function permissiveParamsSchema<T>(schema: T): T {
  if (catchallType(schema) === "never") return schema;
  const anySchema = schema as any;
  return typeof anySchema?.passthrough === "function" ? anySchema.passthrough() : schema;
}

/** Human-readable notice naming parameters the tool does not support. */
export function unsupportedParamsWarning(
  toolName: string,
  known: Set<string> | null,
  params: unknown
): string | null {
  if (!known || !isPlainRecord(params)) return null;
  const extras = Object.keys(params).filter((k) => !known.has(k));
  if (extras.length === 0) return null;
  return (
    `WARNING: ${toolName} does not support ${extras.length === 1 ? "this parameter" : "these parameters"}: ` +
    `${extras.join(", ")}. ${extras.length === 1 ? "It was" : "They were"} IGNORED - the value did not reach ` +
    `QuickBooks. Supported parameters: ${[...known].sort().join(", ")}.`
  );
}

export function RegisterTool<T extends z.ZodType>(
  server: McpServer,
  toolDefinition: ToolDefinition<T>
) {
  if (isToolDisabled(toolDefinition.name)) return;

  const known = knownParamKeys(toolDefinition.schema);
  const paramsSchema = permissiveParamsSchema(toolDefinition.schema);
  const baseHandler = toolDefinition.handler as unknown as (...a: any[]) => Promise<any>;

  const handler = (async (...a: any[]) => {
    let callArgs = a;
    let warning: string | null = null;
    try {
      const params = (a[0] as any)?.params;
      if (known && isPlainRecord(params)) {
        warning = unsupportedParamsWarning(toolDefinition.name, known, params);
        if (warning) {
          // Strip unknown keys before the handler runs. The permissive schema
          // exists only so they can be SEEN; it must not change what reaches
          // QuickBooks. Several search tools destructure their params with a rest
          // element and pass the rest on as query criteria (search-bills,
          // search-customers, search-estimates, search-vendors), so an unknown key
          // left in place would become a real SQL filter - quietly changing which
          // records the search returns while this warning claimed it was ignored.
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(params)) {
            if (known.has(k)) cleaned[k] = v;
          }
          callArgs = [{ ...(a[0] as any), params: cleaned }, ...a.slice(1)];
        }
      }
    } catch {
      /* diagnostics must never break a working call */
    }

    const result = await baseHandler(...callArgs);

    try {
      if (warning && result && Array.isArray(result.content)) {
        // Appended, not prepended. Entries Core parses write-tool text for
        // { name, id, operation }, and several tools put that JSON in
        // content[0] (create_bill, create_vendor). A leading warning would
        // move the payload. The original blocks stay in order; the notice
        // follows them, including on error responses.
        result.content.push({ type: "text" as const, text: warning });
      }
    } catch {
      /* diagnostics must never break a working call */
    }
    return result;
  }) as typeof toolDefinition.handler;

  server.tool(toolDefinition.name, toolDefinition.description, { params: paramsSchema }, handler);
}
