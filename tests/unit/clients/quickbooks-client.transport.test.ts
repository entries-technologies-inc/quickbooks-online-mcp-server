import {
  QuickbooksClient,
  registerQuickbooksOAuthFallback,
  runWithQuickbooksContext,
} from "../../../src/clients/quickbooks-client.js";
import type { QboHttpRequest } from "../../../src/transport.js";

describe("QuickbooksClient transport", () => {
  const credentials = {
    accessToken: "token",
    realmId: "realm",
    isSandbox: true,
  };

  it("returns the proxy when the injected context has a transport", async () => {
    const seen: QboHttpRequest[] = [];
    await runWithQuickbooksContext(
      {
        ...credentials,
        quickbooks: { realmId: "ignored", marker: true },
        transport: async (request) => {
          seen.push(request);
          return { status: 200, body: { Bill: { Id: "1" } } };
        },
      },
      async () => {
        const quickbooks = await QuickbooksClient.getInstance();
        expect(quickbooks.realmId).toBe("realm");
        expect(quickbooks).not.toEqual({ realmId: "ignored", marker: true });
        await new Promise<void>((resolve) => {
          quickbooks.getBill("1", () => resolve());
        });
        expect(await QuickbooksClient.getAuthCredentials()).toEqual(
          credentials,
        );
      },
    );
    expect(seen[0]?.op).toEqual({ kind: "get", entity: "Bill" });
  });

  it("returns the injected client when no transport is set", async () => {
    const quickbooks = { realmId: "realm", marker: "injected" };
    await runWithQuickbooksContext({ ...credentials, quickbooks }, async () => {
      expect(await QuickbooksClient.getInstance()).toBe(quickbooks);
    });
  });

  it("uses the registered OAuth fallback outside an injected context", async () => {
    const fallbackClient = { realmId: "oauth-realm" };
    registerQuickbooksOAuthFallback({
      getInstance: async () => fallbackClient,
      getAuthCredentials: async () => ({
        accessToken: "oauth-token",
        realmId: "oauth-realm",
        isSandbox: false,
      }),
    });

    await runWithQuickbooksContext({ ...credentials }, async () => {
      expect(await QuickbooksClient.getInstance()).toBe(fallbackClient);
    });
    expect(await QuickbooksClient.getInstance()).toBe(fallbackClient);
    expect(await QuickbooksClient.getAuthCredentials()).toEqual({
      accessToken: "oauth-token",
      realmId: "oauth-realm",
      isSandbox: false,
    });
  });

  it("throws when no client is registered and nothing is injected", async () => {
    registerQuickbooksOAuthFallback(undefined as never);
    await expect(QuickbooksClient.getInstance()).rejects.toThrow(
      "QuickBooks OAuth client is not registered",
    );
    await expect(QuickbooksClient.getAuthCredentials()).rejects.toThrow(
      "Quickbooks not authenticated",
    );
  });
});
