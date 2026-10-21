import { runWithQuickbooksContext } from "../../src/clients/quickbooks-client.js";
import { createQuickbooksItem } from "../../src/handlers/create-quickbooks-item.handler.js";
import { deleteQuickbooksCustomer } from "../../src/handlers/delete-quickbooks-customer.handler.js";
import { deleteQuickbooksEmployee } from "../../src/handlers/delete-quickbooks-employee.handler.js";
import { deleteQuickbooksInvoice } from "../../src/handlers/delete-quickbooks-invoice.handler.js";
import { deleteQuickbooksItem } from "../../src/handlers/delete-quickbooks-item.handler.js";
import { searchQuickbooksAccounts } from "../../src/handlers/search-quickbooks-accounts.handler.js";
import { searchQuickbooksCustomers } from "../../src/handlers/search-quickbooks-customers.handler.js";
import { searchQuickbooksEstimates } from "../../src/handlers/search-quickbooks-estimates.handler.js";
import { searchQuickbooksInvoices } from "../../src/handlers/search-quickbooks-invoices.handler.js";
import { searchQuickbooksItems } from "../../src/handlers/search-quickbooks-items.handler.js";
import { updateQuickbooksInvoice } from "../../src/handlers/update-quickbooks-invoice.handler.js";
import { updateQuickbooksItem } from "../../src/handlers/update-quickbooks-item.handler.js";
import { qboTools } from "../../src/tools/catalog.js";
import { accountAdvancedCriteriaSchema } from "../../src/tools/search-accounts.tool.js";
import { invoiceAdvancedCriteriaSchema } from "../../src/tools/search-invoices.tool.js";
import { itemAdvancedCriteriaSchema } from "../../src/tools/search-items.tool.js";
import type { Transport } from "../../src/transport.js";

const credentials = {
  accessToken: "token",
  realmId: "123",
  isSandbox: true,
};

const savedEntity = {
  Id: "1",
  SyncToken: "0",
  Line: [
    {
      Id: "1",
      Amount: 1,
      AccountBasedExpenseLineDetail: { AccountRef: { value: "1" } },
    },
  ],
};

const successBody: Record<string, unknown> = { time: "t" };
for (const entityName of [
  "Attachable",
  "Bill",
  "CreditMemo",
  "Customer",
  "Deposit",
  "Employee",
  "Invoice",
  "Item",
  "Payment",
  "PurchaseOrder",
  "RefundReceipt",
  "SalesReceipt",
  "VendorCredit",
]) {
  successBody[entityName] = savedEntity;
}

const successTransport: Transport = async () => ({
  status: 200,
  body: successBody,
});

const salesLine = { item_ref: "1", qty: 1, unit_price: 2 };

type Callback = (error: unknown, result?: unknown) => void;

function quickbooks(methods: Record<string, (...args: any[]) => void>) {
  return { realmId: credentials.realmId, ...methods };
}

function succeed(result: unknown) {
  return (...args: any[]) => {
    const callback = args[args.length - 1] as Callback;
    callback(null, result);
  };
}

function fail(error: unknown = new Error("no")) {
  return (...args: any[]) => {
    const callback = args[args.length - 1] as Callback;
    callback(error);
  };
}

function queryClient(method: string, queryResponse: Record<string, unknown>) {
  return quickbooks({
    [method]: succeed({ QueryResponse: queryResponse, time: "t" }),
  });
}

function toolByName(toolName: string) {
  const tool = qboTools.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Missing QuickBooks tool ${toolName}`);

  return tool;
}

async function callRaw(
  toolName: string,
  args: unknown,
  quickbooksClient?: ReturnType<typeof quickbooks>,
) {
  const tool = toolByName(toolName);

  const run = () =>
    (tool.handler as (input: unknown, extra?: unknown) => Promise<unknown>)(
      args,
    );

  const attempt = quickbooksClient
    ? runWithQuickbooksContext(
        { ...credentials, quickbooks: quickbooksClient },
        run,
      )
    : run();

  return Promise.race([
    attempt,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out ${toolName}`)), 1000),
    ),
  ]);
}

