import Razorpay from "razorpay";
import { prisma } from "../config/db.js";
import { logAudit } from "../audit/auditLogger.js";
import { classify } from "../classifier/classify.js";
import {
  TxnStatus,
  AttemptResult,
  Prisma,
  type RetryAttempt,
} from "../generated/prisma/client.js";

export interface DeciderOutput {
  action: string;
  scheduledFor?: Date;
  reason: string;
}

export interface ExecutionResult {
  txnId: string;
  actionTaken: string;
  status: TxnStatus;
  retryAttempt?: RetryAttempt;
}

/**
 * Settlement success rate lookup by classification bucket.
 * Determines probability of successful mandate re-debit & bank settlement
 * after real Razorpay representment order is created.
 */
export const SETTLEMENT_SUCCESS_RATES: Record<string, number> = {
  INSUFFICIENT_FUND: 0.65,
  BANK_ERROR: 0.80,
  DEFAULT: 0.70,
};

export function getSettlementSuccessRate(bucket?: string): number {
  if (bucket && typeof SETTLEMENT_SUCCESS_RATES[bucket] === "number") {
    return SETTLEMENT_SUCCESS_RATES[bucket];
  }
  return SETTLEMENT_SUCCESS_RATES.DEFAULT ?? 0.70;
}

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_TEST_KEY_ID || "rzp_test_dummy",
  key_secret: process.env.RAZORPAY_TEST_KEY_SECRET || "dummy_secret",
});

/**
 * Executes the decider output by updating transaction status, recording retry attempts,
 * and creating audit logs for every branch.
 * 
 * For RETRY_SCHEDULED, makes a real minimal test-mode API call to Razorpay to verify network capability,
 * followed by a realistic bucket-weighted settlement simulation layer.
 * 
 * @param txnId Transaction identifier
 * @param decision Decider outcome including action, reason, and optional scheduled time
 * @param currentAttemptsCount Number of prior attempts executed for this transaction
 * @param customerId Customer identifier for updating weekly contact caps
 * @param bucket Optional classification bucket for weighted settlement simulation
 * @returns The execution result with the updated status
 */
