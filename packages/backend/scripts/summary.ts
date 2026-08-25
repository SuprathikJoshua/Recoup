import { prisma, pool } from "../src/config/db.js";
import { classify } from "../src/classifier/classify.js";
import { TxnStatus } from "../src/generated/prisma/client.js";

export interface EscalatedException {
  txnId: string;
  customerId: string;
  amount: number;
  failCode: string;
  trueReason: string;
  reason: string;
}

export interface GuardRailTriggerCounts {
  rbiAttemptCap: number;
  minGapDays: number;
  feeToRecoveryRatio: number;
  contactCap: number;
  unknownCodeEscalation: number;
  lowConfidenceEscalation: number;
}

export interface EngineSummaryReport {
  totalRecovered: number;
  totalFeesSpent: number;
  netRecovered: number;
  classifierAccuracy: {
    totalNonEdgeCases: number;
    correctMatches: number;
    accuracyRatePercentage: number;
  };
  statusCounts: Record<string, number>;
  escalatedExceptions: EscalatedException[];
  guardRailTriggers: GuardRailTriggerCounts;
}

/**
 * Pure data aggregation function that computes the complete performance summary
 * of the Recoup recovery engine from database records.
 * Directly reusable for backend dashboard API endpoints.
 */
export async function getEngineSummary(): Promise<EngineSummaryReport> {
  // 1. Total Recovered Amount
  const recoveredTxns = await prisma.failedTransaction.findMany({
    where: { status: TxnStatus.RESOLVED_RECOVERED },
    select: { amount: true },
  });
  const totalRecovered = recoveredTxns.reduce(
    (sum, t) => sum + Number(t.amount),
    0
  );

  // 2. Total Fees Spent
  const allAttempts = await prisma.retryAttempt.findMany({
    select: { feeCharged: true },
  });
  const totalFeesSpent = allAttempts.reduce(
    (sum, a) => sum + Number(a.feeCharged),
    0
  );

  // 3. Net Recovered
  const netRecovered = totalRecovered - totalFeesSpent;

  // 4. Classifier Accuracy Evaluation (non-edge cases)
  const allTransactions = await prisma.failedTransaction.findMany();
  const nonEdgeTxns = allTransactions.filter(
    (t) => t.trueReason !== "UNKNOWN"
  );
  let correctMatches = 0;

  for (const txn of nonEdgeTxns) {
    const classification = classify({ failCode: txn.failCode });
    if (classification.bucket === txn.trueReason) {
      correctMatches++;
    }
  }

  const accuracyRatePercentage =
    nonEdgeTxns.length > 0
      ? Number(((correctMatches / nonEdgeTxns.length) * 100).toFixed(2))
      : 0;

  // 5. Transaction Status Counts
  const statusGrouping = await prisma.failedTransaction.groupBy({
    by: ["status"],
    _count: { txnId: true },
  });
  const statusCounts: Record<string, number> = {};
  for (const g of statusGrouping) {
    statusCounts[g.status] = g._count.txnId;
  }

  // 6. Escalated Exceptions List
  const escalatedTxns = await prisma.failedTransaction.findMany({
    where: { status: TxnStatus.ESCALATED },
    select: {
      txnId: true,
      customerId: true,
      amount: true,
      failCode: true,
      trueReason: true,
    },
  });

  const escalatedTxnIds = escalatedTxns.map((t) => t.txnId);
  const auditLogsForEscalated = await prisma.auditLog.findMany({
    where: {
      txnId: { in: escalatedTxnIds },
      decisionType: "ACTION_DECIDE",
    },
  });

  const auditMap = new Map<string, string>();
  for (const log of auditLogsForEscalated) {
    auditMap.set(log.txnId, log.reasonText);
  }

  const escalatedExceptions: EscalatedException[] = escalatedTxns.map((t) => ({
    txnId: t.txnId,
    customerId: t.customerId,
    amount: Number(t.amount),
    failCode: t.failCode,
    trueReason: t.trueReason,
    reason: auditMap.get(t.txnId) || "Needs human review",
  }));

  // 7. Guard-Rail Trigger Counts from Audit Logs
  const actionAuditLogs = await prisma.auditLog.findMany({
    where: { decisionType: "ACTION_DECIDE" },
    select: { reasonText: true },
  });

  const guardRailTriggers: GuardRailTriggerCounts = {
    rbiAttemptCap: 0,
    minGapDays: 0,
    feeToRecoveryRatio: 0,
    contactCap: 0,
    unknownCodeEscalation: 0,
    lowConfidenceEscalation: 0,
  };

  for (const log of actionAuditLogs) {
    const text = log.reasonText;
    if (text.includes("Exceeded RBI attempt cap")) {
      guardRailTriggers.rbiAttemptCap++;
    } else if (text.includes("Minimum gap between retries not met")) {
      guardRailTriggers.minGapDays++;
    } else if (text.includes("Exceeded fee-to-recovery ratio")) {
      guardRailTriggers.feeToRecoveryRatio++;
    } else if (text.includes("Weekly customer contact cap reached")) {
      guardRailTriggers.contactCap++;
    } else if (text.includes("Unrecognized failure code")) {
      guardRailTriggers.unknownCodeEscalation++;
    } else if (text.includes("Low classification confidence")) {
      guardRailTriggers.lowConfidenceEscalation++;
    }
  }

  return {
    totalRecovered: Number(totalRecovered.toFixed(2)),
    totalFeesSpent: Number(totalFeesSpent.toFixed(2)),
    netRecovered: Number(netRecovered.toFixed(2)),
    classifierAccuracy: {
      totalNonEdgeCases: nonEdgeTxns.length,
      correctMatches,
      accuracyRatePercentage,
    },
    statusCounts,
    escalatedExceptions,
    guardRailTriggers,
  };
}

