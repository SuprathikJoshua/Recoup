import type { CustomerContext, RetryAttempt } from "../generated/prisma/client.js";
import type { ClassifyResult } from "./classify.js";

/**
 * Second reasoning pass cross-checking the classifier's bucket guess against
 * customer payment history and historical attempt patterns.
 * 
 * Pure function with zero database or external side-effects.
 * 
 * @param classification Initial classification result with bucket, confidence, and adjustment reason
 * @param customer Customer profile including historical successful payment dates
 * @param existingAttempts Prior retry attempt records on this transaction
 * @param txnOrFailCode Optional failure code string or transaction object for matching identical error codes
 * @param now Reference timestamp for computing recent history windows (defaults to Date.now())
 * @returns Refined ClassifyResult with updated confidence and rationale, or unchanged if pass-through
 */
export function corroborate(
  classification: ClassifyResult,
  customer: CustomerContext,
  existingAttempts: RetryAttempt[] = [],
  txnOrFailCode?: string | { failCode?: string; failTimestamp?: Date | string },
  now?: Date
): ClassifyResult {
  const failCode =
    typeof txnOrFailCode === "string" ? txnOrFailCode : txnOrFailCode?.failCode;

  const referenceDate =
    now ||
    (typeof txnOrFailCode === "object" && txnOrFailCode?.failTimestamp
      ? new Date(txnOrFailCode.failTimestamp)
      : new Date());

  // 1. INSUFFICIENT_FUND check:
  // If bucket is INSUFFICIENT_FUND but customer has strong recent success history
  // (3+ pastSuccessTxnDates within last 2 months) AND no prior FAILED attempts on this txnId yet
  // -> reduce confidence by 0.15
  if (classification.bucket === "INSUFFICIENT_FUND") {
    // 2 calendar months or 60 days threshold
    const twoMonthsAgoDate = new Date(referenceDate);
    twoMonthsAgoDate.setMonth(twoMonthsAgoDate.getMonth() - 2);
    const twoMonthsAgoMs = Math.min(
      twoMonthsAgoDate.getTime(),
      referenceDate.getTime() - 60 * 24 * 60 * 60 * 1000
    );

    const recentSuccessCount = (customer.pastSuccessTxnDates || []).filter((d) => {
      const dt = new Date(d);
      return !isNaN(dt.getTime()) && dt.getTime() >= twoMonthsAgoMs && dt.getTime() <= referenceDate.getTime();
    }).length;

    const hasPriorFailedAttempts = existingAttempts.some(
      (att) => att.result === "FAILED"
    );

    if (recentSuccessCount >= 3 && !hasPriorFailedAttempts) {
      const newConfidence = Math.max(
        0,
        Math.round((classification.confidence - 0.15) * 100) / 100
      );
      return {
        bucket: classification.bucket,
        confidence: newConfidence,
        adjustmentReason:
          "Strong recent success history with no prior failures (-0.15 confidence)",
      };
    }
  }

  // 2. BANK_ERROR check:
  // If bucket is BANK_ERROR and there are already 2+ prior FAILED attempts with the exact same failCode
  // -> reduce confidence by 0.10 (truly transient error shouldn't repeat identically this many times)
  if (classification.bucket === "BANK_ERROR") {
    const failedAttempts = existingAttempts.filter(
      (att) => att.result === "FAILED"
    );

    let matchCount = 0;
    if (failCode) {
      matchCount = failedAttempts.filter(
        (att) => !(att as any).failCode || (att as any).failCode === failCode
      ).length;
    } else {
      const codeCounts = new Map<string, number>();
      let hasExplicitCode = false;
      for (const a of failedAttempts) {
        const code = (a as any).failCode;
        if (code) {
          hasExplicitCode = true;
          codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
        }
      }
      if (hasExplicitCode) {
        matchCount = Math.max(0, ...Array.from(codeCounts.values()));
      } else {
        matchCount = failedAttempts.length;
      }
    }

    if (matchCount >= 2) {
      const newConfidence = Math.max(
        0,
        Math.round((classification.confidence - 0.10) * 100) / 100
      );
      return {
        bucket: classification.bucket,
        confidence: newConfidence,
        adjustmentReason:
          "Repeated bank error with 2+ identical prior failures (-0.10 confidence)",
      };
    }
  }

  // 3. Otherwise pass through unchanged
  return classification;
}

export default corroborate;
