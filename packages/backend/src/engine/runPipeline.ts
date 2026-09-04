import { prisma, pool } from "../config/db.js";
import { loadTransactions } from "../intake/loadTransactions.js";
import { processTransaction } from "./processTransaction.js";
import type { CustomerContext, RetryAttempt } from "../generated/prisma/client.js";

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
    await processTransaction(txn, { customerMap, attemptsByTxn });
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
