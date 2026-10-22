import { runWithQuickbooksContext } from "../../src/clients/quickbooks-client.js";
import { createQboTools } from "../../src/embed.js";
import { qboTools } from "../../src/tools/catalog.js";
import { markCatalogFailure } from "../../src/tools/mark-catalog-failure.js";
import { TOOL_META } from "../../src/tools/meta.js";
import type { QboHttpRequest, Transport } from "../../src/transport.js";

const credentials = {
  accessToken: "token",
  realmId: "123",
  isSandbox: true,
};

const representatives: { name: string; params: Record<string, unknown> }[] = [
  { name: "get_account", params: { id: "1" } },
  { name: "get_attachable", params: { id: "1" } },
  { name: "create_bill", params: { bill: {} } },
  { name: "get_bill_payment", params: { id: "1" } },
  { name: "search_budgets", params: {} },
  { name: "get_class", params: { id: "1" } },
  { name: "get_company_info", params: { company_id: "1" } },
  { name: "get_credit_memo", params: { id: "1" } },
  { name: "get_customer", params: { id: "1" } },
  { name: "get_department", params: { id: "1" } },
  { name: "get_deposit", params: { id: "1" } },
  { name: "get_employee", params: { id: "1" } },
  { name: "get_estimate", params: { id: "1" } },
  { name: "read_invoice", params: { invoice_id: "1" } },
  { name: "read_item", params: { item_id: "1" } },
  { name: "get_journal_entry", params: { id: "1" } },
  { name: "get_payment", params: { id: "1" } },
  { name: "get_payment_method", params: { id: "1" } },
  { name: "get_preferences", params: {} },
  { name: "get_purchase", params: { id: "1" } },
  { name: "get_purchase_order", params: { id: "1" } },
  { name: "get_refund_receipt", params: { id: "1" } },
  { name: "get_sales_receipt", params: { id: "1" } },
  { name: "get_tax_agency", params: { id: "1" } },
  { name: "get_tax_code", params: { id: "1" } },
  { name: "get_tax_rate", params: { id: "1" } },
  { name: "get_term", params: { id: "1" } },
  { name: "get_time_activity", params: { id: "1" } },
  { name: "get_transfer", params: { id: "1" } },
  { name: "get_vendor", params: { id: "1" } },
  { name: "get_vendor_credit", params: { id: "1" } },
  { name: "get_balance_sheet", params: {} },
];

function failingTransport(): Transport {
  return async () => ({
    status: 400,
    body: { Fault: { Error: [{ Message: "no", Detail: "no" }] } },
  });
}

function succeedingTransport(): Transport {
  return async (request: QboHttpRequest) => {
    if (request.op.kind === "query") {
      return {
        status: 200,
        body: { QueryResponse: { [request.op.entity]: [], maxResults: 0 } },
      };
    }
    if (request.op.kind === "report") {
      return { status: 200, body: { Header: {}, Rows: {} } };
    }
    if (request.op.kind === "get" || request.op.kind === "create") {
      return {
        status: 200,
        body: { [request.op.entity]: { Id: "1", SyncToken: "0" } },
      };
    }

    return { status: 500, body: {} };
  };
}

const ctx = { qbo: credentials, app: undefined };

describe("markCatalogFailure", () => {
  it("sets isError only on failure text and leaves every other result alone", () => {
    expect(markCatalogFailure(null)).toBeNull();
    expect(markCatalogFailure(undefined)).toBeUndefined();
    expect(markCatalogFailure("ok")).toBe("ok");

    const already = {
      isError: true,
      content: [{ type: "text", text: "Error creating bill" }],
    };
    expect(markCatalogFailure(already)).toBe(already);

    const successFlag = {
      isError: false,
      content: [{ type: "text", text: "Error creating bill" }],
    };
    expect(markCatalogFailure(successFlag)).toBe(successFlag);

    const notContent = { content: "Error creating bill" };
    expect(markCatalogFailure(notContent)).toBe(notContent);

    const empty = { content: [] as unknown[] };
    expect(markCatalogFailure(empty)).toBe(empty);

    const nullPart = { content: [null] };
    expect(markCatalogFailure(nullPart)).toBe(nullPart);

    const notObject = { content: ["Error creating bill"] };
    expect(markCatalogFailure(notObject)).toBe(notObject);

    const image = { content: [{ type: "image", text: "Error creating bill" }] };
    expect(markCatalogFailure(image)).toBe(image);

    const notString = { content: [{ type: "text", text: 1 }] };
    expect(markCatalogFailure(notString)).toBe(notString);

    const success = { content: [{ type: "text" as const, text: "Found 1 bill" }] };
    expect(markCatalogFailure(success)).toBe(success);
    expect(success).not.toHaveProperty("isError");

    const errorText = {
      content: [{ type: "text" as const, text: "Error creating bill" }],
    };
    expect(markCatalogFailure(errorText)).toEqual({
      content: errorText.content,
      isError: true,
    });

    const invalid = {
      content: [{ type: "text" as const, text: "Invalid criteria: bad" }],
    };
    expect(markCatalogFailure(invalid)).toEqual({
      content: invalid.content,
      isError: true,
    });
  });
});

