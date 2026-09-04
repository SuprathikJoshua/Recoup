import { describe, it, expect } from "vitest";
import { classify } from "../src/classifier/classify.js";
import { decide } from "../src/decider/decide.js";
import { Prisma, AttemptResult, PaymentMode } from "../src/generated/prisma/client.js";

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
      paymentMode: PaymentMode.UPI_AUTOPAY,
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
      paymentMode: PaymentMode.UPI_AUTOPAY,
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
      paymentMode: PaymentMode.UPI_AUTOPAY,
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
      paymentMode: PaymentMode.UPI_AUTOPAY,
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
      paymentMode: PaymentMode.UPI_AUTOPAY,
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
      paymentMode: PaymentMode.UPI_AUTOPAY,
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
      paymentMode: PaymentMode.UPI_AUTOPAY,
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

  // Test 8: Transient bank error triggers fast retry (3 hours) for UPI_AUTOPAY
  it("should schedule a fast retry (+3 hours) for transient bank errors on UPI_AUTOPAY", () => {
    const classification = classify({ failCode: "BE" });
    expect(classification.bucket).toBe("BANK_ERROR");

    const result = decide({
      paymentMode: PaymentMode.UPI_AUTOPAY,
      bucket: classification.bucket,
      confidence: classification.confidence,
      customer: baseCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(1200),
      now: fixedNow,
    });

    expect(result.action).toBe("RETRY_SCHEDULED");
    expect(result.reason).toContain("Transient bank error, fast retry");
    expect(result.reason).toContain("UPI_AUTOPAY");
    const expectedTime = new Date(fixedNow.getTime() + 3 * 60 * 60 * 1000);
    expect(result.scheduledFor?.toISOString()).toBe(expectedTime.toISOString());
  });

  // Test 9: NACH T+2 Settlement Grace Period minimum-gap enforcement
  it("should enforce at least 2 days minimum gap for NACH INSUFFICIENT_FUND even if debit pattern is sooner", () => {
    // Tomorrow is Aug 25 (only 1 day away from Aug 24)
    const nextDayCustomer = {
      ...baseCustomer,
      debitPatternDays: [25], // only 1 day out
    };

    // 1. UPI_AUTOPAY would happily debit tomorrow (1 day out)
    const upiResult = decide({
      paymentMode: PaymentMode.UPI_AUTOPAY,
      bucket: "INSUFFICIENT_FUND",
      confidence: 0.95,
      customer: nextDayCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(1500),
      now: fixedNow,
    });
    expect(upiResult.action).toBe("RETRY_SCHEDULED");
    const upiDiffDays = (upiResult.scheduledFor!.getTime() - fixedNow.getTime()) / (1000 * 60 * 60 * 24);
    expect(upiDiffDays).toBeLessThan(2);

    // 2. NACH must enforce at least 2 days out minimum (legal T+2 settlement grace period)
    const nachResult = decide({
      paymentMode: PaymentMode.NACH,
      bucket: "INSUFFICIENT_FUND",
      confidence: 0.95,
      customer: nextDayCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(1500),
      now: fixedNow,
    });
    expect(nachResult.action).toBe("RETRY_SCHEDULED");
    expect(nachResult.scheduledFor).toBeDefined();
    const nachDiffDays = (nachResult.scheduledFor!.getTime() - fixedNow.getTime()) / (1000 * 60 * 60 * 24);
    expect(nachDiffDays).toBeGreaterThanOrEqual(2);
    expect(nachResult.reason).toContain("NACH legal T+2 settlement grace period applied");
  });

  // Test 10: BANK_ERROR timing split across payment rails (UPI +3h vs NACH/EMANDATE +12h)
  it("should apply +3h retry for UPI_AUTOPAY and +12h retry for NACH and EMANDATE on BANK_ERROR", () => {
    // UPI_AUTOPAY: fast retry (+3 hours)
    const upiResult = decide({
      paymentMode: PaymentMode.UPI_AUTOPAY,
      bucket: "BANK_ERROR",
      confidence: 0.85,
      customer: baseCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(2000),
      now: fixedNow,
    });
    expect(upiResult.action).toBe("RETRY_SCHEDULED");
    expect(upiResult.scheduledFor?.toISOString()).toBe(
      new Date(fixedNow.getTime() + 3 * 60 * 60 * 1000).toISOString()
    );
    expect(upiResult.reason).toContain("UPI_AUTOPAY: +3 hours");

    // NACH: slower recovery rail (+12 hours)
    const nachResult = decide({
      paymentMode: PaymentMode.NACH,
      bucket: "BANK_ERROR",
      confidence: 0.85,
      customer: baseCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(2000),
      now: fixedNow,
    });
    expect(nachResult.action).toBe("RETRY_SCHEDULED");
    expect(nachResult.scheduledFor?.toISOString()).toBe(
      new Date(fixedNow.getTime() + 12 * 60 * 60 * 1000).toISOString()
    );
    expect(nachResult.reason).toContain("NACH: +12 hours");

    // EMANDATE: slower recovery rail (+12 hours)
    const emandateResult = decide({
      paymentMode: PaymentMode.EMANDATE,
      bucket: "BANK_ERROR",
      confidence: 0.85,
      customer: baseCustomer,
      existingAttempts: [],
      transactionAmount: new Prisma.Decimal(2000),
      now: fixedNow,
    });
    expect(emandateResult.action).toBe("RETRY_SCHEDULED");
    expect(emandateResult.scheduledFor?.toISOString()).toBe(
      new Date(fixedNow.getTime() + 12 * 60 * 60 * 1000).toISOString()
    );
    expect(emandateResult.reason).toContain("EMANDATE: +12 hours");
  });
});