export async function executeDecision(
  txnId: string,
  decision: DeciderOutput,
  currentAttemptsCount: number,
  customerId: string,
  bucket?: string
): Promise<ExecutionResult> {
  const { action, reason } = decision;

  switch (action) {
    case "RETRY_SCHEDULED": {
      const transaction = await prisma.failedTransaction.findUnique({
        where: { txnId },
      });

      if (!transaction) {
        throw new Error(`Transaction with txnId "${txnId}" not found for retry execution.`);
      }

      // Step 1: Real Razorpay API Order Creation (genuine API integration)
      let apiSuccess = false;
      let orderId: string | undefined;

      try {
        const order = await razorpay.orders.create({
          amount: Math.round(Number(transaction.amount) * 100),
          currency: "INR",
          receipt: `retry_${txnId}`,
        });
        orderId = (order as { id: string }).id;
        apiSuccess = true;
      } catch (error) {
        console.warn(
          `Razorpay API retry call rejected or failed for txn ${txnId}:`,
          error instanceof Error ? error.message : error
        );
        apiSuccess = false;
      }

      // Step 2: Realistic Settlement-Outcome Layer
      // If the real Razorpay API call itself fails/throws (network, bad creds), keep that as an automatic FAILED outcome.
      // After a successful API call, add probabilistic layer weighted by classification bucket.
      let outcome: AttemptResult;
      let failureReasonType: "API_TRANSPORT" | "SIMULATED_SETTLEMENT" | null = null;

      if (!apiSuccess) {
        outcome = AttemptResult.FAILED;
        failureReasonType = "API_TRANSPORT";
      } else {
        const resolvedBucket =
          bucket || classify({ failCode: transaction.failCode }).bucket;
        const successRate = getSettlementSuccessRate(resolvedBucket);
        const isSettled = Math.random() < successRate;

        if (isSettled) {
          outcome = AttemptResult.SUCCESS;
        } else {
          outcome = AttemptResult.FAILED;
          failureReasonType = "SIMULATED_SETTLEMENT";
        }
      }

      const nextStatus =
        outcome === AttemptResult.SUCCESS
          ? TxnStatus.RESOLVED_RECOVERED
          : TxnStatus.PENDING;

      // Step 3: Distinct Audit Log Messages distinguishing API transport failure vs simulated settlement decline
      let auditMessage: string;
      if (outcome === AttemptResult.SUCCESS) {
        auditMessage = `Executed Razorpay API retry attempt #${currentAttemptsCount + 1}: Result ${outcome} (Order ID: ${orderId || "N/A"}). ${reason}`;
      } else if (failureReasonType === "API_TRANSPORT") {
        auditMessage = `Executed Razorpay API retry attempt #${currentAttemptsCount + 1}: Result ${outcome} (Razorpay order creation failed). ${reason}`;
      } else {
        auditMessage = `Executed Razorpay API retry attempt #${currentAttemptsCount + 1}: Result ${outcome} (Order ID: ${orderId || "N/A"} - Order created successfully but settlement declined at bank-side — simulated, test-mode has no real mandate debit). ${reason}`;
      }

      const attempt = await prisma.$transaction(async (tx) => {
        const createdAttempt = await tx.retryAttempt.create({
          data: {
            txnId,
            attemptNo: currentAttemptsCount + 1,
            attemptTimestamp: new Date(),
            actionTaken: "RAZORPAY_API_RETRY",
            result: outcome,
            feeCharged: new Prisma.Decimal("2.00"),
          },
        });

        await tx.customerContext.update({
          where: { customerId },
          data: { contactCountThisWeek: { increment: 1 } },
        });

        await tx.failedTransaction.update({
          where: { txnId },
          data: { status: nextStatus },
        });

        await logAudit(
          txnId,
          `EXECUTE_${action}`,
          auditMessage
        );

        return createdAttempt;
      });

      return {
        txnId,
        actionTaken: "RETRY_SCHEDULED",
        status: nextStatus,
        retryAttempt: attempt,
      };
    }

    case "RESOLVED_UNRECOVERABLE": {
      await prisma.$transaction(async (tx) => {
        await tx.failedTransaction.update({
          where: { txnId },
          data: { status: TxnStatus.RESOLVED_UNRECOVERABLE },
        });

        await logAudit(
          txnId,
          `EXECUTE_${action}`,
          `Marked unrecoverable: ${reason}`
        );
      });

      return {
        txnId,
        actionTaken: "RESOLVED_UNRECOVERABLE",
        status: TxnStatus.RESOLVED_UNRECOVERABLE,
      };
    }

    case "MARKED_DEAD": {
      await prisma.$transaction(async (tx) => {
        await tx.failedTransaction.update({
          where: { txnId },
          data: { status: TxnStatus.DEAD },
        });

        await logAudit(
          txnId,
          `EXECUTE_${action}`,
          `Marked dead: ${reason}`
        );
      });

      return {
        txnId,
        actionTaken: "MARKED_DEAD",
        status: TxnStatus.DEAD,
      };
    }

    case "ESCALATED": {
      await prisma.$transaction(async (tx) => {
        await tx.failedTransaction.update({
          where: { txnId },
          data: { status: TxnStatus.ESCALATED },
        });

        await logAudit(
          txnId,
          `EXECUTE_${action}`,
          `Escalated to human review: ${reason}`
        );
      });

      return {
        txnId,
        actionTaken: "ESCALATED",
        status: TxnStatus.ESCALATED,
      };
    }

    case "SKIPPED_TOO_SOON":
    case "SKIPPED_CONTACT_CAP": {
      await prisma.$transaction(async (tx) => {
        await tx.failedTransaction.update({
          where: { txnId },
          data: { status: TxnStatus.PENDING },
        });

        await logAudit(
          txnId,
          `EXECUTE_${action}`,
          `Skipped retry execution: ${reason}`
        );
      });

      return {
        txnId,
        actionTaken: action,
        status: TxnStatus.PENDING,
      };
    }

    default: {
      await prisma.$transaction(async (tx) => {
        await tx.failedTransaction.update({
          where: { txnId },
          data: { status: TxnStatus.ESCALATED },
        });

        await logAudit(
          txnId,
          "EXECUTE_UNKNOWN",
          `Unknown action "${action}" encountered. Defaulting to ESCALATED. ${reason}`
        );
      });

      return {
        txnId,
        actionTaken: action,
        status: TxnStatus.ESCALATED,
      };
    }
  }
}

export default executeDecision;
