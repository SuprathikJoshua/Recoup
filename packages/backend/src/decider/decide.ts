import {
  MAX_ATTEMPTS,
  MIN_GAP_DAYS,
  MAX_FEE_TO_RECOVERY_RATIO,
  MAX_CONTACTS_PER_WEEK,
  CONFIDENCE_THRESHOLD_FOR_DEAD,
} from "../config/rules.js";
import type { CustomerContext, RetryAttempt, Prisma } from "../generated/prisma/client.js";

export interface DeciderInput {
  bucket: string;
  confidence: number;
  customer: CustomerContext;
  existingAttempts: RetryAttempt[];
  transactionAmount: Prisma.Decimal | number | string;
  now?: Date;
}

export interface DeciderResult {
  action: string;
  scheduledFor?: Date;
  reason: string;
}

const HARD_FAILURE_BUCKETS = new Set([
  "MANDATE_EXPIRED",
  "WRONG_ACCOUNT",
  "FRAUD_BLOCK",
]);

/**
 * Calculates the next future calendar date matching any of the customer's debit pattern days.
 */
function getNextDebitPatternDate(patternDays: number[], fromDate: Date): Date {
  if (!patternDays || patternDays.length === 0) {
    const fallback = new Date(fromDate);
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(9, 0, 0, 0);
    return fallback;
  }

  for (let offset = 1; offset <= 35; offset++) {
    const candidate = new Date(fromDate);
    candidate.setDate(fromDate.getDate() + offset);
    candidate.setHours(9, 0, 0, 0);
    if (patternDays.includes(candidate.getDate())) {
      return candidate;
    }
  }

  const fallback = new Date(fromDate);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(9, 0, 0, 0);
  return fallback;
}

/**
 * Pure decision engine executing deterministic precedence rules.
 * No database calls, no network side-effects.
 * 
 * @param input Decider parameters including bucket, confidence, customer context, and attempt history
 * @returns Decision result with action, optional scheduled timestamp, and explanation reason
 */
export function decide(input: DeciderInput): DeciderResult {
  const {
    bucket,
    confidence,
    customer,
    existingAttempts,
    transactionAmount,
    now = new Date(),
  } = input;

  // 1. Exceeded RBI attempt cap
  if (existingAttempts.length >= MAX_ATTEMPTS) {
    return {
      action: "MARKED_DEAD",
      reason: "Exceeded RBI attempt cap",
    };
  }

  // 2. Minimum gap between retries not met
  if (existingAttempts.length > 0) {
    const latestAttemptTime = Math.max(
      ...existingAttempts.map((attempt) => new Date(attempt.attemptTimestamp).getTime())
    );
    const diffDays = (now.getTime() - latestAttemptTime) / (1000 * 60 * 60 * 24);

    if (diffDays < MIN_GAP_DAYS) {
      return {
        action: "SKIPPED_TOO_SOON",
        reason: "Minimum gap between retries not met",
      };
    }
  }

  // 3. Exceeded fee-to-recovery ratio
  const cumulativeFees = existingAttempts.reduce(
    (sum, attempt) => sum + Number(attempt.feeCharged),
    0
  );
  const amount = Number(transactionAmount);

  if (amount > 0 && cumulativeFees / amount > MAX_FEE_TO_RECOVERY_RATIO) {
    return {
      action: "MARKED_DEAD",
      reason: "Exceeded fee-to-recovery ratio",
    };
  }

  // 4. Unrecognized failure code
  if (bucket === "UNKNOWN") {
    return {
      action: "ESCALATED",
      reason: "Unrecognized failure code, needs human review",
    };
  }

  // 5. Low classification confidence
  if (confidence < CONFIDENCE_THRESHOLD_FOR_DEAD) {
    return {
      action: "ESCALATED",
      reason: "Low classification confidence, holding for review",
    };
  }

  // 6. Weekly customer contact cap reached
  if (customer.contactCountThisWeek >= MAX_CONTACTS_PER_WEEK) {
    return {
      action: "SKIPPED_CONTACT_CAP",
      reason: "Weekly customer contact cap reached",
    };
  }

  // 7. INSUFFICIENT_FUND -> schedule on next debit pattern day
  if (bucket === "INSUFFICIENT_FUND") {
    const scheduledFor = getNextDebitPatternDate(customer.debitPatternDays, now);
    return {
      action: "RETRY_SCHEDULED",
      scheduledFor,
      reason: "Aligned with historical salary/debit pattern",
    };
  }

  // 8. BANK_ERROR -> transient bank error, fast retry (now + 3 hours)
  if (bucket === "BANK_ERROR") {
    const scheduledFor = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return {
      action: "RETRY_SCHEDULED",
      scheduledFor,
      reason: "Transient bank error, fast retry",
    };
  }

  // 9. Hard failure buckets -> unrecoverable
  if (HARD_FAILURE_BUCKETS.has(bucket)) {
    return {
      action: "RESOLVED_UNRECOVERABLE",
      reason: "Hard failure bucket, retry will not succeed",
    };
  }

  // Fallback
  return {
    action: "ESCALATED",
    reason: "Unrecognized decision branch",
  };
}

export default decide;
