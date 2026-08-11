import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

// ESM-compatible module mocking
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

// Dynamic imports after mock setup
const { createQuickbooksInvoice } = await import('../../../src/handlers/create-quickbooks-invoice.handler');

describe('Invoice Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('createQuickbooksInvoice', () => {
    it('should create an invoice successfully', async () => {
      const mockInvoice = { Id: '123', TotalAmt: 100 };
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) => cb(null, mockInvoice));

      const result = await createQuickbooksInvoice({
        customer_ref: 'cust-1',
        line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 100 }]
      });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockInvoice);
      const payload = (mockQuickBooksInstance.createInvoice.mock.calls[0] as any)[0];
      expect(payload).not.toHaveProperty('GlobalTaxCalculation');
    });

    it('should pass per-line TaxCodeRef and GlobalTaxCalculation to QuickBooks', async () => {
      const mockInvoice = { Id: '123', TotalAmt: 100 };
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) => cb(null, mockInvoice));

      const result = await createQuickbooksInvoice({
        customer_ref: 'cust-1',
        line_items: [
          { item_ref: 'item-1', qty: 2, unit_price: 50, tax_code_ref: '14' },
          { item_ref: 'item-2', qty: 1, unit_price: 75 }
        ],
        global_tax_calculation: 'TaxExcluded'
      });

      expect(result.isError).toBe(false);
      const payload = (mockQuickBooksInstance.createInvoice.mock.calls[0] as any)[0];
      expect(payload.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: '14' });
      expect(payload.Line[1].SalesItemLineDetail.TaxCodeRef).toBeUndefined();
      expect(payload.GlobalTaxCalculation).toBe('TaxExcluded');
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

      const result = await createQuickbooksInvoice({ customer_ref: 'cust-1', line_items: [] });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Validation error'), null)
      );

      const result = await createQuickbooksInvoice({ customer_ref: 'cust-1', line_items: [] });

      expect(result.isError).toBe(true);
    });

    it('should map multicurrency fields onto the QBO payload', async () => {
      let capturedPayload: any = null;
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) => {
        capturedPayload = payload;
        cb(null, { Id: '123' });
      });

      const result = await createQuickbooksInvoice({
        customer_ref: 'cust-1',
        line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 100 }],
        currency_ref: 'GBP',
        exchange_rate: 1.17,
      });

      expect(result.isError).toBe(false);
      expect(capturedPayload.CurrencyRef).toEqual({ value: 'GBP' });
      expect(capturedPayload.ExchangeRate).toBe(1.17);
    });

    it('should omit multicurrency fields when not provided', async () => {
      let capturedPayload: any = null;
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) => {
        capturedPayload = payload;
        cb(null, { Id: '123' });
      });

      await createQuickbooksInvoice({
        customer_ref: 'cust-1',
        line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 100 }],
      });

      expect(capturedPayload).not.toHaveProperty('CurrencyRef');
      expect(capturedPayload).not.toHaveProperty('ExchangeRate');
    });
  });
});
