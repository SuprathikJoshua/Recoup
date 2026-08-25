import { prisma } from "../config/db.js";
import { classify } from "../classifier/classify.js";
import { TxnStatus } from "../generated/prisma/client.js";

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

export interface DailyRecoveryStat {
  date: string;
  formattedDate: string;
  amount: number;
  count: number;
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
  dailyRecoveries: DailyRecoveryStat[];
}

/**
 * Pure data aggregation function that computes the complete performance summary
 * of the Recoup recovery engine from database records.
 */
export async function getEngineSummary(): Promise<EngineSummaryReport> {
  // 1. Total Recovered Amount
  const recoveredTxns = await prisma.failedTransaction.findMany({
    where: { status: TxnStatus.RESOLVED_RECOVERED },
    select: { amount: true, failTimestamp: true },
    orderBy: { failTimestamp: "asc" },
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

  // 8. 30-Day Daily ₹ Recovered Trajectory (bucketed by failTimestamp)
  const dailyMap = new Map<string, { amount: number; count: number }>();
  const now = new Date();

  // Initialize last 30 daily buckets with 0
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split("T")[0]!;
    dailyMap.set(key, { amount: 0, count: 0 });
  }

  for (const txn of recoveredTxns) {
    const key = new Date(txn.failTimestamp).toISOString().split("T")[0]!;
    if (dailyMap.has(key)) {
      const entry = dailyMap.get(key)!;
      entry.amount += Number(txn.amount);
      entry.count += 1;
    } else {
      dailyMap.set(key, { amount: Number(txn.amount), count: 1 });
    }
  }

  const dailyRecoveries: DailyRecoveryStat[] = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([dateStr, val]) => {
      const dateObj = new Date(dateStr);
      return {
        date: dateStr,
        formattedDate: dateObj.toLocaleDateString("en-IN", {
          month: "short",
          day: "numeric",
        }),
        amount: Number(val.amount.toFixed(2)),
        count: val.count,
      };
    });

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
    dailyRecoveries,
  };
}
