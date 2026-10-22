import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Mark a vendor inactive. QuickBooks Online does not delete vendors, and
 * node-quickbooks 2.0.50 has no deleteVendor. A sparse update with Id,
 * SyncToken, and Active is valid; a full update would also require DisplayName.
 * The proxy sets sparse when it is missing; set it here so the payload is
 * sparse even if a caller bypasses the proxy.
 */
export async function deleteQuickbooksVendor(vendor: any): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await QuickbooksClient.getInstance();
    const inactive = {
      Id: vendor.Id,
      SyncToken: vendor.SyncToken,
      Active: false,
      sparse: true,
    };

    return new Promise((resolve) => {
      quickbooks.updateVendor(inactive, (err: any, updatedVendor: any) => {
        if (err) {
          resolve({
            result: null,
            isError: true,
            error: formatError(err),
          });
        } else {
          resolve({
            result: updatedVendor,
            isError: false,
            error: null,
          });
        }
      });
    });
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
} 