export async function printSummaryReport(): Promise<void> {
  console.log("==================================================");
  console.log("       RECOUP RECOVERY ENGINE: SUMMARY REPORT     ");
  console.log("==================================================\n");

  const summary = await getEngineSummary();

  console.log("1. FINANCIAL PERFORMANCE");
  console.log("--------------------------------------------------");
  console.log(`  • Gross Recovered : ₹${summary.totalRecovered.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
  console.log(`  • Total Fees Spent: ₹${summary.totalFeesSpent.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
  console.log(`  • Net ₹ Recovered : ₹${summary.netRecovered.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
  console.log("");

  console.log("2. CLASSIFIER ACCURACY MATCH RATE");
  console.log("--------------------------------------------------");
  console.log(`  • Evaluated (Non-Edge Cases): ${summary.classifierAccuracy.totalNonEdgeCases}`);
  console.log(`  • Correct Matches           : ${summary.classifierAccuracy.correctMatches}`);
  console.log(`  • Classification Accuracy   : ${summary.classifierAccuracy.accuracyRatePercentage}%\n`);

  console.log("3. TRANSACTION STATUS BREAKDOWN");
  console.log("--------------------------------------------------");
  console.table(
    Object.entries(summary.statusCounts).map(([status, count]) => ({
      Status: status,
      Count: count,
    }))
  );

  console.log("4. GUARD-RAIL TRIGGER COUNTS");
  console.log("--------------------------------------------------");
  console.table([
    { "Guard Rail Rule": "RBI Attempt Cap (3 attempts)", "Times Triggered": summary.guardRailTriggers.rbiAttemptCap },
    { "Guard Rail Rule": "Minimum Gap Between Retries (< 5 days)", "Times Triggered": summary.guardRailTriggers.minGapDays },
    { "Guard Rail Rule": "Fee-to-Recovery Ratio (> 50%)", "Times Triggered": summary.guardRailTriggers.feeToRecoveryRatio },
    { "Guard Rail Rule": "Customer Contact Cap (>= 2/week)", "Times Triggered": summary.guardRailTriggers.contactCap },
    { "Guard Rail Rule": "Unknown Failure Code Review", "Times Triggered": summary.guardRailTriggers.unknownCodeEscalation },
    { "Guard Rail Rule": "Low Classification Confidence Review", "Times Triggered": summary.guardRailTriggers.lowConfidenceEscalation },
  ]);

  console.log("5. ESCALATED EXCEPTIONS (Human Review Required)");
  console.log("--------------------------------------------------");
  if (summary.escalatedExceptions.length === 0) {
    console.log("  No transactions currently escalated.");
  } else {
    console.table(
      summary.escalatedExceptions.map((ex) => ({
        "Txn ID": ex.txnId,
        "Customer ID": ex.customerId,
        "Amount (₹)": ex.amount,
        "Fail Code": ex.failCode,
        "True Reason": ex.trueReason,
        "Escalation Reason": ex.reason,
      }))
    );
  }

  console.log("==================================================\n");
}

if (process.argv[1]?.endsWith("summary.ts") || process.argv[1]?.endsWith("summary.js")) {
  printSummaryReport()
    .catch((error) => {
      console.error("❌ Failed to generate summary report:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