async function callTool(
  toolName: string,
  params: unknown,
  quickbooksClient?: ReturnType<typeof quickbooks>,
) {
  return callRaw(toolName, { params }, quickbooksClient);
}

function textOf(response: unknown): string {
  const content = (response as { content?: Array<{ text?: string }> }).content;
  if (!content) return JSON.stringify(response);

  return content.map((part) => part.text ?? "").join("\n");
}

describe("advanced search schemas", () => {
  it("checks account field types and sort fields", () => {
    expect(
      accountAdvancedCriteriaSchema.safeParse({
        filters: [
          { field: "Name", value: "Cash" },
          { field: "CurrentBalance", value: 5 },
          { field: "Active", value: true },
          { field: "MetaData.CreateTime", value: "2020-01-01" },
        ],
        asc: "Name",
        desc: "CurrentBalance",
      }).success,
    ).toBe(true);
    expect(
      accountAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Name", value: 1 }],
      }).success,
    ).toBe(false);
    expect(
      accountAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "CurrentBalance", value: "5" }],
      }).success,
    ).toBe(false);
    expect(
      accountAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Active", value: "true" }],
      }).success,
    ).toBe(false);
    expect(
      accountAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "MetaData.CreateTime", value: 1 }],
      }).success,
    ).toBe(false);
    expect(
      accountAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Nope", value: "x" }],
        asc: "Nope",
      }).success,
    ).toBe(false);
  });

  it("checks invoice field types and sort fields", () => {
    expect(
      invoiceAdvancedCriteriaSchema.safeParse({
        filters: [
          { field: "DocNumber", value: "A" },
          { field: "Balance", value: 5 },
        ],
        asc: "DocNumber",
        desc: "TotalAmt",
      }).success,
    ).toBe(true);
    expect(
      invoiceAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Balance", value: "5" }],
      }).success,
    ).toBe(false);
    expect(
      invoiceAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "TxnDate", value: "2020-01-01" }],
      }).success,
    ).toBe(false);
    expect(
      invoiceAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Nope", value: "A" }],
        desc: "Nope",
      }).success,
    ).toBe(false);
  });

  it("checks item field types and sort fields", () => {
    expect(
      itemAdvancedCriteriaSchema.safeParse({
        filters: [
          { field: "Name", value: "Widget" },
          { field: "Active", value: true },
          { field: "MetaData.CreateTime", value: "2020-01-01" },
          { field: "Name", value: ["Widget", "Gadget"] },
        ],
        asc: "Name",
        desc: "Type",
      }).success,
    ).toBe(true);
    expect(
      itemAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Sku", value: ["A", 1] }],
      }).success,
    ).toBe(false);
    expect(
      itemAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Active", value: "true" }],
      }).success,
    ).toBe(false);
    expect(
      itemAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Name", value: 1 }],
      }).success,
    ).toBe(false);
    expect(
      itemAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "MetaData.CreateTime", value: 1 }],
      }).success,
    ).toBe(false);
    expect(
      itemAdvancedCriteriaSchema.safeParse({
        filters: [{ field: "Nope", value: "x" }],
        asc: "Nope",
      }).success,
    ).toBe(false);
  });
});

