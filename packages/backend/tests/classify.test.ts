import { describe, it, expect } from "vitest";
import { classify } from "../src/classifier/classify.js";

describe("Multi-Factor Failure Classifier Tests", () => {
  // Test 1: INSUFFICIENT_FUND with pastSuccessTxnCount >= 3 -> +0.03 boost
  it("should boost confidence by +0.03 for INSUFFICIENT_FUND when customer has >= 3 past successful transactions", () => {
    const baseResult = classify({ failCode: "01" });
    expect(baseResult.bucket).toBe("INSUFFICIENT_FUND");
    expect(baseResult.confidence).toBe(0.95);
    expect(baseResult.adjustmentReason).toBeUndefined();

    const boostedResult = classify({
      failCode: "01",
      pastSuccessTxnCount: 3,
    });
    expect(boostedResult.bucket).toBe("INSUFFICIENT_FUND");
    expect(boostedResult.confidence).toBe(0.98);
    expect(boostedResult.adjustmentReason).toBeDefined();
    expect(boostedResult.adjustmentReason).toContain("+0.03");

    // Also verify for pastSuccessTxnCount > 3
    const higherCountResult = classify({
      failCode: "01",
      pastSuccessTxnCount: 10,
    });
    expect(higherCountResult.confidence).toBe(0.98);
  });

  // Test 2: MANDATE_EXPIRED with daysToMandateExpiry < -30 -> +0.03 boost (clearly expired)
  it("should boost confidence by +0.03 for MANDATE_EXPIRED when mandate expired over 30 days ago (< -30)", () => {
    const result = classify({
      failCode: "MD",
      daysToMandateExpiry: -45,
    });
    expect(result.bucket).toBe("MANDATE_EXPIRED");
    expect(result.confidence).toBe(0.98);
    expect(result.adjustmentReason).toBeDefined();
    expect(result.adjustmentReason).toContain("+0.03");
  });

  // Test 3: MANDATE_EXPIRED with daysToMandateExpiry in [-5, 0] -> -0.05 penalty (ambiguous/barely expired)
  it("should penalize confidence by -0.05 for MANDATE_EXPIRED when mandate expired within 0 to 5 days ago ([-5, 0])", () => {
    // Test boundary: -5 days
    const resultAtMinus5 = classify({
      failCode: "MD",
      daysToMandateExpiry: -5,
    });
    expect(resultAtMinus5.bucket).toBe("MANDATE_EXPIRED");
    expect(resultAtMinus5.confidence).toBe(0.90);
    expect(resultAtMinus5.adjustmentReason).toBeDefined();
    expect(resultAtMinus5.adjustmentReason).toContain("-0.05");

    // Test midpoint: -2 days
    const resultAtMinus2 = classify({
      failCode: "MD",
      daysToMandateExpiry: -2,
    });
    expect(resultAtMinus2.confidence).toBe(0.90);

    // Test boundary: 0 days
    const resultAt0 = classify({
      failCode: "MD",
      daysToMandateExpiry: 0,
    });
    expect(resultAt0.confidence).toBe(0.90);
  });

  // Test 4: No adjustment cases -> confidence remains unchanged from base table
  it("should leave confidence unchanged when no adjustment rules match", () => {
    // 01 with < 3 past successes
    const resUnderThreshold = classify({
      failCode: "01",
      pastSuccessTxnCount: 2,
    });
    expect(resUnderThreshold.confidence).toBe(0.95);
    expect(resUnderThreshold.adjustmentReason).toBeUndefined();

    // MD with daysToMandateExpiry between -30 and -6 (neither clearly expired nor barely expired)
    const resMdNormal = classify({
      failCode: "MD",
      daysToMandateExpiry: -15,
    });
    expect(resMdNormal.confidence).toBe(0.95);
    expect(resMdNormal.adjustmentReason).toBeUndefined();

    // MD with future expiry (positive days)
    const resMdFuture = classify({
      failCode: "MD",
      daysToMandateExpiry: 20,
    });
    expect(resMdFuture.confidence).toBe(0.95);
    expect(resMdFuture.adjustmentReason).toBeUndefined();

    // Other failure codes (e.g. BANK_ERROR, FRAUD_BLOCK, WRONG_ACCOUNT)
    const resBank = classify({
      failCode: "BE",
      pastSuccessTxnCount: 5,
      daysToMandateExpiry: -40,
    });
    expect(resBank.bucket).toBe("BANK_ERROR");
    expect(resBank.confidence).toBe(0.85);
    expect(resBank.adjustmentReason).toBeUndefined();

    // UNKNOWN failure code
    const resUnknown = classify({ failCode: "XYZ_INVALID" });
    expect(resUnknown.bucket).toBe("UNKNOWN");
    expect(resUnknown.confidence).toBe(0.30);
    expect(resUnknown.adjustmentReason).toBeUndefined();
  });

  // Test 5: Clamping behavior at both ends [0.10, 0.98]
  it("should enforce clamping so confidence never exceeds 0.98 and never falls below 0.10", () => {
    // Maximum clamp (0.98 cap)
    const boosted = classify({
      failCode: "01",
      pastSuccessTxnCount: 10,
    });
    expect(boosted.confidence).toBeLessThanOrEqual(0.98);
    expect(boosted.confidence).toBe(0.98);

    // Minimum clamp: even with any low base score or reductions, minimum is 0.10
    const unknownCode = classify({ failCode: "UNKNOWN_ERR" });
    expect(unknownCode.confidence).toBeGreaterThanOrEqual(0.10);
  });
});
