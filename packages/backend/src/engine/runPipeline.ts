import { prisma, pool } from "../config/db.js";
import { loadTransactions } from "../intake/loadTransactions.js";
import { classify } from "../classifier/classify.js";
import { decide } from "../decider/decide.js";
import { logAudit } from "../audit/auditLogger.js";
import { executeDecision } from "../executor/retryExecutor.js";
import type { CustomerContext, RetryAttempt, FailedTransaction } from "../generated/prisma/client.js";

async function processTransaction(
  txn: FailedTransaction,
  customerMap: Map<string, CustomerContext>,
  attemptsByTxn: Map<string, RetryAttempt[]>
): Promise<void> {
  // 1. Resolve Customer Context
  let customer = customerMap.get(txn.customerId);
  if (!customer) {
    customer = {
      customerId: txn.customerId,
      debitPatternDays: [1, 2, 3],
      pastSuccessTxnDates: [],
      contactCountThisWeek: 0,
      mandateExpiryDate: new Date("2028-01-01"),
    };
    customerMap.set(txn.customerId, customer);
  }

  const existingAttempts = attemptsByTxn.get(txn.txnId) || [];

  // 2. Classify Root Cause
  const classification = classify({ failCode: txn.failCode });
  await logAudit(
    txn.txnId,
    "CLASSIFY",
    `Classified '${txn.failCode}' into '${classification.bucket}' (confidence: ${classification.confidence})`,
    classification.confidence
  );

  // 3. Make Decision
  const decision = decide({
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

  // 4. Synchronous in-memory mutation: immediately update contactCountThisWeek
  // before scheduling retry so subsequent transactions for the same customer see the live count
  if (decision.action === "RETRY_SCHEDULED") {
    customer.contactCountThisWeek += 1;
    customerMap.set(txn.customerId, customer);
  }

  // 5. Execute Decision & Record Outcome
  const result = await executeDecision(txn.txnId, decision, existingAttempts.length, txn.customerId);

  if (result.retryAttempt) {
    existingAttempts.push(result.retryAttempt);
    attemptsByTxn.set(txn.txnId, existingAttempts);
  }
}

export async function runPipeline(): Promise<void> {
  console.log("==================================================");
  console.log("     RECOUP END-TO-END PIPELINE (PHASES 1-3)     ");
  console.log("==================================================");

  console.log("\n[1/3] Loading pending transactions from database...");
  const pendingTransactions = await loadTransactions();
  console.log(`  ✓ Found ${pendingTransactions.length} pending transactions.`);

  if (pendingTransactions.length === 0) {
    console.log("No pending transactions found. Run seed script first: npm run seed");
    return;
  }

  console.log("\n[2/3] Fetching customer contexts and prior attempt histories...");
  const allCustomers = await prisma.customerContext.findMany();
  const customerMap = new Map<string, CustomerContext>(
    allCustomers.map((c) => [c.customerId, c])
  );

  const allAttempts = await prisma.retryAttempt.findMany();
  const attemptsByTxn = new Map<string, RetryAttempt[]>();
  for (const att of allAttempts) {
    const list = attemptsByTxn.get(att.txnId) || [];
    list.push(att);
    attemptsByTxn.set(att.txnId, list);
  }
  console.log(`  ✓ Loaded ${allCustomers.length} customer profiles and ${allAttempts.length} prior attempts.`);

  console.log("\n[3/3] Processing pipeline sequentially for all transactions...");
  for (const txn of pendingTransactions) {
    await processTransaction(txn, customerMap, attemptsByTxn);
  }
  console.log(`  ✓ Successfully processed all ${pendingTransactions.length} transactions.\n`);

  // Final Summary
  console.log("==================================================");
  console.log("             PIPELINE EXECUTION SUMMARY           ");
  console.log("==================================================");

  const statusBreakdown = await prisma.failedTransaction.groupBy({
    by: ["status"],
    _count: {
      txnId: true,
    },
    orderBy: {
      _count: {
        txnId: "desc",
      },
    },
  });

  console.table(
    statusBreakdown.map((row) => ({
      "Transaction Status": row.status,
      "Count": row._count.txnId,
    }))
  );

  const totalAuditLogs = await prisma.auditLog.count();
  const totalRetryAttempts = await prisma.retryAttempt.count();

  console.log(`Total AuditLog Entries Created : ${totalAuditLogs}`);
  console.log(`Total Retry Attempts Recorded  : ${totalRetryAttempts}`);
  console.log("==================================================\n");
}

if (process.argv[1]?.endsWith("runPipeline.ts") || process.argv[1]?.endsWith("runPipeline.js")) {
  runPipeline()
    .catch((error) => {
      console.error("❌ Pipeline execution failed:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
