import { prisma, pool } from "../src/config/db.js";
import { getEngineSummary, type EngineSummaryReport, type EscalatedException, type GuardRailTriggerCounts } from "../src/api/summaryService.js";

export { getEngineSummary, type EngineSummaryReport, type EscalatedException, type GuardRailTriggerCounts };

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
    { "Guard Rail Rule": "Low Confidence Review", "Times Triggered": summary.guardRailTriggers.lowConfidenceEscalation },
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
