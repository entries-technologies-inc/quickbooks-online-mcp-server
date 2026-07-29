import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mockQuickbooksClient, mockQuickbooksClientClass } from "../../mocks/quickbooks.mock.js";

const mockCreateVendor = jest.fn() as jest.MockedFunction<
  (vendor: any) => Promise<{ isError: boolean; error?: string; result?: unknown }>
>;
const mockUpdatePayment = jest.fn() as jest.MockedFunction<
  (params: any) => Promise<{ isError: boolean; error?: string; result?: unknown }>
>;

jest.unstable_mockModule("../../../src/clients/quickbooks-client", () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

jest.unstable_mockModule("../../../src/handlers/create-quickbooks-vendor.handler.js", () => ({
  createQuickbooksVendor: mockCreateVendor,
}));

jest.unstable_mockModule("../../../src/handlers/update-quickbooks-payment.handler.js", () => ({
  updateQuickbooksPayment: mockUpdatePayment,
}));

const { CreateVendorTool } = await import("../../../src/tools/create-vendor.tool.js");
const { UpdatePaymentTool } = await import("../../../src/tools/update-payment.tool.js");
const { toJsonSchemaCompat } = await import(
  "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
);
const { objectFromShape } = await import("@modelcontextprotocol/sdk/server/zod-compat.js");

describe("create_vendor schema", () => {
  const validParams = {
    vendor: {
      DisplayName: "Acme Supplies",
      BillAddr: { City: "Austin" },
    },
  };

  it("accepts a valid payload", () => {
    expect(CreateVendorTool.schema.safeParse(validParams).success).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = CreateVendorTool.schema.safeParse({
      ...validParams,
      due_date: "2026-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("rejects unknown nested keys on BillAddr", () => {
    const result = CreateVendorTool.schema.safeParse({
      vendor: {
        DisplayName: "Acme Supplies",
        BillAddr: { City: "Austin", street_typo: "123 Main" },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("emits additionalProperties:false via the MCP JSON Schema path", () => {
    const jsonSchema = toJsonSchemaCompat(
      objectFromShape({ params: CreateVendorTool.schema })
    ) as {
      properties?: {
        params?: {
          additionalProperties?: boolean;
          properties?: {
            vendor?: {
              additionalProperties?: boolean;
              properties?: {
                BillAddr?: { additionalProperties?: boolean };
              };
            };
          };
        };
      };
    };

    expect(jsonSchema.properties?.params?.additionalProperties).toBe(false);
    expect(jsonSchema.properties?.params?.properties?.vendor?.additionalProperties).toBe(false);
    expect(
      jsonSchema.properties?.params?.properties?.vendor?.properties?.BillAddr?.additionalProperties
    ).toBe(false);
  });
});

describe("create_vendor handler", () => {
  const createHandler = CreateVendorTool.handler as (args: any) => Promise<any>;

  beforeEach(() => {
    mockCreateVendor.mockReset();
  });

  it("returns the created vendor on success", async () => {
    mockCreateVendor.mockResolvedValue({ isError: false, result: { Id: "3", DisplayName: "Acme" } });
    const result = await createHandler({
      params: { vendor: { DisplayName: "Acme" } },
    });
    expect(result.content[0].text).toContain('"Id":"3"');
  });

  it("returns an error message on failure", async () => {
    mockCreateVendor.mockResolvedValue({ isError: true, error: "duplicate name" });
    const result = await createHandler({
      params: { vendor: { DisplayName: "Acme" } },
    });
    expect(result.content[0].text).toContain("Error creating vendor: duplicate name");
  });
});

describe("update_payment schema", () => {
  const validParams = {
    id: "1",
    sync_token: "0",
    private_note: "memo",
  };

  it("accepts a valid sparse update", () => {
    expect(UpdatePaymentTool.schema.safeParse(validParams).success).toBe(true);
  });

  it("rejects unknown keys (e.g. due_date typo)", () => {
    const result = UpdatePaymentTool.schema.safeParse({
      ...validParams,
      due_date: "2026-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }
  });
});

describe("update_payment handler", () => {
  const updateHandler = UpdatePaymentTool.handler as (args: any) => Promise<any>;

  beforeEach(() => {
    mockUpdatePayment.mockReset();
  });

  it("returns the updated payment on success", async () => {
    mockUpdatePayment.mockResolvedValue({ isError: false, result: { Id: "1", SyncToken: "1" } });
    const result = await updateHandler({
      params: { id: "1", sync_token: "0" },
    });
    expect(result.content[0].text).toContain("Payment updated successfully");
    expect(result.content[1].text).toContain('"SyncToken": "1"');
  });

  it("returns an error message on failure", async () => {
    mockUpdatePayment.mockResolvedValue({ isError: true, error: "stale sync token" });
    const result = await updateHandler({
      params: { id: "1", sync_token: "0" },
    });
    expect(result.content[0].text).toContain("Error updating payment: stale sync token");
  });
});
