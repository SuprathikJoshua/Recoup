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
