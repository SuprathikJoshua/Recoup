import { describe, it, expect, vi, beforeEach } from "vitest";
import { corroborate } from "../src/classifier/corroborate.js";
import { classify } from "../src/classifier/classify.js";
import { processTransaction } from "../src/engine/processTransaction.js";
import { prisma } from "../src/config/db.js";
import * as retryExecutor from "../src/executor/retryExecutor.js";
import { AttemptResult, PaymentMode, TxnStatus, Prisma } from "../src/generated/prisma/client.js";

describe("Classifier Second Reasoning Pass (corroborate.ts)", () => {
  const fixedNow = new Date("2026-08-24T10:00:00.000Z");

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
  });

  const baseCustomer = {
    customerId: "CUST_CORROB_1",
    debitPatternDays: [1, 5, 10],
    pastSuccessTxnDates: [
      new Date("2026-08-01"), // ~23 days ago
      new Date("2026-07-15"), // ~40 days ago
      new Date("2026-07-01"), // ~54 days ago (all 3 within 2 months)
    ],
    contactCountThisWeek: 0,
    mandateExpiryDate: new Date("2027-12-31"),
  };

  // Test 1: INSUFFICIENT_FUND trigger condition
  it("should reduce confidence by 0.15 for INSUFFICIENT_FUND when customer has strong recent success history and 0 prior failed attempts", () => {
    const classification = {
      bucket: "INSUFFICIENT_FUND",
      confidence: 0.95,
      adjustmentReason: "Frequent prior successes (>=3, +0.03)",
    };

    const result = corroborate(classification, baseCustomer, [], "01", fixedNow);

    expect(result.bucket).toBe("INSUFFICIENT_FUND");
    expect(result.confidence).toBe(0.80); // 0.95 - 0.15 = 0.80
    expect(result.adjustmentReason).toContain("-0.15 confidence");
  });

  // Test 2: INSUFFICIENT_FUND counter-check (prior failed attempt prevents reduction)
  it("should NOT reduce confidence for INSUFFICIENT_FUND if there is already a prior FAILED attempt on this txn", () => {
    const classification = {
      bucket: "INSUFFICIENT_FUND",
      confidence: 0.95,
    };

    const priorFailed = [
      {
        id: "att_1",
        txnId: "TXN_1",
        attemptNo: 1,
        attemptTimestamp: new Date("2026-08-10"),
        actionTaken: "RETRY",
        result: AttemptResult.FAILED,
        feeCharged: new Prisma.Decimal(25),
      },
    ];

    const result = corroborate(classification, baseCustomer, priorFailed, "01", fixedNow);

    expect(result.confidence).toBe(0.95); // unchanged
  });

  // Test 3: INSUFFICIENT_FUND counter-check (recent successes < 3 within last 2 months prevents reduction)
  it("should NOT reduce confidence for INSUFFICIENT_FUND if fewer than 3 successes occurred within last 2 months", () => {
    const customerWithOldDates = {
      ...baseCustomer,
      pastSuccessTxnDates: [
        new Date("2026-08-01"), // 1 within 2 months
        new Date("2026-05-01"), // > 3 months ago
        new Date("2026-04-01"), // > 4 months ago
      ],
    };

    const classification = {
      bucket: "INSUFFICIENT_FUND",
      confidence: 0.95,
    };

    const result = corroborate(classification, customerWithOldDates, [], "01", fixedNow);

    expect(result.confidence).toBe(0.95); // unchanged
  });

  // Test 4: BANK_ERROR trigger condition (2+ prior FAILED attempts with same failCode)
  it("should reduce confidence by 0.10 for BANK_ERROR when there are already 2+ prior FAILED attempts with the same failCode", () => {
    const classification = {
      bucket: "BANK_ERROR",
      confidence: 0.85,
    };

    const bankErrorAttempts = [
      {
        id: "att_1",
        txnId: "TXN_BE_1",
        attemptNo: 1,
        attemptTimestamp: new Date("2026-08-10"),
        actionTaken: "RETRY",
        result: AttemptResult.FAILED,
        feeCharged: new Prisma.Decimal(0),
        failCode: "BE",
      },
      {
        id: "att_2",
        txnId: "TXN_BE_1",
        attemptNo: 2,
        attemptTimestamp: new Date("2026-08-18"),
        actionTaken: "RETRY",
        result: AttemptResult.FAILED,
        feeCharged: new Prisma.Decimal(0),
        failCode: "BE",
      },
    ];

    const result = corroborate(classification, baseCustomer, bankErrorAttempts as any, "BE", fixedNow);

    expect(result.bucket).toBe("BANK_ERROR");
    expect(result.confidence).toBe(0.75); // 0.85 - 0.10 = 0.75
    expect(result.adjustmentReason).toContain("-0.10 confidence");
  });

  // Test 5: BANK_ERROR counter-check (only 1 prior failed attempt does NOT trigger)
  it("should NOT reduce confidence for BANK_ERROR if fewer than 2 prior FAILED attempts exist", () => {
    const classification = {
      bucket: "BANK_ERROR",
      confidence: 0.85,
    };

    const singleFailedAttempt = [
      {
        id: "att_1",
        txnId: "TXN_BE_2",
        attemptNo: 1,
        attemptTimestamp: new Date("2026-08-10"),
        actionTaken: "RETRY",
        result: AttemptResult.FAILED,
        feeCharged: new Prisma.Decimal(0),
        failCode: "BE",
      },
    ];

    const result = corroborate(classification, baseCustomer, singleFailedAttempt as any, "BE", fixedNow);

    expect(result.confidence).toBe(0.85); // unchanged
  });

  // Test 6: General pass-through cases
  it("should pass through unchanged for buckets like MANDATE_EXPIRED or UNKNOWN", () => {
    const mdClassification = classify({ failCode: "MD" });
    const mdResult = corroborate(mdClassification, baseCustomer, [], "MD", fixedNow);
    expect(mdResult.confidence).toBe(mdClassification.confidence);
    expect(mdResult.bucket).toBe("MANDATE_EXPIRED");

    const unknownClassification = classify({ failCode: "XYZ_CUSTOM" });
    const unknownResult = corroborate(unknownClassification, baseCustomer, [], "XYZ_CUSTOM", fixedNow);
    expect(unknownResult.confidence).toBe(unknownClassification.confidence);
    expect(unknownResult.bucket).toBe("UNKNOWN");
  });

  // Test 7: Integration with processTransaction: CORROBORATE audit log recorded only when confidence changes
  it("should record a CORROBORATE audit log in processTransaction only when confidence is adjusted", async () => {
    const sampleTxn = {
      id: "cuid_corrob_1",
      txnId: "TXN_CORROB_AUDIT_1",
      customerId: "CUST_CORROB_1",
      merchantId: "MERCH_TEST",
      paymentMode: PaymentMode.UPI_AUTOPAY,
      amount: new Prisma.Decimal("1000.00"),
      failTimestamp: fixedNow,
      failCode: "01",
      trueReason: "INSUFFICIENT_FUND",
      isRecoverable: true,
      status: TxnStatus.PENDING,
      createdAt: fixedNow,
    };

    vi.spyOn(prisma.customerContext, "findUnique").mockResolvedValue(baseCustomer as any);
    vi.spyOn(prisma.customerContext, "update").mockResolvedValue(baseCustomer as any);
    vi.spyOn(prisma.retryAttempt, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.retryAttempt, "create").mockResolvedValue({
      id: "att_1",
      txnId: "TXN_CORROB_AUDIT_1",
      attemptNo: 1,
      attemptTimestamp: fixedNow,
      actionTaken: "RAZORPAY_API_RETRY",
      result: AttemptResult.SUCCESS,
      feeCharged: new Prisma.Decimal(2),
    } as any);
    vi.spyOn(prisma.failedTransaction, "findUnique").mockResolvedValue(sampleTxn as any);
    vi.spyOn(prisma.failedTransaction, "update").mockResolvedValue(sampleTxn as any);

    const loggedEvents: { decisionType: string; reasonText: string; score?: number | null }[] = [];
    vi.spyOn(prisma.auditLog, "create").mockImplementation((async ({ data }: any) => {
      loggedEvents.push({ decisionType: data.decisionType, reasonText: data.reasonText, score: data.confidenceScore });
      return { id: `log_${loggedEvents.length}`, ...data } as any;
    }) as any);
    vi.spyOn(prisma.auditLog, "findMany").mockImplementation((async () => loggedEvents as any) as any);
    vi.spyOn(retryExecutor.razorpay.orders, "create").mockResolvedValue({ id: "order_mock" } as any);

    const result = await processTransaction(sampleTxn as any);

    // In this scenario, customer has 3 recent successes and 0 prior attempts on '01'
    // So corroborate() reduces confidence by 0.15
    const corroborateLog = loggedEvents.find((l) => l.decisionType === "CORROBORATE");
    expect(corroborateLog).toBeDefined();
    expect(corroborateLog?.reasonText).toContain("Corroborated classification against customer history");
    expect(result.classification.confidence).toBeLessThan(0.95);
  });

  // Test 8: Integration with processTransaction: CORROBORATE audit log is SKIPPED when confidence is unchanged
  it("should SKIP recording a CORROBORATE audit log in processTransaction when confidence is unchanged (pass-through)", async () => {
    const mdTxn = {
      id: "cuid_corrob_2",
      txnId: "TXN_CORROB_AUDIT_2",
      customerId: "CUST_CORROB_1",
      merchantId: "MERCH_TEST",
      paymentMode: PaymentMode.UPI_AUTOPAY,
      amount: new Prisma.Decimal("1000.00"),
      failTimestamp: fixedNow,
      failCode: "MD", // MANDATE_EXPIRED -> pass-through
      trueReason: "MANDATE_EXPIRED",
      isRecoverable: false,
      status: TxnStatus.PENDING,
      createdAt: fixedNow,
    };

    vi.spyOn(prisma.customerContext, "findUnique").mockResolvedValue(baseCustomer as any);
    vi.spyOn(prisma.retryAttempt, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.failedTransaction, "findUnique").mockResolvedValue(mdTxn as any);
    vi.spyOn(prisma.failedTransaction, "update").mockResolvedValue(mdTxn as any);

    const loggedEvents: { decisionType: string; reasonText: string; score?: number | null }[] = [];
    vi.spyOn(prisma.auditLog, "create").mockImplementation((async ({ data }: any) => {
      loggedEvents.push({ decisionType: data.decisionType, reasonText: data.reasonText, score: data.confidenceScore });
      return { id: `log_${loggedEvents.length}`, ...data } as any;
    }) as any);
    vi.spyOn(prisma.auditLog, "findMany").mockImplementation((async () => loggedEvents as any) as any);

    await processTransaction(mdTxn as any);

    const corroborateLog = loggedEvents.find((l) => l.decisionType === "CORROBORATE");
    expect(corroborateLog).toBeUndefined(); // skipped to avoid audit-log noise!
  });
});