describe("catalog failure flag", () => {
  it("covers one tool for every entity and one report", () => {
    const coveredEntities = representatives
      .map((sample) => TOOL_META[sample.name]?.entity)
      .filter((entity): entity is string => entity !== undefined)
      .sort();
    const entities = [
      ...new Set(
        Object.values(TOOL_META)
          .map((meta) => meta.entity)
          .filter((entity): entity is string => entity !== undefined),
      ),
    ].sort();

    expect(coveredEntities).toEqual(entities);
    expect(
      representatives.some((sample) => TOOL_META[sample.name]?.op.kind === "report"),
    ).toBe(true);
  });

  it("returns isError on a failing tool in each family and leaves success unchanged", async () => {
    const failed = createQboTools({ transport: failingTransport() });
    const succeeded = createQboTools({ transport: succeedingTransport() });

    for (const sample of representatives) {
      const failure = (await failed
        .list()
        .find((tool) => tool.name === sample.name)
        ?.run(sample.params, ctx)) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      expect({
        tool: sample.name,
        isError: failure.isError,
        text: failure.content[0]?.text,
      }).toEqual({
        tool: sample.name,
        isError: true,
        text: expect.stringMatching(/^(Error|Invalid criteria:)/),
      });

      const success = (await succeeded
        .list()
        .find((tool) => tool.name === sample.name)
        ?.run(sample.params, ctx)) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      expect(success.isError).toBeUndefined();
      expect(success.content[0]?.text.startsWith("Error")).toBe(false);
      expect(success.content[0]?.text.startsWith("Invalid criteria:")).toBe(false);
    }
  });

  it("sends a returned catalog failure through formatError", async () => {
    const seen: { tool: string; message: string }[] = [];
    const tools = createQboTools({
      transport: failingTransport(),
      formatError: (error, tool) => {
        seen.push({
          tool: tool.name,
          message: error instanceof Error ? error.message : String(error),
        });

        return { custom: true, tool: tool.name };
      },
    });

    for (const sample of representatives) {
      await tools
        .list()
        .find((tool) => tool.name === sample.name)
        ?.run(sample.params, ctx);
    }

    expect(seen.map((call) => call.tool).sort()).toEqual(
      representatives.map((sample) => sample.name).sort(),
    );
    expect(seen.every((call) => call.message.startsWith("Error"))).toBe(true);
    expect(seen.find((call) => call.tool === "create_bill")?.message).toContain(
      "Error creating bill",
    );
  });

  it("flags an invalid search and a catalog handler the standalone server registers", async () => {
    const tools = createQboTools({ transport: failingTransport() });
    const invalid = (await tools
      .list()
      .find((tool) => tool.name === "search_accounts")
      ?.run({ criteria: "nope" }, ctx)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]?.text.startsWith("Invalid criteria:")).toBe(true);

    const formatted = createQboTools({
      transport: succeedingTransport(),
      formatError: (error, tool) => ({
        custom: true,
        tool: tool.name,
        message: error instanceof Error ? error.message : String(error),
      }),
    });
    await expect(
      formatted
        .list()
        .find((tool) => tool.name === "search_accounts")
        ?.run({ criteria: "nope" }, ctx),
    ).resolves.toMatchObject({
      custom: true,
      tool: "search_accounts",
      message: expect.stringMatching(/^Invalid criteria:/),
    });

    const bill = qboTools.find((tool) => tool.name === "create_bill");
    const callBill = bill?.handler as unknown as (args: {
      params: { bill: Record<string, unknown> };
    }) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
    const registered = await runWithQuickbooksContext(
      { ...credentials, transport: failingTransport(), app: undefined },
      () => callBill({ params: { bill: {} } }),
    );

    expect(registered.isError).toBe(true);
    expect(registered.content[0]?.text).toContain("Error creating bill");

    const ok = await runWithQuickbooksContext(
      { ...credentials, transport: succeedingTransport(), app: undefined },
      () => callBill({ params: { bill: {} } }),
    );

    expect(ok.isError).toBeUndefined();
    expect(ok.content[0]?.text.startsWith("{")).toBe(true);
  });
});
