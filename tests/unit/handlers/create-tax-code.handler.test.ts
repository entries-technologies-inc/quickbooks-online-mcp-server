import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

const { createQuickbooksTaxCode } = await import('../../../src/handlers/create-quickbooks-tax-code.handler');

const newRate = {
  name: 'My tax code',
  tax_rate_details: [
    {
      tax_rate_name: 'My rate',
      rate_value: '13',
      tax_agency_id: '1',
      tax_applicable_on: 'Sales',
    },
  ],
};

describe('createQuickbooksTaxCode', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('rejects a detail that is neither shape before calling QuickBooks', async () => {
    const empty = await createQuickbooksTaxCode({
      name: 'My tax code',
      tax_rate_details: [{}],
    });
    const mixed = await createQuickbooksTaxCode({
      name: 'My tax code',
      tax_rate_details: [
        {
          tax_rate_id: '4',
          tax_rate_name: 'My rate',
          rate_value: '13',
          tax_agency_id: '1',
        },
      ],
    });

    expect(empty.isError).toBe(true);
    expect(empty.result).toBeNull();
    expect(mixed.isError).toBe(true);
    expect(mockQuickbooksClientClass.getInstance).not.toHaveBeenCalled();
    expect(mockQuickBooksInstance.createTaxService).not.toHaveBeenCalled();
  });

  it('returns an authentication error without calling TaxService', async () => {
    (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

    const result = await createQuickbooksTaxCode(newRate);

    expect(result.isError).toBe(true);
    expect(result.error).toContain('Auth failed');
    expect(mockQuickBooksInstance.createTaxService).not.toHaveBeenCalled();
  });

  it('formats a synchronous throw from createTaxService', async () => {
    mockQuickBooksInstance.createTaxService.mockImplementation(() => {
      throw new Error('sync boom');
    });

    const result = await createQuickbooksTaxCode(newRate);

    expect(result.isError).toBe(true);
    expect(result.result).toBeNull();
    expect(result.error).toContain('sync boom');
  });

  it('passes a QuickBooks callback error through', async () => {
    mockQuickBooksInstance.createTaxService.mockImplementation((payload: any, cb: any) =>
      cb(new Error('Duplicate Name Exists Error'), null)
    );

    const result = await createQuickbooksTaxCode(newRate);

    expect(result.isError).toBe(true);
    expect(result.error).toContain('Duplicate Name Exists Error');
    expect(mockQuickBooksInstance.createTaxService).toHaveBeenCalledWith(
      {
        TaxCode: 'My tax code',
        TaxRateDetails: [
          {
            TaxRateName: 'My rate',
            RateValue: '13',
            TaxAgencyId: '1',
            TaxApplicableOn: 'Sales',
          },
        ],
      },
      expect.any(Function),
    );
  });
});
