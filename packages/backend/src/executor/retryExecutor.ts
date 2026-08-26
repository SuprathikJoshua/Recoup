import Razorpay from "razorpay";
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

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_TEST_KEY_ID || "rzp_test_dummy",
  key_secret: process.env.RAZORPAY_TEST_KEY_SECRET || "dummy_secret",
});

/**
 * Executes the decider output by updating transaction status, recording retry attempts,
 * and creating audit logs for every branch.
 * 
 * For RETRY_SCHEDULED, makes a real minimal test-mode API call to Razorpay to verify network capability.
 * 
 * @param txnId Transaction identifier
 * @param decision Decider outcome including action, reason, and optional scheduled time
 * @param currentAttemptsCount Number of prior attempts executed for this transaction
 * @param customerId Customer identifier for updating weekly contact caps
 * @returns The execution result with the updated status
 */
export async function executeDecision(
  txnId: string,
  decision: DeciderOutput,
  currentAttemptsCount: number,
  customerId: string
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

      let outcome: AttemptResult;
      let orderId: string | undefined;

      try {
        const order = await razorpay.orders.create({
          amount: Math.round(Number(transaction.amount) * 100),
          currency: "INR",
          receipt: `retry_${txnId}`,
        });
        orderId = (order as { id: string }).id;
        outcome = AttemptResult.SUCCESS;
      } catch (error) {
        console.warn(
          `Razorpay API retry call rejected or failed for txn ${txnId}:`,
          error instanceof Error ? error.message : error
        );
        outcome = AttemptResult.FAILED;
      }

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

      await prisma.customerContext.update({
        where: { customerId },
        data: { contactCountThisWeek: { increment: 1 } },
      });

      await prisma.failedTransaction.update({
        where: { txnId },
        data: { status: nextStatus },
      });

      const auditMessage =
        outcome === AttemptResult.SUCCESS
          ? `Executed Razorpay API retry attempt #${currentAttemptsCount + 1}: Result ${outcome} (Order ID: ${orderId || "N/A"}). ${reason}`
          : `Executed Razorpay API retry attempt #${currentAttemptsCount + 1}: Result ${outcome} (Razorpay test call rejected/network failed). ${reason}`;

      await logAudit(
        txnId,
        `EXECUTE_${action}`,
        auditMessage
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
