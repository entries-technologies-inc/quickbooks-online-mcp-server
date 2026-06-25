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
const { getQuickbooksVendor } =
  await import("../../../src/handlers/get-quickbooks-vendor.handler");

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("runWithQuickbooksContext", () => {
  it("returns synchronous callback values without losing injected context", () => {
    const quickbooks = { marker: "sync" };

    const result = runWithQuickbooksContext(
      {
        quickbooks: quickbooks as never,
        accessToken: "sync-access-token",
        realmId: "sync-realm",
        isSandbox: true,
      },
      () => "sync-result",
    );

    expect(result).toBe("sync-result");
  });

  it("restores the outer injected context after a nested context exits", async () => {
    const outerQuickbooks = { marker: "outer" };
    const innerQuickbooks = { marker: "inner" };

    await runWithQuickbooksContext(
      {
        quickbooks: outerQuickbooks as never,
        accessToken: "outer-access-token",
        realmId: "outer-realm",
        isSandbox: true,
      },
      async () => {
        expect(await QuickbooksClient.getInstance()).toBe(outerQuickbooks);

        await runWithQuickbooksContext(
          {
            quickbooks: innerQuickbooks as never,
            accessToken: "inner-access-token",
            realmId: "inner-realm",
            isSandbox: false,
          },
          async () => {
            expect(await QuickbooksClient.getInstance()).toBe(innerQuickbooks);
            expect(await QuickbooksClient.getAuthCredentials()).toEqual({
              accessToken: "inner-access-token",
              realmId: "inner-realm",
              isSandbox: false,
            });
          },
        );

        expect(await QuickbooksClient.getInstance()).toBe(outerQuickbooks);
        expect(await QuickbooksClient.getAuthCredentials()).toEqual({
          accessToken: "outer-access-token",
          realmId: "outer-realm",
          isSandbox: true,
        });
      },
    );
  });

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

  it("keeps many concurrent injected contexts isolated across repeated awaits", async () => {
    const contextCount = 50;
    const iterationsPerContext = 6;
    const readyCount = createCounter(contextCount);
    const releaseAll = createDeferred();

    const runs = Array.from({ length: contextCount }, async (_, index) => {
      const quickbooks = { marker: `quickbooks-${index}` };
      const isSandbox = index % 2 === 0;

      return runWithQuickbooksContext(
        {
          quickbooks: quickbooks as never,
          accessToken: `access-token-${index}`,
          realmId: `realm-${index}`,
          isSandbox,
        },
        async () => {
          readyCount.increment();
          await releaseAll.promise;

          for (
            let iteration = 0;
            iteration < iterationsPerContext;
            iteration += 1
          ) {
            expect(await QuickbooksClient.getInstance()).toBe(quickbooks);
            expect(await QuickbooksClient.getAuthCredentials()).toEqual({
              accessToken: `access-token-${index}`,
              realmId: `realm-${index}`,
              isSandbox,
            });

            await new Promise((resolve) => setImmediate(resolve));
          }
        },
      );
    });

    await readyCount.promise;
    releaseAll.resolve();
    await Promise.all(runs);
  });

  it("keeps real handler calls isolated across concurrent injected contexts", async () => {
    const firstCanCallback = createDeferred();
    const secondCanCallback = createDeferred();
    const firstQuickbooks = {
      getVendor: jest.fn(
        (_id: string, callback: (err: null, vendor: unknown) => void) => {
          void firstCanCallback.promise.then(() => {
            callback(null, { Id: "first-vendor", source: "first" });
          });
        },
      ),
    };
    const secondQuickbooks = {
      getVendor: jest.fn(
        (_id: string, callback: (err: null, vendor: unknown) => void) => {
          void secondCanCallback.promise.then(() => {
            callback(null, { Id: "second-vendor", source: "second" });
          });
        },
      ),
    };

    const firstRun = runWithQuickbooksContext(
      {
        quickbooks: firstQuickbooks as never,
        accessToken: "first-access-token",
        realmId: "first-realm",
        isSandbox: true,
      },
      () => getQuickbooksVendor("first-vendor"),
    );
    const secondRun = runWithQuickbooksContext(
      {
        quickbooks: secondQuickbooks as never,
        accessToken: "second-access-token",
        realmId: "second-realm",
        isSandbox: false,
      },
      () => getQuickbooksVendor("second-vendor"),
    );

    await new Promise((resolve) => setImmediate(resolve));
    secondCanCallback.resolve();
    firstCanCallback.resolve();

    await expect(firstRun).resolves.toMatchObject({
      isError: false,
      result: { Id: "first-vendor", source: "first" },
    });
    await expect(secondRun).resolves.toMatchObject({
      isError: false,
      result: { Id: "second-vendor", source: "second" },
    });
    expect(firstQuickbooks.getVendor).toHaveBeenCalledWith(
      "first-vendor",
      expect.any(Function),
    );
    expect(secondQuickbooks.getVendor).toHaveBeenCalledWith(
      "second-vendor",
      expect.any(Function),
    );
  });

  it("formats handler errors from the injected QuickBooks instance", async () => {
    const quickbooks = {
      getVendor: jest.fn(
        (_id: string, callback: (err: Error, vendor: null) => void) => {
          callback(new Error("vendor lookup failed"), null);
        },
      ),
    };

    const result = await runWithQuickbooksContext(
      {
        quickbooks: quickbooks as never,
        accessToken: "error-access-token",
        realmId: "error-realm",
        isSandbox: true,
      },
      () => getQuickbooksVendor("missing-vendor"),
    );

    expect(result).toEqual({
      result: null,
      isError: true,
      error: "Error: vendor lookup failed",
    });
  });
});

function createCounter(target: number) {
  let count = 0;
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    increment: () => {
      count += 1;
      if (count === target) {
        resolve();
      }
    },
  };
}
