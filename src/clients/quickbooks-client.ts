import { AsyncLocalStorage } from "node:async_hooks";
import type { QueryDefaults } from "../query-defaults.js";
import { createQuickbooksProxy } from "../quickbooks-proxy.js";
import type { Transport } from "../transport.js";

// Handlers import this module. It must not import node-quickbooks, intuit-oauth,
// dotenv, or open. The CLI registers an OAuth fallback from src/index.ts.
export type QuickbooksApi = {
  realmId: string;
  [method: string]: any;
};

export type InjectedQuickbooksContext = {
  quickbooks?: QuickbooksApi;
  accessToken: string;
  realmId: string;
  isSandbox: boolean;
  baseUrl?: string;
  transport?: Transport;
  queryDefaults?: QueryDefaults;
};

export type QuickbooksAuthCredentials = {
  accessToken: string;
  realmId: string;
  isSandbox: boolean;
};

type OAuthFallback = {
  getInstance: () => Promise<QuickbooksApi>;
  getAuthCredentials: () => Promise<QuickbooksAuthCredentials>;
};

const injectedQuickbooksContextStorage =
  new AsyncLocalStorage<InjectedQuickbooksContext>();

let oauthFallback: OAuthFallback | undefined;

export function registerQuickbooksOAuthFallback(fallback: OAuthFallback): void {
  oauthFallback = fallback;
}

export function runWithQuickbooksContext<T>(
  context: InjectedQuickbooksContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return injectedQuickbooksContextStorage.run(context, fn);
}

export function getInjectedQuickbooksContext():
  InjectedQuickbooksContext | undefined {
  return injectedQuickbooksContextStorage.getStore();
}

export class QuickbooksClient {
  static async getInstance(): Promise<QuickbooksApi> {
    const injected = injectedQuickbooksContextStorage.getStore();
    if (injected?.transport) {
      return createQuickbooksProxy({
        realmId: injected.realmId,
        transport: injected.transport,
        accessToken: injected.accessToken,
        isSandbox: injected.isSandbox,
        baseUrl: injected.baseUrl,
        queryDefaults: injected.queryDefaults,
      });
    }
    if (injected?.quickbooks) return injected.quickbooks;
    if (!oauthFallback) {
      throw new Error("QuickBooks OAuth client is not registered");
    }

    return oauthFallback.getInstance();
  }

  static async getAuthCredentials(): Promise<QuickbooksAuthCredentials> {
    const injected = injectedQuickbooksContextStorage.getStore();
    if (injected) {
      return {
        accessToken: injected.accessToken,
        realmId: injected.realmId,
        isSandbox: injected.isSandbox,
      };
    }
    if (!oauthFallback) throw new Error("Quickbooks not authenticated");

    return oauthFallback.getAuthCredentials();
  }
}
