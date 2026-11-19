import { createQuickbooksTaxCode, createTaxCodeSchema } from "../handlers/create-quickbooks-tax-code.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";

const toolName = "create_tax_code";
const toolDescription = "Create a tax code in QuickBooks Online through TaxService.";
const toolSchema = createTaxCodeSchema;

const toolHandler = async ({ params }: any) => {
  const response = await createQuickbooksTaxCode(params);
  if (response.isError) return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  return { content: [{ type: "text" as const, text: `Tax code created:` }, { type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const CreateTaxCodeTool: ToolDefinition<typeof toolSchema> = { name: toolName, description: toolDescription, schema: toolSchema, handler: toolHandler };
