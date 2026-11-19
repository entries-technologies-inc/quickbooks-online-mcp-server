import { z } from "zod";
import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

const taxApplicableOnSchema = z
  .enum(["Sales", "Purchase"])
  .optional()
  .describe("Whether the rate applies to sales or purchases");

// A percent string from 0 to 100. The pattern already excludes negatives, so the
// only remaining bound is the upper end.
function isRatePercent(value: string): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return false;
  return Number(value) <= 100;
}

const existingTaxRateDetailSchema = z.strictObject({
  tax_rate_id: z.string().min(1).describe("Existing QuickBooks tax rate ID"),
  tax_applicable_on: taxApplicableOnSchema,
});

const newTaxRateDetailSchema = z.strictObject({
  tax_rate_name: z.string().min(1).describe("Name of the tax rate to create"),
  rate_value: z
    .string()
    .refine(isRatePercent, { message: "rate_value must be a percent from 0 to 100" })
    .describe("Tax rate percent as a string, from 0 to 100"),
  tax_agency_id: z.string().min(1).describe("Tax agency ID for the new rate"),
  tax_applicable_on: taxApplicableOnSchema,
});

const taxRateDetailSchema = z.union([existingTaxRateDetailSchema, newTaxRateDetailSchema]);

export const createTaxCodeSchema = z.strictObject({
  name: z.string().min(1).max(100).describe("Tax code name"),
  tax_rate_details: z
    .array(taxRateDetailSchema)
    .min(1)
    .describe("One or more tax rate details, each either an existing rate id or a new rate"),
});

type TaxRateDetail = z.infer<typeof taxRateDetailSchema>;

function mapTaxRateDetail(detail: TaxRateDetail): Record<string, string> {
  const mapped: Record<string, string> =
    "tax_rate_id" in detail
      ? { TaxRateId: detail.tax_rate_id }
      : {
          TaxRateName: detail.tax_rate_name,
          RateValue: detail.rate_value,
          TaxAgencyId: detail.tax_agency_id,
        };
  if (detail.tax_applicable_on) mapped.TaxApplicableOn = detail.tax_applicable_on;
  return mapped;
}

export async function createQuickbooksTaxCode(data: unknown): Promise<ToolResponse<any>> {
  try {
    const parsed = createTaxCodeSchema.safeParse(data);
    if (!parsed.success) {
      return { result: null, isError: true, error: formatError(parsed.error.message) };
    }

    const quickbooks = await QuickbooksClient.getInstance();
    const payload = {
      TaxCode: parsed.data.name,
      TaxRateDetails: parsed.data.tax_rate_details.map(mapTaxRateDetail),
    };

    return await new Promise((resolve) => {
      (quickbooks as any).createTaxService(payload, (err: any, created: any) => {
        if (err) resolve({ result: null, isError: true, error: formatError(err) });
        else resolve({ result: created, isError: false, error: null });
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
