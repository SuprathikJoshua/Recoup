import { prisma } from "../config/db.js";
import { classify, type ClassifyResult } from "../classifier/classify.js";
import { decide, type DeciderResult } from "../decider/decide.js";
import { logAudit } from "../audit/auditLogger.js";
import { executeDecision, type ExecutionResult } from "../executor/retryExecutor.js";
import type {
  CustomerContext,
  RetryAttempt,
  FailedTransaction,
  AuditLog,
} from "../generated/prisma/client.js";

export interface ProcessTransactionOptions {
  customerMap?: Map<string, CustomerContext>;
  attemptsByTxn?: Map<string, RetryAttempt[]>;
}

export interface ProcessTransactionResult {
  transaction: FailedTransaction;
  customer: CustomerContext;
  classification: ClassifyResult;
  decision: DeciderResult;
  executionResult: ExecutionResult;
  auditLogs: AuditLog[];
}

/**
 * Executes a single failed transaction through the complete Recoup engine lifecycle:
 * Intake context -> Multi-factor classification -> Deterministic decision -> Retry execution -> Audit trail.
 * 
 * Shared by both the batch processing pipeline and the live demo injection endpoint.
 */
export async function processTransaction(
  txn: FailedTransaction,
  options?: ProcessTransactionOptions
): Promise<ProcessTransactionResult> {
  const { customerMap, attemptsByTxn } = options || {};

  // 1. Resolve Customer Context
  let customer: CustomerContext | undefined;
  if (customerMap) {
    customer = customerMap.get(txn.customerId);
  }

  if (!customer) {
    const fetched = await prisma.customerContext.findUnique({
      where: { customerId: txn.customerId },
    });
    if (fetched) {
      customer = fetched;
    } else {
      customer = {
        customerId: txn.customerId,
        debitPatternDays: [1, 2, 3],
        pastSuccessTxnDates: [],
        contactCountThisWeek: 0,
        mandateExpiryDate: new Date("2028-01-01"),
      };
    }
    if (customerMap) {
      customerMap.set(txn.customerId, customer);
    }
  }

  // 2. Resolve Prior Retry Attempts
  let existingAttempts: RetryAttempt[];
  if (attemptsByTxn && attemptsByTxn.has(txn.txnId)) {
    existingAttempts = attemptsByTxn.get(txn.txnId)!;
  } else {
    existingAttempts = await prisma.retryAttempt.findMany({
      where: { txnId: txn.txnId },
      orderBy: { attemptNo: "asc" },
    });
    if (attemptsByTxn) {
      attemptsByTxn.set(txn.txnId, existingAttempts);
    }
  }

  // 3. Classify Root Cause with Multi-Factor Scoring
  const daysToMandateExpiry = Math.floor(
    (new Date(customer.mandateExpiryDate).getTime() - new Date(txn.failTimestamp).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  const classification = classify({
    failCode: txn.failCode,
    daysToMandateExpiry,
    pastSuccessTxnCount: customer.pastSuccessTxnDates.length,
  });

  await logAudit(
    txn.txnId,
    "CLASSIFY",
    `Classified '${txn.failCode}' into '${classification.bucket}' (confidence: ${classification.confidence}${classification.adjustmentReason ? `, adjusted: ${classification.adjustmentReason}` : ""})`,
    classification.confidence
  );

  // 4. Make Decision
  const decision = decide({
    paymentMode: txn.paymentMode,
    bucket: classification.bucket,
    confidence: classification.confidence,
    customer,
    existingAttempts,
    transactionAmount: txn.amount,
  });

  await logAudit(
    txn.txnId,
    "ACTION_DECIDE",
    `Decision: ${decision.action}. ${decision.reason}`,
    classification.confidence
  );

  // 5. Synchronous in-memory mutation: immediately update contactCountThisWeek
  // before scheduling retry so subsequent transactions for the same customer see the live count
  if (decision.action === "RETRY_SCHEDULED") {
    customer.contactCountThisWeek += 1;
    if (customerMap) {
      customerMap.set(txn.customerId, customer);
    }
  }

  // 6. Execute Decision & Record Outcome
  const executionResult = await executeDecision(
    txn.txnId,
    decision,
    existingAttempts.length,
    txn.customerId,
    classification.bucket
  );

  if (executionResult.retryAttempt) {
    existingAttempts.push(executionResult.retryAttempt);
    if (attemptsByTxn) {
      attemptsByTxn.set(txn.txnId, existingAttempts);
    }
  }

  // 7. Retrieve updated transaction state and all generated audit logs
  const updatedTxn = (await prisma.failedTransaction.findUnique({
    where: { txnId: txn.txnId },
  })) || txn;

  const auditLogs = await prisma.auditLog.findMany({
    where: { txnId: txn.txnId },
    orderBy: { timestamp: "asc" },
  });

  return {
    transaction: updatedTxn,
    customer,
    classification,
    decision,
    executionResult,
    auditLogs,
  };
}

export default processTransaction;
