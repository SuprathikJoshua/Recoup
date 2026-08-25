import { prisma } from "../config/db.js";
import { logAudit } from "../audit/auditLogger.js";
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
 * Simulates calling Razorpay API retry for payment representment.
 * Returns SUCCESS (70% probability) or FAILED (30% probability).
 */
export function simulateRazorpayRetry(): AttemptResult {
  return Math.random() < 0.70 ? AttemptResult.SUCCESS : AttemptResult.FAILED;
}

/**
 * Executes the decider output by updating transaction status, recording retry attempts,
 * and creating audit logs for every branch.
 * 
 * @param txnId Transaction identifier
 * @param decision Decider outcome including action, reason, and optional scheduled time
 * @param currentAttemptsCount Number of prior attempts executed for this transaction
 * @returns The execution result with the updated status
 */
export async function executeDecision(
  txnId: string,
  decision: DeciderOutput,
  currentAttemptsCount: number
): Promise<ExecutionResult> {
  const { action, reason } = decision;

  switch (action) {
    case "RETRY_SCHEDULED": {
      const outcome = simulateRazorpayRetry();
      const nextStatus =
        outcome === AttemptResult.SUCCESS
          ? TxnStatus.RESOLVED_RECOVERED
          : TxnStatus.PENDING;

      const attempt = await prisma.retryAttempt.create({
        data: {
          txnId,
          attemptNo: currentAttemptsCount + 1,
          attemptTimestamp: new Date(),
          actionTaken: "RAZORPAY_API_RETRY",
          result: outcome,
          feeCharged: new Prisma.Decimal("2.00"),
        },
      });

      await prisma.failedTransaction.update({
        where: { txnId },
        data: { status: nextStatus },
      });

      await logAudit(
        txnId,
        `EXECUTE_${action}`,
        `Executed Razorpay API retry attempt #${currentAttemptsCount + 1}: Result ${outcome}. ${reason}`
      );

      return {
        txnId,
        actionTaken: "RETRY_SCHEDULED",
        status: nextStatus,
        retryAttempt: attempt,
      };
    }

    case "RESOLVED_UNRECOVERABLE": {
      await prisma.failedTransaction.update({
        where: { txnId },
        data: { status: TxnStatus.RESOLVED_UNRECOVERABLE },
      });

      await logAudit(
        txnId,
        `EXECUTE_${action}`,
        `Marked unrecoverable: ${reason}`
      );

      return {
        txnId,
        actionTaken: "RESOLVED_UNRECOVERABLE",
        status: TxnStatus.RESOLVED_UNRECOVERABLE,
      };
    }

    case "MARKED_DEAD": {
      await prisma.failedTransaction.update({
        where: { txnId },
        data: { status: TxnStatus.DEAD },
      });

      await logAudit(
        txnId,
        `EXECUTE_${action}`,
        `Marked dead: ${reason}`
      );

      return {
        txnId,
        actionTaken: "MARKED_DEAD",
        status: TxnStatus.DEAD,
      };
    }

    case "ESCALATED": {
      await prisma.failedTransaction.update({
        where: { txnId },
        data: { status: TxnStatus.ESCALATED },
      });

      await logAudit(
        txnId,
        `EXECUTE_${action}`,
        `Escalated to human review: ${reason}`
      );

      return {
        txnId,
        actionTaken: "ESCALATED",
        status: TxnStatus.ESCALATED,
      };
    }

    case "SKIPPED_TOO_SOON":
    case "SKIPPED_CONTACT_CAP": {
      await prisma.failedTransaction.update({
        where: { txnId },
        data: { status: TxnStatus.PENDING },
      });

      await logAudit(
        txnId,
        `EXECUTE_${action}`,
        `Skipped retry execution: ${reason}`
      );

      return {
        txnId,
        actionTaken: action,
        status: TxnStatus.PENDING,
      };
    }

    default: {
      await prisma.failedTransaction.update({
        where: { txnId },
        data: { status: TxnStatus.ESCALATED },
      });

      await logAudit(
        txnId,
        "EXECUTE_UNKNOWN",
        `Unknown action "${action}" encountered. Defaulting to ESCALATED. ${reason}`
      );

      return {
        txnId,
        actionTaken: action,
        status: TxnStatus.ESCALATED,
      };
    }
  }
}

export default executeDecision;