describe("tool handler branches the loose proxy missed", () => {
  it("hits handler catch blocks when no QuickBooks client is registered", async () => {
    const params = {
      id: "1",
      idOrEntity: "1",
      invoice_id: "1",
      item_id: "1",
      patch: {},
      bill: { Id: "1", Line: [], VendorRef: { value: "1" } },
      vendor: { Id: "1", SyncToken: "0" },
      criteria: [],
      line_items: [] as unknown[],
      vendor_ref: "1",
      customer_ref: "1",
      file_name: "note.txt",
      name: "Widget",
      type: "Service",
      income_account_ref: "1",
      deposit_to_account_ref: "1",
      total_amt: 1,
    };

    const failures: string[] = [];

    for (const tool of qboTools) {
      try {
        await callRaw(tool.name, { params });
      } catch (error) {
        failures.push(
          `${tool.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it("returns the created or updated entity when the transport succeeds", async () => {
    const calls: Array<[string, unknown]> = [
      [
        "create-bill",
        {
          bill: {
            VendorRef: { value: "1" },
            Line: [
              {
                Amount: 1,
                DetailType: "AccountBasedExpenseLineDetail",
                AccountBasedExpenseLineDetail: {
                  AccountRef: { value: "1" },
                },
              },
            ],
          },
        },
      ],
      ["create_attachable", { file_name: "note.txt" }],
      ["create_credit_memo", { customer_ref: "1", line_items: [salesLine] }],
      [
        "create_deposit",
        { deposit_to_account_ref: "1", line_items: [{ amount: 5 }] },
      ],
      ["create_payment", { customer_ref: "1", total_amt: 5 }],
      ["create_purchase_order", { vendor_ref: "1", line_items: [salesLine] }],
      ["create_refund_receipt", { customer_ref: "1", line_items: [salesLine] }],
      ["create_sales_receipt", { customer_ref: "1", line_items: [salesLine] }],
      [
        "create_vendor_credit",
        { vendor_ref: "1", line_items: [{ amount: 1, account_ref: "3" }] },
      ],
      ["update-bill", { bill: { Id: "1", PrivateNote: "note" } }],
      ["update_vendor_credit", { id: "1", sync_token: "0" }],
    ];

    await runWithQuickbooksContext(
      { ...credentials, transport: successTransport },
      async () => {
        for (const [toolName, params] of calls) {
          const response = await callTool(toolName, params);

          expect(textOf(response)).toMatch(/"Id":\s*"1"/);
        }

        const item = await createQuickbooksItem({
          name: "Widget",
          type: "Service",
          income_account_ref: "1",
        });

        expect(item.isError).toBe(false);
      },
    );
  });

  it("rejects a billable vendor-credit line that has no customer", () => {
    const schema = toolByName("create_vendor_credit").schema;
    const missingCustomer = schema.safeParse({
      vendor_ref: "1",
      line_items: [{ amount: 1, billable_status: "Billable" }],
    });

    const withCustomer = schema.safeParse({
      vendor_ref: "1",
      line_items: [
        { amount: 1, billable_status: "Billable", customer_ref: "2" },
      ],
    });

    const notBillable = schema.safeParse({
      vendor_ref: "1",
      line_items: [{ amount: 1, billable_status: "NotBillable" }],
    });

    expect(missingCustomer.success).toBe(false);
    expect(withCustomer.success).toBe(true);
    expect(notBillable.success).toBe(true);
  });

  it("builds bill, customer, estimate, and vendor criteria in each accepted shape", async () => {
    const tools = [
      ["search_bills", "findBills", "Bill"],
      ["search_customers", "findCustomers", "Customer"],
      ["search_estimates", "findEstimates", "Estimate"],
      ["search_vendors", "findVendors", "Vendor"],
    ] as const;

    for (const [toolName, method, entityName] of tools) {
      const entityRowsClient = queryClient(method, {
        [entityName]: [savedEntity],
      });

      const countClient = queryClient(method, { totalCount: 2 });

      const missingParams = textOf(
        await callRaw(toolName, {}, entityRowsClient),
      );

      const headerOnly = textOf(
        await callTool(toolName, { limit: 1 }, countClient),
      );

      const byField = textOf(
        await callTool(
          toolName,
          {
            criteria: [{ field: "DocNumber", value: "A", operator: "=" }],
            limit: 1,
          },
          entityRowsClient,
        ),
      );

      const byKey = textOf(
        await callTool(
          toolName,
          {
            criteria: [
              { key: "DocNumber", value: "A" },
              { key: "PrivateNote", value: null },
              { key: "Memo", value: undefined },
            ],
            limit: 1,
          },
          entityRowsClient,
        ),
      );

      expect(missingParams).toContain("1");
      expect(headerOnly).toContain("Count");
      expect(byField).toContain("1");
      expect(byKey).toContain("1");
    }
  });

  it("validates account, invoice, and item criteria and returns empty matches", async () => {
    const accountRows = queryClient("findAccounts", { Account: [savedEntity] });
    const accountEmpty = queryClient("findAccounts", {});
    const invoiceRows = queryClient("findInvoices", { Invoice: [savedEntity] });
    const invoiceEmpty = queryClient("findInvoices", {});
    const itemRows = queryClient("findItems", { Item: [savedEntity] });
    const itemEmpty = queryClient("findItems", {});

    const accountShapes = [
      {
        filters: [
          { field: "Name", value: "Cash" },
          { field: "CurrentBalance", value: 5 },
          { field: "Active", value: true },
          { field: "MetaData.CreateTime", value: "2020-01-01" },
        ],
        asc: "Name",
        desc: "CurrentBalance",
        limit: 5,
      },
      [
        { Name: "Cash" },
        { Name: 12 },
        { CurrentBalance: 5 },
        { CurrentBalance: "5" },
        { Active: true },
        { Active: false },
        { Active: "true" },
        { Active: 1 },
        { Active: "1" },
        { Active: "no" },
        { "MetaData.CreateTime": "2020-01-01" },
        { "MetaData.CreateTime": 5 },
        { Unknown: 1 },
        { Name: ["a", 1] },
      ],
      { Name: "Cash", Active: false },
    ];

    for (const criteria of accountShapes) {
      const accountListText = textOf(
        await callTool("search_accounts", { criteria }, accountRows),
      );

      expect(accountListText).toContain("accounts");
    }

    const accountMiss = textOf(
      await callTool(
        "search_accounts",
        { criteria: { Active: true } },
        accountEmpty,
      ),
    );

    const unknownAccountField = textOf(
      await callTool(
        "search_accounts",
        { criteria: { filters: [{ field: "Nope", value: "x" }], asc: "Nope" } },
        accountRows,
      ),
    );

    const notAnAccountCriteria = textOf(
      await callTool("search_accounts", { criteria: "nope" }),
    );

    expect(accountMiss).toContain("0 accounts");
    expect(unknownAccountField).toContain("accounts");
    expect(notAnAccountCriteria).toContain("Invalid criteria");

    const invoiceShapes = [
      {
        filters: [
          { field: "DocNumber", value: "A" },
          { field: "Balance", value: 5 },
          { field: "TxnDate", value: "2020-01-01" },
        ],
        asc: "DocNumber",
      },
      { filters: [{ field: "Balance", value: "5" }] },
      { filters: [{ field: "Nope", value: "A" }], desc: "Nope" },
      { DocNumber: "A" },
    ];

    for (const criteria of invoiceShapes) {
      await callTool("search_invoices", { criteria }, invoiceRows);
    }

    const invoiceMiss = textOf(
      await callTool(
        "search_invoices",
        { criteria: { DocNumber: "A" } },
        invoiceEmpty,
      ),
    );

    const notAnInvoiceCriteria = textOf(
      await callTool("search_invoices", { criteria: null }),
    );

    expect(invoiceMiss).toContain("0 invoices");
    expect(notAnInvoiceCriteria).toContain("Invalid criteria");

    const itemShapes = [
      {
        filters: [
          { field: "Name", value: "Widget" },
          { field: "Active", value: true },
          { field: "MetaData.CreateTime", value: "2020-01-01" },
          { field: "Name", value: ["Widget", "Gadget"] },
        ],
        asc: "Name",
        desc: "Type",
      },
      { filters: [{ field: "Sku", value: ["A", 1] }] },
      { filters: [{ field: "Nope", value: "x" }], asc: "Nope" },
      { filters: [{ field: "Active", value: "true" }] },
      { filters: [{ field: "Name", value: 1 }] },
      { filters: [{ field: "MetaData.CreateTime", value: 1 }] },
      { Name: "Widget" },
    ];

    for (const criteria of itemShapes) {
      await callTool("search_items", { criteria }, itemRows);
    }

    const itemMiss = textOf(
      await callTool(
        "search_items",
        { criteria: { Name: "Widget" } },
        itemEmpty,
      ),
    );

    const notAnItemCriteria = textOf(
      await callTool("search_items", { criteria: null }),
    );

    expect(itemMiss).toContain("0 items");
    expect(notAnItemCriteria).toContain("Invalid criteria");

    await searchQuickbooksCustomers();
    await searchQuickbooksEstimates();
    await searchQuickbooksAccounts({});
    await searchQuickbooksInvoices({});
    await searchQuickbooksItems({});

    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: queryClient("findCustomers", { totalCount: 3 }),
      },
      () => searchQuickbooksCustomers(),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: queryClient("findCustomers", {}),
      },
      () => searchQuickbooksCustomers(),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: queryClient("findEstimates", { totalCount: 3 }),
      },
      () => searchQuickbooksEstimates(),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: queryClient("findEstimates", {}),
      },
      () => searchQuickbooksEstimates(),
    );
  });

  it("covers delete fallbacks and sparse update errors", async () => {
    const entity = { Id: "1", SyncToken: "0" };

    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({ deleteCustomer: succeed({ Id: "1" }) }),
      },
      () => deleteQuickbooksCustomer(entity),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({
          deleteCustomer: fail(),
          updateCustomer: succeed({ Id: "1" }),
        }),
      },
      () => deleteQuickbooksCustomer(entity),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({
          deleteCustomer: fail(),
          getCustomer: succeed(null),
        }),
      },
      () => deleteQuickbooksCustomer("1"),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({ getCustomer: succeed({}) }),
      },
      () => deleteQuickbooksCustomer("1"),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({ getCustomer: succeed(null) }),
      },
      () => deleteQuickbooksCustomer({ Name: "Ada" }),
    );

    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({ getEmployee: succeed(null) }),
      },
      () => deleteQuickbooksEmployee("1"),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({ getEmployee: succeed(null) }),
      },
      () => deleteQuickbooksEmployee({ Name: "Ada" }),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({ getItem: succeed(null) }),
      },
      () => deleteQuickbooksItem("1"),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({ getItem: succeed(null) }),
      },
      () => deleteQuickbooksItem({ Name: "Widget" }),
    );

    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({
          getInvoice: succeed(null),
          voidInvoice: succeed({ Id: "1" }),
        }),
      },
      () => deleteQuickbooksInvoice("1"),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({
          deleteInvoice: fail(),
          getInvoice: succeed(undefined),
        }),
      },
      () => deleteQuickbooksInvoice("1"),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({
          deleteInvoice: fail(),
          voidInvoice: succeed({ Id: "1" }),
        }),
      },
      () => deleteQuickbooksInvoice(entity),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({
          getInvoice: succeed(entity),
          voidInvoice: succeed({ Id: "1" }),
        }),
      },
      () => deleteQuickbooksInvoice("9"),
    );
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({ getInvoice: succeed(null) }),
      },
      () => deleteQuickbooksInvoice({ SyncToken: "0" }),
    );

    const invoiceError = await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({
          getInvoice: succeed(entity),
          updateInvoice: fail(),
        }),
      },
      () =>
        updateQuickbooksInvoice({
          invoice_id: "1",
          patch: { PrivateNote: "note" },
        }),
    );

    const itemError = await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: quickbooks({
          getItem: succeed(entity),
          updateItem: fail(),
        }),
      },
      () => updateQuickbooksItem({ item_id: "1", patch: { Name: "Widget" } }),
    );

    expect(invoiceError.isError).toBe(true);
    expect(itemError.isError).toBe(true);
  });
});
