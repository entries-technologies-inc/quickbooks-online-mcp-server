import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mockQuickbooksClient, mockQuickbooksClientClass } from "../../mocks/quickbooks.mock.js";

const mockCreateInvoice = jest.fn() as jest.MockedFunction<
  (params: any) => Promise<{ isError: boolean; error?: string; result?: unknown }>
>;

jest.unstable_mockModule("../../../src/clients/quickbooks-client", () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

jest.unstable_mockModule("../../../src/handlers/create-quickbooks-invoice.handler.js", () => ({
  createQuickbooksInvoice: mockCreateInvoice,
}));

const { CreateInvoiceTool } = await import("../../../src/tools/create-invoice.tool.js");
const { toJsonSchemaCompat } = await import(
  "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
);
const { objectFromShape } = await import("@modelcontextprotocol/sdk/server/zod-compat.js");

const validParams = {
  customer_ref: "1",
  line_items: [{ item_ref: "2", qty: 1, unit_price: 10 }],
};

const handler = CreateInvoiceTool.handler as (args: any) => Promise<any>;

describe("create_invoice schema", () => {
  it("accepts a valid payload", () => {
    const result = CreateInvoiceTool.schema.safeParse(validParams);
    expect(result.success).toBe(true);
  });

  it("rejects unknown top-level keys (e.g. due_date typo)", () => {
    const result = CreateInvoiceTool.schema.safeParse({
      ...validParams,
      due_date: "2026-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("rejects unknown keys on line_items", () => {
    const result = CreateInvoiceTool.schema.safeParse({
      customer_ref: "1",
      line_items: [{ item_ref: "2", qty: 1, unit_price: 10, typo_field: true }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("emits additionalProperties:false via the MCP JSON Schema path", () => {
    // MCP registers tools as { params: schema } and converts with io:"input".
    // Plain z.object() omits additionalProperties:false in that mode; z.strictObject restores it.
    const jsonSchema = toJsonSchemaCompat(
      objectFromShape({ params: CreateInvoiceTool.schema })
    ) as {
      properties?: {
        params?: {
          additionalProperties?: boolean;
          properties?: {
            line_items?: {
              items?: { additionalProperties?: boolean };
            };
          };
        };
      };
    };

    expect(jsonSchema.properties?.params?.additionalProperties).toBe(false);
    expect(
      jsonSchema.properties?.params?.properties?.line_items?.items?.additionalProperties
    ).toBe(false);
  });
});

describe("create_invoice handler", () => {
  beforeEach(() => {
    mockCreateInvoice.mockReset();
  });

  it("returns the created invoice on success", async () => {
    mockCreateInvoice.mockResolvedValue({ isError: false, result: { Id: "9" } });
    const result = await handler({ params: validParams });
    expect(result.content[0].text).toContain("Invoice created successfully");
    expect(result.content[1].text).toContain('"Id": "9"');
  });

  it("returns an error message on failure", async () => {
    mockCreateInvoice.mockResolvedValue({ isError: true, error: "boom" });
    const result = await handler({ params: validParams });
    expect(result.content[0].text).toContain("Error creating invoice: boom");
  });
});
