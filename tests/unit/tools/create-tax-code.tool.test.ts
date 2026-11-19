import { describe, it, expect } from "@jest/globals";
import { runWithQuickbooksContext } from "../../../src/clients/quickbooks-client.js";
import { createQboTools, isWrite } from "../../../src/embed.js";
import { createTaxCodeSchema } from "../../../src/handlers/create-quickbooks-tax-code.handler.js";
import { qboTools } from "../../../src/tools/catalog.js";
import type { QboHttpRequest, Transport } from "../../../src/transport.js";

const credentials = {
  accessToken: "token",
  realmId: "123",
  isSandbox: true,
};

const newRate = {
  name: "My tax code",
  tax_rate_details: [
    {
      tax_rate_name: "My rate",
      rate_value: "13",
      tax_agency_id: "1",
      tax_applicable_on: "Sales" as const,
    },
  ],
};

const existingRate = {
  name: "Existing rate code",
  tax_rate_details: [{ tax_rate_id: "4" }],
};

function createTaxCodeTool() {
  const tool = qboTools.find((candidate) => candidate.name === "create_tax_code");
  if (!tool) throw new Error("missing create_tax_code");
  return tool;
}

async function callTool(params: unknown, transport: Transport) {
  return runWithQuickbooksContext({ ...credentials, transport }, () =>
    (
      createTaxCodeTool().handler as unknown as (
        args: unknown,
      ) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>
    )({ params }),
  );
}

function recorded(seen: QboHttpRequest[], body: unknown): Transport {
  return async (request) => {
    seen.push(request);
    return { status: 200, body };
  };
}

describe("create_tax_code", () => {
  it("is a write tool", () => {
    const listed = createQboTools({
      transport: async () => ({ status: 200, body: {} }),
    })
      .list()
      .find((tool) => tool.name === "create_tax_code");

    expect(listed?.meta.op).toEqual({ kind: "create", entity: "TaxCode" });
    expect(listed && isWrite().test(listed)).toBe(true);
  });

  it("posts a new rate to TaxService and returns the raw body", async () => {
    const seen: QboHttpRequest[] = [];
    const created = {
      TaxCode: "My tax code",
      TaxCodeId: "42",
      TaxRateDetails: [
        {
          TaxRateName: "My rate",
          TaxRateId: "6",
          RateValue: "13",
          TaxAgencyId: "1",
          TaxApplicableOn: "Sales",
        },
      ],
    };

    const result = await callTool(newRate, recorded(seen, created));
    const parsed = JSON.parse(result.content[1]?.text ?? "");

    expect(seen).toEqual([
      {
        op: { kind: "create", entity: "TaxService/taxcode" },
        method: "POST",
        path: "/taxservice/taxcode",
        query: { minorversion: "75", format: "json" },
        body: {
          TaxCode: "My tax code",
          TaxRateDetails: [
            {
              TaxRateName: "My rate",
              RateValue: "13",
              TaxAgencyId: "1",
              TaxApplicableOn: "Sales",
            },
          ],
        },
      },
    ]);
    expect(parsed).toEqual(created);
    expect(parsed.TaxCodeId).toBe("42");
    expect(parsed["TaxService/taxcode"]).toBeUndefined();
  });

  it("posts an existing tax rate id without new-rate fields", async () => {
    const seen: QboHttpRequest[] = [];
    const created = {
      TaxCode: "Existing rate code",
      TaxCodeId: "7",
      TaxRateDetails: [{ TaxRateId: "4", TaxApplicableOn: "Purchase" }],
    };

    const result = await callTool(
      {
        name: "Existing rate code",
        tax_rate_details: [{ tax_rate_id: "4", tax_applicable_on: "Purchase" }],
      },
      recorded(seen, created),
    );
    const parsed = JSON.parse(result.content[1]?.text ?? "null");

    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.path).toBe("/taxservice/taxcode");
    expect(seen[0]?.body).toEqual({
      TaxCode: "Existing rate code",
      TaxRateDetails: [{ TaxRateId: "4", TaxApplicableOn: "Purchase" }],
    });
    expect(parsed).toEqual(created);
    expect(parsed.TaxCodeId).toBe("7");
  });

  it("omits TaxApplicableOn when the detail does not set it", async () => {
    const seen: QboHttpRequest[] = [];
    const created = {
      TaxCode: "Existing rate code",
      TaxCodeId: "8",
      TaxRateDetails: [{ TaxRateId: "4" }],
    };

    const result = await callTool(existingRate, recorded(seen, created));

    expect(seen[0]?.body).toEqual({
      TaxCode: "Existing rate code",
      TaxRateDetails: [{ TaxRateId: "4" }],
    });
    expect(JSON.parse(result.content[1]?.text ?? "null").TaxCodeId).toBe("8");
  });

  it("returns a QuickBooks fault with isError", async () => {
    const seen: QboHttpRequest[] = [];
    const fault = {
      Fault: {
        Error: [
          {
            Message: "Duplicate Name Exists Error",
            Detail: "The name supplied already exists.",
          },
        ],
      },
    };

    const result = await callTool(newRate, recorded(seen, fault));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe("/taxservice/taxcode");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Duplicate Name Exists Error");
  });

  it("accepts both detail shapes and the rate bounds", () => {
    expect(createTaxCodeSchema.safeParse(newRate).success).toBe(true);
    expect(createTaxCodeSchema.safeParse(existingRate).success).toBe(true);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [
          { tax_rate_name: "R", rate_value: "0", tax_agency_id: "1" },
        ],
      }).success,
    ).toBe(true);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [
          { tax_rate_name: "R", rate_value: "100", tax_agency_id: "1" },
        ],
      }).success,
    ).toBe(true);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [
          { tax_rate_name: "R", rate_value: "13.5", tax_agency_id: "1" },
        ],
      }).success,
    ).toBe(true);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A".repeat(100),
        tax_rate_details: [{ tax_rate_id: "4" }],
      }).success,
    ).toBe(true);
  });

  it("rejects a mix, an empty detail, a bad rate, a long name, and unknown keys", () => {
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [
          {
            tax_rate_id: "4",
            tax_rate_name: "R",
            rate_value: "13",
            tax_agency_id: "1",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({ name: "A", tax_rate_details: [{}] }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({ name: "A", tax_rate_details: [] }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [{ tax_applicable_on: "Sales" }],
      }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [
          { tax_rate_name: "R", rate_value: "101", tax_agency_id: "1" },
        ],
      }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [
          { tax_rate_name: "R", rate_value: "-1", tax_agency_id: "1" },
        ],
      }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [
          { tax_rate_name: "R", rate_value: "abc", tax_agency_id: "1" },
        ],
      }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [
          { tax_rate_name: "R", rate_value: "", tax_agency_id: "1" },
        ],
      }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A".repeat(101),
        tax_rate_details: [{ tax_rate_id: "4" }],
      }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({ ...newRate, extra: true }).success,
    ).toBe(false);
    expect(
      createTaxCodeSchema.safeParse({
        name: "A",
        tax_rate_details: [{ tax_rate_id: "4", rate_value: "13" }],
      }).success,
    ).toBe(false);
  });
});
