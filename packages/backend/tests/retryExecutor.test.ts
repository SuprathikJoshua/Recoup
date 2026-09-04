import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SETTLEMENT_SUCCESS_RATES,
  getSettlementSuccessRate,
  executeDecision,
  razorpay,
} from "../src/executor/retryExecutor.js";
import { prisma } from "../src/config/db.js";
import * as auditLogger from "../src/audit/auditLogger.js";
import { AttemptResult, TxnStatus, Prisma } from "../src/generated/prisma/client.js";

describe("Settlement Success Rate Configuration", () => {
  it("should have correct settlement success rates defined", () => {
    expect(SETTLEMENT_SUCCESS_RATES.INSUFFICIENT_FUND).toBe(0.65);
    expect(SETTLEMENT_SUCCESS_RATES.BANK_ERROR).toBe(0.80);
    expect(SETTLEMENT_SUCCESS_RATES.DEFAULT).toBe(0.70);
  });

  it("should resolve rate correctly using getSettlementSuccessRate", () => {
    expect(getSettlementSuccessRate("INSUFFICIENT_FUND")).toBe(0.65);
    expect(getSettlementSuccessRate("BANK_ERROR")).toBe(0.80);
    expect(getSettlementSuccessRate("OTHER_BUCKET")).toBe(0.70);
    expect(getSettlementSuccessRate(undefined)).toBe(0.70);
  });
});

describe("executeDecision - Realistic Settlement Layer & Distinct Audit Logging", () => {
  const mockTxn = {
    txnId: "TXN_TEST_100",
    customerId: "CUST_001",
    amount: new Prisma.Decimal("1500.00"),
    failCode: "01",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
  });

  it("should treat Razorpay API failure as automatic FAILED and log 'Razorpay order creation failed'", async () => {
    vi.spyOn(prisma.failedTransaction, "findUnique").mockResolvedValue(mockTxn as any);
    vi.spyOn(prisma.failedTransaction, "update").mockResolvedValue({} as any);
    vi.spyOn(prisma.customerContext, "update").mockResolvedValue({} as any);
    vi.spyOn(prisma.retryAttempt, "create").mockResolvedValue({
      id: "att_1",
      txnId: "TXN_TEST_100",
      attemptNo: 1,
      attemptTimestamp: new Date(),
      actionTaken: "RAZORPAY_API_RETRY",
      result: AttemptResult.FAILED,
      feeCharged: new Prisma.Decimal("2.00"),
    } as any);

    const logAuditSpy = vi.spyOn(auditLogger, "logAudit").mockResolvedValue({} as any);
    vi.spyOn(razorpay.orders, "create").mockRejectedValue(new Error("Network timeout / 401 Unauthorized"));
    const mathRandomSpy = vi.spyOn(Math, "random");

    const result = await executeDecision(
      "TXN_TEST_100",
      { action: "RETRY_SCHEDULED", reason: "Aligned with historical salary/debit pattern" },
      0,
      "CUST_001",
      "INSUFFICIENT_FUND"
    );

    expect(result.status).toBe(TxnStatus.PENDING);
    expect(result.retryAttempt?.result).toBe(AttemptResult.FAILED);
    // Probabilistic simulation should NOT run when real API call fails
    expect(mathRandomSpy).not.toHaveBeenCalled();

    expect(logAuditSpy).toHaveBeenCalledWith(
      "TXN_TEST_100",
      "EXECUTE_RETRY_SCHEDULED",
      expect.stringContaining("Razorpay order creation failed")
    );
  });

  it("should record SUCCESS when API call succeeds and settlement simulation passes", async () => {
    vi.spyOn(prisma.failedTransaction, "findUnique").mockResolvedValue(mockTxn as any);
    vi.spyOn(prisma.failedTransaction, "update").mockResolvedValue({} as any);
    vi.spyOn(prisma.customerContext, "update").mockResolvedValue({} as any);
    vi.spyOn(prisma.retryAttempt, "create").mockResolvedValue({
      id: "att_1",
      txnId: "TXN_TEST_100",
      attemptNo: 1,
      attemptTimestamp: new Date(),
      actionTaken: "RAZORPAY_API_RETRY",
      result: AttemptResult.SUCCESS,
      feeCharged: new Prisma.Decimal("2.00"),
    } as any);

    const logAuditSpy = vi.spyOn(auditLogger, "logAudit").mockResolvedValue({} as any);
    vi.spyOn(razorpay.orders, "create").mockResolvedValue({ id: "order_rzp_mock123" } as any);
    vi.spyOn(Math, "random").mockReturnValue(0.50); // 0.50 < 0.65 (INSUFFICIENT_FUND rate) -> SUCCESS

    const result = await executeDecision(
      "TXN_TEST_100",
      { action: "RETRY_SCHEDULED", reason: "Aligned with historical salary/debit pattern" },
      0,
      "CUST_001",
      "INSUFFICIENT_FUND"
    );

    expect(result.status).toBe(TxnStatus.RESOLVED_RECOVERED);
    expect(result.retryAttempt?.result).toBe(AttemptResult.SUCCESS);

    expect(logAuditSpy).toHaveBeenCalledWith(
      "TXN_TEST_100",
      "EXECUTE_RETRY_SCHEDULED",
      expect.stringContaining("Result SUCCESS (Order ID: order_rzp_mock123)")
    );
  });

  it("should record FAILED and log simulated settlement failure when API succeeds but settlement declines", async () => {
    vi.spyOn(prisma.failedTransaction, "findUnique").mockResolvedValue(mockTxn as any);
    vi.spyOn(prisma.failedTransaction, "update").mockResolvedValue({} as any);
    vi.spyOn(prisma.customerContext, "update").mockResolvedValue({} as any);
    vi.spyOn(prisma.retryAttempt, "create").mockResolvedValue({
      id: "att_1",
      txnId: "TXN_TEST_100",
      attemptNo: 1,
      attemptTimestamp: new Date(),
      actionTaken: "RAZORPAY_API_RETRY",
      result: AttemptResult.FAILED,
      feeCharged: new Prisma.Decimal("2.00"),
    } as any);

    const logAuditSpy = vi.spyOn(auditLogger, "logAudit").mockResolvedValue({} as any);
    vi.spyOn(razorpay.orders, "create").mockResolvedValue({ id: "order_rzp_mock456" } as any);
    vi.spyOn(Math, "random").mockReturnValue(0.75); // 0.75 >= 0.65 (INSUFFICIENT_FUND rate) -> FAILED settlement

    const result = await executeDecision(
      "TXN_TEST_100",
      { action: "RETRY_SCHEDULED", reason: "Aligned with historical salary/debit pattern" },
      0,
      "CUST_001",
      "INSUFFICIENT_FUND"
    );

    expect(result.status).toBe(TxnStatus.PENDING);
    expect(result.retryAttempt?.result).toBe(AttemptResult.FAILED);

    expect(logAuditSpy).toHaveBeenCalledWith(
      "TXN_TEST_100",
      "EXECUTE_RETRY_SCHEDULED",
      expect.stringContaining("Order created successfully but settlement declined at bank-side — simulated, test-mode has no real mandate debit")
    );
  });
});

