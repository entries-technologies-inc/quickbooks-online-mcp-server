import { z } from "zod";

/** Optional multicurrency input fields used by mapped create/update tools. */
export interface CurrencyFieldsInput {
  currency_ref?: string;
  exchange_rate?: number;
}

export const currencyRefSchema = z
  .string()
  .optional()
  .describe(
    "Reference to the currency (e.g. USD, GBP) in which all amounts on the transaction are expressed. Required if multicurrency is enabled for the company (CurrencyRef)"
  );

export const exchangeRateSchema = z
  .number()
  .positive()
  .optional()
  .describe(
    "The number of home-currency units it takes to equal one unit of the currency specified by currency_ref. Applicable if multicurrency is enabled for the company (ExchangeRate)"
  );

/** Zod shape fragment for tools that accept both CurrencyRef and ExchangeRate. */
export const currencyFieldsSchema = {
  currency_ref: currencyRefSchema,
  exchange_rate: exchangeRateSchema,
};

/**
 * QBO-shaped CurrencyRef for tools that already use PascalCase entity objects
 * (e.g. vendor create/update). Name entities do not accept ExchangeRate.
 */
export const qboCurrencyRefSchema = z
  .strictObject({
    value: z.string().min(1).describe("ISO 4217 currency code, e.g. USD, GBP"),
  })
  .optional()
  .describe(
    "Currency for this name entity when multicurrency is enabled (CurrencyRef). Assigned once; subsequent transactions must use the same currency."
  );

/**
 * Maps optional snake_case currency fields onto a QBO payload as CurrencyRef / ExchangeRate.
 * Mutates and returns the same payload object.
 */
export function applyCurrencyFields(
  payload: Record<string, any>,
  data: CurrencyFieldsInput
): Record<string, any> {
  if (data.currency_ref) {
    payload.CurrencyRef = { value: data.currency_ref };
  }
  if (data.exchange_rate !== undefined) {
    payload.ExchangeRate = data.exchange_rate;
  }
  return payload;
}
