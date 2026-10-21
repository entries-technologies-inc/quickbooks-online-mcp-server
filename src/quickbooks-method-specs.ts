/**
 * Adapted from node-quickbooks v2.0.50
 * https://github.com/mcohen01/node-quickbooks
 * ISC license. Copyright (c) 2014 Michael Cohen.
 *
 * Mirrors: QuickBooks.prototype method names and the entity tokens they pass
 * to module.create, module.read, module.update, module.delete, module.void,
 * module.query, and module.report.
 * Behaviour is intentionally identical to that version and is locked by
 * comparison tests against node-quickbooks 2.0.50.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

type EntityMethod = {
  entity: string;
  idSuffix?: string;
  noId?: boolean;
  includeFlag?: string;
  includeValue?: string;
};

export type MethodSpec =
  | ({ kind: "create" } & EntityMethod)
  | ({ kind: "get" } & EntityMethod)
  | ({ kind: "update" } & EntityMethod)
  | ({ kind: "delete" } & EntityMethod)
  | ({ kind: "void" } & EntityMethod)
  | ({ kind: "query" } & EntityMethod)
  | { kind: "report"; report: string }
  | { kind: "voidPayment" };

export const QUICKBOOKS_METHOD_SPECS: Record<string, MethodSpec> = {
  createAccount: { kind: "create", entity: "account" },
  createAttachable: { kind: "create", entity: "attachable" },
  createBill: { kind: "create", entity: "bill" },
  createBillPayment: { kind: "create", entity: "billPayment" },
  createClass: { kind: "create", entity: "class" },
  createCreditMemo: { kind: "create", entity: "creditMemo" },
  createCustomer: { kind: "create", entity: "customer" },
  createDepartment: { kind: "create", entity: "department" },
  createDeposit: { kind: "create", entity: "deposit" },
  createEmployee: { kind: "create", entity: "employee" },
  createEstimate: { kind: "create", entity: "estimate" },
  createInvoice: { kind: "create", entity: "invoice" },
  createItem: { kind: "create", entity: "item" },
  createJournalCode: { kind: "create", entity: "journalCode" },
  createJournalEntry: { kind: "create", entity: "journalEntry" },
  createPayment: { kind: "create", entity: "payment" },
  createPaymentMethod: { kind: "create", entity: "paymentMethod" },
  createPurchase: { kind: "create", entity: "purchase" },
  createPurchaseOrder: { kind: "create", entity: "purchaseOrder" },
  createRefundReceipt: { kind: "create", entity: "refundReceipt" },
  createSalesReceipt: { kind: "create", entity: "salesReceipt" },
  createTaxAgency: { kind: "create", entity: "taxAgency" },
  createTaxService: { kind: "create", entity: "taxService/taxcode" },
  createTerm: { kind: "create", entity: "term" },
  createTimeActivity: { kind: "create", entity: "timeActivity" },
  createTransfer: { kind: "create", entity: "transfer" },
  createVendor: { kind: "create", entity: "vendor" },
  createVendorCredit: { kind: "create", entity: "vendorCredit" },
  getAccount: { kind: "get", entity: "account" },
  getAttachable: { kind: "get", entity: "attachable" },
  getBill: { kind: "get", entity: "bill" },
  getBillPayment: { kind: "get", entity: "billPayment" },
  getClass: { kind: "get", entity: "class" },
  getCompanyInfo: { kind: "get", entity: "companyInfo" },
  getCompanyCurrency: { kind: "get", entity: "companyCurrency" },
  getCreditMemo: { kind: "get", entity: "creditMemo" },
  getCustomer: { kind: "get", entity: "customer" },
  getCustomerType: { kind: "get", entity: "customerType" },
  getDepartment: { kind: "get", entity: "department" },
  getDeposit: { kind: "get", entity: "deposit" },
  getEmployee: { kind: "get", entity: "employee" },
  getEstimate: { kind: "get", entity: "estimate" },
  getEstimatePdf: { kind: "get", entity: "Estimate", idSuffix: "/pdf" },
  getInvoice: { kind: "get", entity: "invoice" },
  getInvoicePdf: { kind: "get", entity: "Invoice", idSuffix: "/pdf" },
  getCreditMemoPdf: { kind: "get", entity: "CreditMemo", idSuffix: "/pdf" },
  getItem: { kind: "get", entity: "item" },
  getJournalCode: { kind: "get", entity: "journalCode" },
  getJournalEntry: { kind: "get", entity: "journalEntry" },
  getPayment: { kind: "get", entity: "payment" },
  getPaymentMethod: { kind: "get", entity: "paymentMethod" },
  getPreferences: { kind: "get", entity: "preferences", noId: true },
  getPurchase: { kind: "get", entity: "purchase" },
  getPurchaseOrder: { kind: "get", entity: "purchaseOrder" },
  getRefundReceipt: { kind: "get", entity: "refundReceipt" },
  getReports: { kind: "get", entity: "reports" },
  getSalesReceipt: { kind: "get", entity: "salesReceipt" },
  getSalesReceiptPdf: { kind: "get", entity: "salesReceipt", idSuffix: "/pdf" },
  getTaxAgency: { kind: "get", entity: "taxAgency" },
  getTaxCode: { kind: "get", entity: "taxCode" },
  getTaxRate: { kind: "get", entity: "taxRate" },
  getTerm: { kind: "get", entity: "term" },
  getTimeActivity: { kind: "get", entity: "timeActivity" },
  getTransfer: { kind: "get", entity: "transfer" },
  getVendor: { kind: "get", entity: "vendor" },
  getVendorCredit: { kind: "get", entity: "vendorCredit" },
  updateAccount: { kind: "update", entity: "account" },
  updateAttachable: { kind: "update", entity: "attachable" },
  updateBill: { kind: "update", entity: "bill" },
  updateBillPayment: { kind: "update", entity: "billPayment" },
  updateClass: { kind: "update", entity: "class" },
  updateCompanyInfo: { kind: "update", entity: "companyInfo" },
  updateCreditMemo: { kind: "update", entity: "creditMemo" },
  updateCustomer: { kind: "update", entity: "customer" },
  updateDepartment: { kind: "update", entity: "department" },
  updateDeposit: { kind: "update", entity: "deposit" },
  updateEmployee: { kind: "update", entity: "employee" },
  updateEstimate: { kind: "update", entity: "estimate" },
  updateInvoice: { kind: "update", entity: "invoice" },
  updateItem: {
    kind: "update",
    entity: "item",
    includeFlag: "doNotUpdateAccountOnTxns",
    includeValue: "donotupdateaccountontxns",
  },
  updateJournalCode: { kind: "update", entity: "journalCode" },
  updateJournalEntry: { kind: "update", entity: "journalEntry" },
  updatePayment: { kind: "update", entity: "payment" },
  updatePaymentMethod: { kind: "update", entity: "paymentMethod" },
  updatePreferences: { kind: "update", entity: "preferences" },
  updatePurchase: { kind: "update", entity: "purchase" },
  updatePurchaseOrder: { kind: "update", entity: "purchaseOrder" },
  updateRefundReceipt: { kind: "update", entity: "refundReceipt" },
  updateSalesReceipt: { kind: "update", entity: "salesReceipt" },
  updateTaxAgency: { kind: "update", entity: "taxAgency" },
  updateTaxCode: { kind: "update", entity: "taxCode" },
  updateTaxRate: { kind: "update", entity: "taxRate" },
  updateTerm: { kind: "update", entity: "term" },
  updateTimeActivity: { kind: "update", entity: "timeActivity" },
  updateTransfer: { kind: "update", entity: "transfer" },
  updateVendor: { kind: "update", entity: "vendor" },
  updateVendorCredit: { kind: "update", entity: "vendorCredit" },
  updateExchangeRate: { kind: "update", entity: "exchangerate" },
  deleteAttachable: { kind: "delete", entity: "attachable" },
  deleteBill: { kind: "delete", entity: "bill" },
  deleteBillPayment: { kind: "delete", entity: "billPayment" },
  deleteCreditMemo: { kind: "delete", entity: "creditMemo" },
  deleteDeposit: { kind: "delete", entity: "deposit" },
  deleteEstimate: { kind: "delete", entity: "estimate" },
  deleteInvoice: { kind: "delete", entity: "invoice" },
  deleteJournalCode: { kind: "delete", entity: "journalCode" },
  deleteJournalEntry: { kind: "delete", entity: "journalEntry" },
  deletePayment: { kind: "delete", entity: "payment" },
  deletePurchase: { kind: "delete", entity: "purchase" },
  deletePurchaseOrder: { kind: "delete", entity: "purchaseOrder" },
  deleteRefundReceipt: { kind: "delete", entity: "refundReceipt" },
  deleteSalesReceipt: { kind: "delete", entity: "salesReceipt" },
  deleteTimeActivity: { kind: "delete", entity: "timeActivity" },
  deleteTransfer: { kind: "delete", entity: "transfer" },
  deleteVendorCredit: { kind: "delete", entity: "vendorCredit" },
  voidInvoice: { kind: "void", entity: "invoice" },
  voidPayment: { kind: "voidPayment" },
  findAccounts: { kind: "query", entity: "account" },
  findAttachables: { kind: "query", entity: "attachable" },
  findBills: { kind: "query", entity: "bill" },
  findBillPayments: { kind: "query", entity: "billPayment" },
  findBudgets: { kind: "query", entity: "budget" },
  findClasses: { kind: "query", entity: "class" },
  findCompanyInfos: { kind: "query", entity: "companyInfo" },
  findCompanyCurrencies: { kind: "query", entity: "companyCurrency" },
  findCreditMemos: { kind: "query", entity: "creditMemo" },
  findCustomers: { kind: "query", entity: "customer" },
  findCustomerTypes: { kind: "query", entity: "customerType" },
  findDepartments: { kind: "query", entity: "department" },
  findDeposits: { kind: "query", entity: "deposit" },
  findEmployees: { kind: "query", entity: "employee" },
  findEstimates: { kind: "query", entity: "estimate" },
  findInvoices: { kind: "query", entity: "invoice" },
  findItems: { kind: "query", entity: "item" },
  findJournalCodes: { kind: "query", entity: "journalCode" },
  findJournalEntries: { kind: "query", entity: "journalEntry" },
  findPayments: { kind: "query", entity: "payment" },
  findPaymentMethods: { kind: "query", entity: "paymentMethod" },
  findPreferenceses: { kind: "query", entity: "preferences" },
  findPurchases: { kind: "query", entity: "purchase" },
  findPurchaseOrders: { kind: "query", entity: "purchaseOrder" },
  findRefundReceipts: { kind: "query", entity: "refundReceipt" },
  findSalesReceipts: { kind: "query", entity: "salesReceipt" },
  findTaxAgencies: { kind: "query", entity: "taxAgency" },
  findTaxCodes: { kind: "query", entity: "taxCode" },
  findTaxRates: { kind: "query", entity: "taxRate" },
  findTerms: { kind: "query", entity: "term" },
  findTimeActivities: { kind: "query", entity: "timeActivity" },
  findTransfers: { kind: "query", entity: "transfer" },
  findVendors: { kind: "query", entity: "vendor" },
  findVendorCredits: { kind: "query", entity: "vendorCredit" },
  findExchangeRates: { kind: "query", entity: "exchangerate" },
  reportBalanceSheet: { kind: "report", report: "BalanceSheet" },
  reportProfitAndLoss: { kind: "report", report: "ProfitAndLoss" },
  reportProfitAndLossDetail: { kind: "report", report: "ProfitAndLossDetail" },
  reportTrialBalance: { kind: "report", report: "TrialBalance" },
  reportTrialBalanceFR: { kind: "report", report: "TrialBalanceFR" },
  reportCashFlow: { kind: "report", report: "CashFlow" },
  reportInventoryValuationSummary: {
    kind: "report",
    report: "InventoryValuationSummary",
  },
  reportCustomerSales: { kind: "report", report: "CustomerSales" },
  reportItemSales: { kind: "report", report: "ItemSales" },
  reportCustomerIncome: { kind: "report", report: "CustomerIncome" },
  reportCustomerBalance: { kind: "report", report: "CustomerBalance" },
  reportCustomerBalanceDetail: {
    kind: "report",
    report: "CustomerBalanceDetail",
  },
  reportAgedReceivables: { kind: "report", report: "AgedReceivables" },
  reportAgedReceivableDetail: {
    kind: "report",
    report: "AgedReceivableDetail",
  },
  reportVendorBalance: { kind: "report", report: "VendorBalance" },
  reportVendorBalanceDetail: { kind: "report", report: "VendorBalanceDetail" },
  reportAgedPayables: { kind: "report", report: "AgedPayables" },
  reportAgedPayableDetail: { kind: "report", report: "AgedPayableDetail" },
  reportVendorExpenses: { kind: "report", report: "VendorExpenses" },
  reportTransactionList: { kind: "report", report: "TransactionList" },
  reportTransactionListWithSplits: {
    kind: "report",
    report: "TransactionListWithSplits",
  },
  reportTransactionListByCustomer: {
    kind: "report",
    report: "TransactionListByCustomer",
  },
  reportTransactionListByVendor: {
    kind: "report",
    report: "TransactionListByVendor",
  },
  reportGeneralLedgerDetail: { kind: "report", report: "GeneralLedger" },
  reportTaxSummary: { kind: "report", report: "TaxSummary" },
  reportDepartmentSales: { kind: "report", report: "DepartmentSales" },
  reportClassSales: { kind: "report", report: "ClassSales" },
  reportAccountListDetail: { kind: "report", report: "AccountList" },
  reportJournalReport: { kind: "report", report: "JournalReport" },
};
