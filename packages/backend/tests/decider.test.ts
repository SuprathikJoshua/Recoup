import { describe, it, expect } from "vitest";
import { classify } from "../src/classifier/classify.js";
import { decide } from "../src/decider/decide.js";
import { Prisma, AttemptResult } from "../src/generated/prisma/client.js";

describe("Decider Engine & Failure Classification Tests", () => {
  const fixedNow = new Date("2026-08-24T10:00:00.000Z");

  const baseCustomer = {
    customerId: "CUST_0001",
    debitPatternDays: [1, 2, 3],
    pastSuccessTxnDates: [new Date("2026-07-01"), new Date("2026-06-01")],
    contactCountThisWeek: 0,
    mandateExpiryDate: new Date("2027-12-31"),
  };

  // Test 1: Hard failure / Mandate Expired deterministically returns unrecoverable without retry
  it("should deterministically return an unrecoverable status without scheduling a retry for MANDATE_EXPIRED failure", () => {
    const classification = classify({ failCode: "MD" });
    expect(classification.bucket).toBe("MANDATE_EXPIRED");
    expect(classification.confidence).toBeGreaterThanOrEqual(0.70);

    const result = decide({
      bucket: classification.bucket,
      confidence: classification.confidence,
      customer: baseCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(1000),
      now: fixedNow,
    });

    expect(result.action).toBe("RESOLVED_UNRECOVERABLE");
    expect(result.scheduledFor).toBeUndefined();
    expect(result.reason).toContain("Hard failure bucket");
  });

  // Test 2: INSUFFICIENT_FUNDS schedules a retry if guard-rails pass
  it("should schedule a retry aligned with debit patterns for INSUFFICIENT_FUNDS when guard-rails pass", () => {
    const classification = classify({ failCode: "01" });
    expect(classification.bucket).toBe("INSUFFICIENT_FUND");
    expect(classification.confidence).toBeGreaterThanOrEqual(0.70);

    const result = decide({
      bucket: classification.bucket,
      confidence: classification.confidence,
      customer: baseCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(2500),
      now: fixedNow,
    });

    expect(result.action).toBe("RETRY_SCHEDULED");
    expect(result.scheduledFor).toBeDefined();
    expect(result.reason).toContain("historical salary/debit pattern");
  });

  // Test 3: Weekly contact cap blocks retry execution
  it("should block retry with SKIPPED_CONTACT_CAP when contactCountThisWeek reaches or exceeds the cap", () => {
    const saturatedCustomer = {
      ...baseCustomer,
      contactCountThisWeek: 2, // MAX_CONTACTS_PER_WEEK is 2
    };

    const classification = classify({ failCode: "01" });

    const result = decide({
      bucket: classification.bucket,
      confidence: classification.confidence,
      customer: saturatedCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(1500),
      now: fixedNow,
    });

    expect(result.action).toBe("SKIPPED_CONTACT_CAP");
    expect(result.scheduledFor).toBeUndefined();
    expect(result.reason).toBe("Weekly customer contact cap reached");
  });

  // Test 4: RBI Attempt Cap enforcement (>= 3 attempts -> MARKED_DEAD)
  it("should enforce RBI statutory cap and mark transaction DEAD after 3 failed attempts", () => {
    const priorAttempts = [
      { id: "1", txnId: "TXN_1", attemptNo: 1, attemptTimestamp: new Date("2026-08-01"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(0) },
      { id: "2", txnId: "TXN_1", attemptNo: 2, attemptTimestamp: new Date("2026-08-08"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(25) },
      { id: "3", txnId: "TXN_1", attemptNo: 3, attemptTimestamp: new Date("2026-08-15"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(25) },
    ];

    const result = decide({
      bucket: "INSUFFICIENT_FUND",
      confidence: 0.95,
      customer: baseCustomer,
      existingAttempts: priorAttempts,
      transactionAmount: new Prisma.Decimal(1000),
      now: fixedNow,
    });

    expect(result.action).toBe("MARKED_DEAD");
    expect(result.reason).toBe("Exceeded RBI attempt cap");
  });

  // Test 5: Minimum gap between retries (< 5 days -> SKIPPED_TOO_SOON)
  it("should prevent retrying too soon when the last attempt was within 5 days", () => {
    const recentAttempts = [
      { id: "1", txnId: "TXN_2", attemptNo: 1, attemptTimestamp: new Date("2026-08-22T10:00:00.000Z"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(0) },
    ];

    const result = decide({
      bucket: "INSUFFICIENT_FUND",
      confidence: 0.95,
      customer: baseCustomer,
      existingAttempts: recentAttempts,
      transactionAmount: new Prisma.Decimal(1000),
      now: fixedNow,
    });

    expect(result.action).toBe("SKIPPED_TOO_SOON");
    expect(result.reason).toBe("Minimum gap between retries not met");
  });

  // Test 6: Fee-to-Recovery ratio exceeded (> 50% -> MARKED_DEAD)
  it("should mark transaction DEAD when cumulative fees exceed 50% of recoverable amount", () => {
    const highFeeAttempts = [
      { id: "1", txnId: "TXN_3", attemptNo: 1, attemptTimestamp: new Date("2026-08-10"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(60) },
    ];

    const result = decide({
      bucket: "INSUFFICIENT_FUND",
      confidence: 0.95,
      customer: baseCustomer,
      existingAttempts: highFeeAttempts,
      transactionAmount: new Prisma.Decimal(100), // Fee is 60 / 100 = 60% > 50%
      now: fixedNow,
    });

    expect(result.action).toBe("MARKED_DEAD");
    expect(result.reason).toBe("Exceeded fee-to-recovery ratio");
  });

  // Test 7: Unrecognized failure codes escalate for human review
  it("should escalate unknown failure codes for operational review", () => {
    const classification = classify({ failCode: "UNKNOWN_999" });
    expect(classification.bucket).toBe("UNKNOWN");

    const result = decide({
      bucket: classification.bucket,
      confidence: classification.confidence,
      customer: baseCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(500),
      now: fixedNow,
    });

    expect(result.action).toBe("ESCALATED");
    expect(result.reason).toBe("Unrecognized failure code, needs human review");
  });

  // Test 8: Transient bank error triggers fast retry (3 hours)
  it("should schedule a fast retry (+3 hours) for transient bank errors", () => {
    const classification = classify({ failCode: "BE" });
    expect(classification.bucket).toBe("BANK_ERROR");

    const result = decide({
      bucket: classification.bucket,
      confidence: classification.confidence,
      customer: baseCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(1200),
      now: fixedNow,
    });

    expect(result.action).toBe("RETRY_SCHEDULED");
    expect(result.reason).toBe("Transient bank error, fast retry");
    const expectedTime = new Date(fixedNow.getTime() + 3 * 60 * 60 * 1000);
    expect(result.scheduledFor?.toISOString()).toBe(expectedTime.toISOString());
  });
});