describe("executeDecision - Interactive Prisma Transactions", () => {
  const mockTxn = {
    txnId: "TXN_TX_1",
    customerId: "CUST_TX_1",
    amount: new Prisma.Decimal("2500.00"),
    failCode: "01",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should wrap RETRY_SCHEDULED DB writes inside prisma.$transaction with external Razorpay call beforehand", async () => {
    const callSequence: string[] = [];

    vi.spyOn(prisma.failedTransaction, "findUnique").mockImplementation(async () => {
      callSequence.push("prisma.failedTransaction.findUnique");
      return mockTxn as any;
    });

    vi.spyOn(razorpay.orders, "create").mockImplementation(async () => {
      callSequence.push("razorpay.orders.create");
      return { id: "order_tx_test" } as any;
    });

    const mockAttempt = {
      id: "att_tx_1",
      txnId: "TXN_TX_1",
      attemptNo: 1,
      attemptTimestamp: new Date(),
      actionTaken: "RAZORPAY_API_RETRY",
      result: AttemptResult.SUCCESS,
      feeCharged: new Prisma.Decimal("2.00"),
    };

    const mockTx = {
      retryAttempt: {
        create: vi.fn().mockImplementation(async () => {
          callSequence.push("tx.retryAttempt.create");
          return mockAttempt;
        }),
      },
      customerContext: {
        update: vi.fn().mockImplementation(async () => {
          callSequence.push("tx.customerContext.update");
          return {};
        }),
      },
      failedTransaction: {
        update: vi.fn().mockImplementation(async () => {
          callSequence.push("tx.failedTransaction.update");
          return {};
        }),
      },
    };

    const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      callSequence.push("prisma.$transaction_START");
      const res = await callback(mockTx);
      callSequence.push("prisma.$transaction_END");
      return res;
    });

    vi.spyOn(auditLogger, "logAudit").mockImplementation(async () => {
      callSequence.push("logAudit");
      return {} as any;
    });

    vi.spyOn(Math, "random").mockReturnValue(0.1); // Success

    const result = await executeDecision(
      "TXN_TX_1",
      { action: "RETRY_SCHEDULED", reason: "Salary window" },
      0,
      "CUST_TX_1",
      "INSUFFICIENT_FUND"
    );

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(mockTx.retryAttempt.create).toHaveBeenCalledTimes(1);
    expect(mockTx.customerContext.update).toHaveBeenCalledWith({
      where: { customerId: "CUST_TX_1" },
      data: { contactCountThisWeek: { increment: 1 } },
    });
    expect(mockTx.failedTransaction.update).toHaveBeenCalledWith({
      where: { txnId: "TXN_TX_1" },
      data: { status: TxnStatus.RESOLVED_RECOVERED },
    });
    expect(result.retryAttempt).toEqual(mockAttempt);

    // Verify order of calls: Razorpay call occurs OUTSIDE and BEFORE prisma.$transaction
    expect(callSequence).toEqual([
      "prisma.failedTransaction.findUnique",
      "razorpay.orders.create",
      "prisma.$transaction_START",
      "tx.retryAttempt.create",
      "tx.customerContext.update",
      "tx.failedTransaction.update",
      "logAudit",
      "prisma.$transaction_END",
    ]);
  });

  it("should wrap non-retry branches (RESOLVED_UNRECOVERABLE, MARKED_DEAD, ESCALATED, SKIPPED) in prisma.$transaction", async () => {
    const mockTx = {
      failedTransaction: {
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });
    const logAuditSpy = vi.spyOn(auditLogger, "logAudit").mockResolvedValue({} as any);

    // Test RESOLVED_UNRECOVERABLE
    await executeDecision("TXN_1", { action: "RESOLVED_UNRECOVERABLE", reason: "Mandate expired" }, 0, "CUST_1");
    expect(transactionSpy).toHaveBeenCalled();
    expect(mockTx.failedTransaction.update).toHaveBeenCalledWith({
      where: { txnId: "TXN_1" },
      data: { status: TxnStatus.RESOLVED_UNRECOVERABLE },
    });
    expect(logAuditSpy).toHaveBeenCalledWith("TXN_1", "EXECUTE_RESOLVED_UNRECOVERABLE", expect.stringContaining("Mandate expired"));

    // Test MARKED_DEAD
    transactionSpy.mockClear();
    mockTx.failedTransaction.update.mockClear();
    await executeDecision("TXN_2", { action: "MARKED_DEAD", reason: "Max attempts reached" }, 3, "CUST_1");
    expect(transactionSpy).toHaveBeenCalled();
    expect(mockTx.failedTransaction.update).toHaveBeenCalledWith({
      where: { txnId: "TXN_2" },
      data: { status: TxnStatus.DEAD },
    });

    // Test ESCALATED
    transactionSpy.mockClear();
    mockTx.failedTransaction.update.mockClear();
    await executeDecision("TXN_3", { action: "ESCALATED", reason: "Unknown failCode" }, 0, "CUST_1");
    expect(transactionSpy).toHaveBeenCalled();
    expect(mockTx.failedTransaction.update).toHaveBeenCalledWith({
      where: { txnId: "TXN_3" },
      data: { status: TxnStatus.ESCALATED },
    });

    // Test SKIPPED_TOO_SOON
    transactionSpy.mockClear();
    mockTx.failedTransaction.update.mockClear();
    await executeDecision("TXN_4", { action: "SKIPPED_TOO_SOON", reason: "Under min retry gap" }, 1, "CUST_1");
    expect(transactionSpy).toHaveBeenCalled();
    expect(mockTx.failedTransaction.update).toHaveBeenCalledWith({
      where: { txnId: "TXN_4" },
      data: { status: TxnStatus.PENDING },
    });

    // Test default / unknown action
    transactionSpy.mockClear();
    mockTx.failedTransaction.update.mockClear();
    await executeDecision("TXN_5", { action: "SOMETHING_WEIRD", reason: "Unhandled" }, 0, "CUST_1");
    expect(transactionSpy).toHaveBeenCalled();
    expect(mockTx.failedTransaction.update).toHaveBeenCalledWith({
      where: { txnId: "TXN_5" },
      data: { status: TxnStatus.ESCALATED },
    });
  });
});

