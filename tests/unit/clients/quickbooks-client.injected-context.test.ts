import { jest } from "@jest/globals";

process.env.QUICKBOOKS_CLIENT_ID = "";
process.env.QUICKBOOKS_CLIENT_SECRET = "";
process.env.QUICKBOOKS_REFRESH_TOKEN = "";
process.env.QUICKBOOKS_REALM_ID = "";
process.env.QUICKBOOKS_ENVIRONMENT = "sandbox";
process.env.QUICKBOOKS_REDIRECT_URI = "";

jest.unstable_mockModule("node-quickbooks", () => ({
  default: class MockQuickBooks {
    constructor(..._args: unknown[]) {}
  },
}));

jest.unstable_mockModule("intuit-oauth", () => ({
  default: class MockOAuthClient {
    static scopes: { Accounting: string } = {
      Accounting: "com.intuit.quickbooks.accounting",
    };
    constructor(_cfg: Record<string, unknown>) {}
  },
}));

jest.unstable_mockModule("open", () => ({
  default: jest.fn(async () => undefined),
}));
jest.unstable_mockModule("fs", () => ({
  default: {
    readFileSync: jest.fn(),
    existsSync: jest.fn(() => false),
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
    unlinkSync: jest.fn(),
  },
}));

const { QuickbooksClient, runWithQuickbooksContext } =
  await import("../../../src/clients/quickbooks-client");

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("runWithQuickbooksContext", () => {
  it("keeps injected QuickBooks instances and credentials isolated across interleaved async work", async () => {
    const firstCanContinue = createDeferred();
    const secondStarted = createDeferred();
    const firstQuickbooks = { marker: "first" };
    const secondQuickbooks = { marker: "second" };

    const firstRun = runWithQuickbooksContext(
      {
        quickbooks: firstQuickbooks as never,
        accessToken: "first-access-token",
        realmId: "first-realm",
        isSandbox: true,
      },
      async () => {
        expect(await QuickbooksClient.getInstance()).toBe(firstQuickbooks);
        expect(await QuickbooksClient.getAuthCredentials()).toEqual({
          accessToken: "first-access-token",
          realmId: "first-realm",
          isSandbox: true,
        });

        await secondStarted.promise;
        await firstCanContinue.promise;

        expect(await QuickbooksClient.getInstance()).toBe(firstQuickbooks);
        expect(await QuickbooksClient.getAuthCredentials()).toEqual({
          accessToken: "first-access-token",
          realmId: "first-realm",
          isSandbox: true,
        });
      },
    );

    const secondRun = runWithQuickbooksContext(
      {
        quickbooks: secondQuickbooks as never,
        accessToken: "second-access-token",
        realmId: "second-realm",
        isSandbox: false,
      },
      async () => {
        secondStarted.resolve();

        expect(await QuickbooksClient.getInstance()).toBe(secondQuickbooks);
        expect(await QuickbooksClient.getAuthCredentials()).toEqual({
          accessToken: "second-access-token",
          realmId: "second-realm",
          isSandbox: false,
        });

        await new Promise((resolve) => setImmediate(resolve));

        expect(await QuickbooksClient.getInstance()).toBe(secondQuickbooks);
        expect(await QuickbooksClient.getAuthCredentials()).toEqual({
          accessToken: "second-access-token",
          realmId: "second-realm",
          isSandbox: false,
        });

        firstCanContinue.resolve();
      },
    );

    await Promise.all([firstRun, secondRun]);
  });
});
