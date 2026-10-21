#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { QuickbooksMCPServer } from "./server/qbo-mcp-server.js";
import { RegisterTool } from "./helpers/register-tool.js";
import { qboTools } from "./tools/catalog.js";
import {
  registerQuickbooksOAuthFallback,
  type QuickbooksApi,
} from "./clients/quickbooks-client.js";
import { QuickbooksClient as OauthQuickbooksClient } from "./clients/quickbooks-oauth.js";

registerQuickbooksOAuthFallback({
  // The OAuth class is the node-quickbooks client. Callers only need the
  // structural QuickbooksApi shape (realmId plus the method table).
  getInstance: () =>
    OauthQuickbooksClient.getInstance() as unknown as Promise<QuickbooksApi>,
  getAuthCredentials: () => OauthQuickbooksClient.getAuthCredentials(),
});

const main = async () => {
  const server = QuickbooksMCPServer.GetServer();
  // ListInvoices and ListAccounts stay unregistered. CreateCustomer and
  // UpdateCustomer are registered once; the duplicate lines stay out.
  for (const tool of qboTools) RegisterTool(server, tool);

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
