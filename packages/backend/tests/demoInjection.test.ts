import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { apiRoutes } from "../src/api/routes.js";
import { processTransaction } from "../src/engine/processTransaction.js";
import { prisma } from "../src/config/db.js";
import * as auditLogger from "../src/audit/auditLogger.js";
import * as retryExecutor from "../src/executor/retryExecutor.js";
import {
  AttemptResult,
  TxnStatus,
  PaymentMode,
  Prisma,
} from "../src/generated/prisma/client.js";

describe("Live Demo Injection & Shared processTransaction Engine Tests", () => {
  const baseCustomer = {
    customerId: "CUST_DEMO_01",
    debitPatternDays: [1, 2, 3],
    pastSuccessTxnDates: [new Date("2026-08-01"), new Date("2026-07-01"), new Date("2026-06-01")],
    contactCountThisWeek: 0,
    mandateExpiryDate: new Date("2028-12-31"),
  };

  const sampleTxn = {
    id: "cuid_123",
    txnId: "TXN_TEST_DEMO_1",
    customerId: "CUST_DEMO_01",
    merchantId: "MERCH_TEST",
    paymentMode: PaymentMode.UPI_AUTOPAY,
    amount: new Prisma.Decimal("1200.00"),
    failTimestamp: new Date("2026-09-04T10:00:00Z"),
    failCode: "01",
    trueReason: "INSUFFICIENT_FUND",
    isRecoverable: true,
    status: TxnStatus.PENDING,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
  });

  it("should process a transaction end-to-end and return complete lifecycle result", async () => {
    vi.spyOn(prisma.customerContext, "findUnique").mockResolvedValue(baseCustomer as any);
    vi.spyOn(prisma.customerContext, "update").mockResolvedValue(baseCustomer as any);
    vi.spyOn(prisma.retryAttempt, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.retryAttempt, "create").mockResolvedValue({
      id: "att_1",
      txnId: "TXN_TEST_DEMO_1",
      attemptNo: 1,
      attemptTimestamp: new Date(),
      actionTaken: "RAZORPAY_API_RETRY",
      result: AttemptResult.SUCCESS,
      feeCharged: new Prisma.Decimal("2.00"),
    } as any);

    vi.spyOn(prisma.failedTransaction, "findUnique").mockResolvedValue(sampleTxn as any);
    vi.spyOn(prisma.failedTransaction, "update").mockResolvedValue({
      ...sampleTxn,
      status: TxnStatus.RESOLVED_RECOVERED,
    } as any);

    const mockAuditLogs = [
      { id: "log_1", txnId: "TXN_TEST_DEMO_1", decisionType: "CLASSIFY", reasonText: "Classified '01' into 'INSUFFICIENT_FUND'", confidenceScore: 0.98, timestamp: new Date() },
      { id: "log_2", txnId: "TXN_TEST_DEMO_1", decisionType: "ACTION_DECIDE", reasonText: "Decision: RETRY_SCHEDULED", confidenceScore: 0.98, timestamp: new Date() },
      { id: "log_3", txnId: "TXN_TEST_DEMO_1", decisionType: "EXECUTE_RETRY_SCHEDULED", reasonText: "Executed retry attempt #1", confidenceScore: null, timestamp: new Date() },
    ];
    vi.spyOn(prisma.auditLog, "create").mockResolvedValue(mockAuditLogs[0] as any);
    vi.spyOn(prisma.auditLog, "findMany").mockResolvedValue(mockAuditLogs as any);

    // Mock Razorpay order creation to succeed
    vi.spyOn(retryExecutor.razorpay.orders, "create").mockResolvedValue({ id: "order_mock_999" } as any);
    vi.spyOn(Math, "random").mockReturnValue(0.10); // deterministic success in settlement layer

    const result = await processTransaction(sampleTxn as any);

    expect(result.classification.bucket).toBe("INSUFFICIENT_FUND");
    expect(result.decision.action).toBe("RETRY_SCHEDULED");
    expect(result.executionResult.status).toBe(TxnStatus.RESOLVED_RECOVERED);
    expect(result.auditLogs.length).toBe(3);
    expect(result.customer.customerId).toBe("CUST_DEMO_01");
  });

  it("should process unknown codes through escalation guard-rail", async () => {
    const unknownTxn = {
      ...sampleTxn,
      txnId: "TXN_TEST_UNKNOWN_1",
      failCode: "ZZ",
      trueReason: "UNKNOWN",
      isRecoverable: null,
    };

    vi.spyOn(prisma.customerContext, "findUnique").mockResolvedValue(baseCustomer as any);
    vi.spyOn(prisma.retryAttempt, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.failedTransaction, "findUnique").mockResolvedValue(unknownTxn as any);
    vi.spyOn(prisma.failedTransaction, "update").mockResolvedValue({
      ...unknownTxn,
      status: TxnStatus.ESCALATED,
    } as any);

    const mockLogs = [
      { id: "log_1", txnId: "TXN_TEST_UNKNOWN_1", decisionType: "CLASSIFY", reasonText: "Classified 'ZZ' into 'UNKNOWN'", confidenceScore: 0.30, timestamp: new Date() },
      { id: "log_2", txnId: "TXN_TEST_UNKNOWN_1", decisionType: "ACTION_DECIDE", reasonText: "Decision: ESCALATED", confidenceScore: 0.30, timestamp: new Date() },
      { id: "log_3", txnId: "TXN_TEST_UNKNOWN_1", decisionType: "EXECUTE_ESCALATED", reasonText: "Escalated to human review", confidenceScore: null, timestamp: new Date() },
    ];
    vi.spyOn(prisma.auditLog, "create").mockResolvedValue(mockLogs[0] as any);
    vi.spyOn(prisma.auditLog, "findMany").mockResolvedValue(mockLogs as any);

    const result = await processTransaction(unknownTxn as any);

    expect(result.classification.bucket).toBe("UNKNOWN");
    expect(result.decision.action).toBe("ESCALATED");
    expect(result.executionResult.status).toBe(TxnStatus.ESCALATED);
  });

  it("should handle POST /api/demo/inject-failure with explicit failCode", async () => {
    const app = Fastify();
    await app.register(apiRoutes);

    vi.spyOn(prisma.customerContext, "findMany").mockResolvedValue([{ customerId: "CUST_DEMO_01" }] as any);
    vi.spyOn(prisma.customerContext, "findUnique").mockResolvedValue(baseCustomer as any);
    vi.spyOn(prisma.failedTransaction, "create").mockImplementation((async ({ data }: any) => ({
      ...data,
      id: "demo_id_1",
      createdAt: new Date(),
    })) as any);
    vi.spyOn(prisma.failedTransaction, "findUnique").mockImplementation((async () => sampleTxn as any) as any);
    vi.spyOn(prisma.failedTransaction, "update").mockResolvedValue({ ...sampleTxn, status: TxnStatus.ESCALATED } as any);
    vi.spyOn(prisma.retryAttempt, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.auditLog, "create").mockResolvedValue({} as any);
    vi.spyOn(prisma.auditLog, "findMany").mockResolvedValue([
      { id: "log_1", txnId: "TXN_DEMO_LIVE", decisionType: "CLASSIFY", reasonText: "Classified 'MD' into 'MANDATE_EXPIRED'", confidenceScore: 0.95, timestamp: new Date() },
      { id: "log_2", txnId: "TXN_DEMO_LIVE", decisionType: "ACTION_DECIDE", reasonText: "Decision: RESOLVED_UNRECOVERABLE", confidenceScore: 0.95, timestamp: new Date() },
    ] as any);

    const response = await app.inject({
      method: "POST",
      url: "/api/demo/inject-failure",
      payload: { failCode: "MD" },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.result.classification.bucket).toBe("MANDATE_EXPIRED");
    expect(body.result.decision.action).toBe("RESOLVED_UNRECOVERABLE");
  });
});
