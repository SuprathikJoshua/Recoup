import { prisma, pool } from "../src/config/db.js";
import {
  PaymentMode,
  TxnStatus,
  AttemptResult,
  Prisma,
} from "../src/generated/prisma/client.js";

interface FailureCategory {
  failCode: string | (() => string);
  trueReason: string;
  isRecoverable: boolean | null;
  count: number;
}

const EDGE_CASE_CODES = [
  "ZZ",
  "99X",
  "ERR_UNKNOWN",
  "U99",
  "INVALID_RESP",
  "E_CORRUPT_PKT",
];

const MERCHANTS = [
  "MERCH_STREAM_PLUS",
  "MERCH_FITNESS_CLUB",
  "MERCH_INSURANCE_LTD",
  "MERCH_BROADBAND_FIBER",
  "MERCH_EDTECH_LEARN",
  "MERCH_FINTECH_CREDIT",
  "MERCH_POWER_UTILITY",
  "MERCH_SAAS_CLOUD",
];

const DEBIT_PATTERN_CLUSTERS: number[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [10, 11, 12],
  [14, 15, 16],
  [19, 20, 21],
  [24, 25, 26],
  [28, 29, 30],
  [1, 5, 10],
  [29, 30, 31],
];

const PAYMENT_MODES: PaymentMode[] = [
  PaymentMode.UPI_AUTOPAY,
  PaymentMode.NACH,
  PaymentMode.EMANDATE,
];

function getRandomElement<T>(array: readonly T[]): T {
  const index = Math.floor(Math.random() * array.length);
  return array[index]!;
}

function getRandomDecimal(min: number, max: number): Prisma.Decimal {
  const value = Math.random() * (max - min) + min;
  return new Prisma.Decimal(value.toFixed(2));
}

function getRandomDateInLastDays(days: number): Date {
  const now = Date.now();
  const pastMs = Math.floor(Math.random() * days * 24 * 60 * 60 * 1000);
  return new Date(now - pastMs);
}

function getRandomPastDates(count: number, maxMonthsAgo: number): Date[] {
  const dates: Date[] = [];
  const now = Date.now();
  for (let i = 1; i <= count; i++) {
    const daysAgo = Math.floor(i * (maxMonthsAgo * 30) / count) + Math.floor(Math.random() * 5);
    dates.push(new Date(now - daysAgo * 24 * 60 * 60 * 1000));
  }
  return dates;
}

function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }
  return shuffled;
}

export async function seed(): Promise<void> {
  console.log("==================================================");
  console.log("  RECOUP PHASE 1: SEEDING DATABASE  ");
  console.log("==================================================");

  // 1. Safe & Idempotent Cleanup
  console.log("\n[1/4] Clearing existing records (idempotent clean)...");
  await prisma.auditLog.deleteMany();
  await prisma.retryAttempt.deleteMany();
  await prisma.failedTransaction.deleteMany();
  await prisma.customerContext.deleteMany();
  console.log("  ✓ Database cleared successfully.");

  // 2. Generate 40 CustomerContext records
  console.log("\n[2/4] Generating 40 CustomerContext records...");
  const customerIds: string[] = [];
  const customerContextData: Prisma.CustomerContextCreateManyInput[] = [];

  for (let i = 1; i <= 40; i++) {
    const customerId = `CUST_${i.toString().padStart(4, "0")}`;
    customerIds.push(customerId);

    const cluster = DEBIT_PATTERN_CLUSTERS[(i - 1) % DEBIT_PATTERN_CLUSTERS.length]!;
    const pastSuccessDates = getRandomPastDates(Math.floor(Math.random() * 3) + 2, 6);
    const contactCount = Math.floor(Math.random() * 4); // 0 to 3

    // Customers 9 to 16 are reserved for expired mandates
    const isMandateExpired = i >= 9 && i <= 16;
    const mandateExpiryDate = isMandateExpired
      ? new Date(Date.now() - Math.floor(Math.random() * 60 + 5) * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + Math.floor(Math.random() * 365 + 90) * 24 * 60 * 60 * 1000);

    customerContextData.push({
      customerId,
      debitPatternDays: cluster,
      pastSuccessTxnDates: pastSuccessDates,
      contactCountThisWeek: contactCount,
      mandateExpiryDate,
    });
  }

  await prisma.customerContext.createMany({
    data: customerContextData,
  });
  console.log(`  ✓ Created ${customerContextData.length} CustomerContext records.`);

  // 3. Generate 220 FailedTransaction records with exact distributions
  console.log("\n[3/4] Generating 220 FailedTransaction records (Strict Distribution)...");
  
  // Total: 220
  // 40% (88)  : 01 / INSUFFICIENT_FUND / isRecoverable: true
  // 20% (44)  : MD / MANDATE_EXPIRED   / isRecoverable: false
  // 15% (33)  : BE / BANK_ERROR        / isRecoverable: true
  // 10% (22)  : FD / FRAUD_BLOCK       / isRecoverable: false
  // 10% (22)  : WA / WRONG_ACCOUNT     / isRecoverable: false
  //  5% (11)  : Edge cases (garbage)  / UNKNOWN / isRecoverable: null
  const distributions: FailureCategory[] = [
    { failCode: "01", trueReason: "INSUFFICIENT_FUND", isRecoverable: true, count: 88 },
    { failCode: "MD", trueReason: "MANDATE_EXPIRED", isRecoverable: false, count: 44 },
    { failCode: "BE", trueReason: "BANK_ERROR", isRecoverable: true, count: 33 },
    { failCode: "FD", trueReason: "FRAUD_BLOCK", isRecoverable: false, count: 22 },
    { failCode: "WA", trueReason: "WRONG_ACCOUNT", isRecoverable: false, count: 22 },
    {
      failCode: () => getRandomElement(EDGE_CASE_CODES),
      trueReason: "UNKNOWN",
      isRecoverable: null,
      count: 11,
    },
  ];

  type RawTxnSpec = {
    failCode: string;
    trueReason: string;
    isRecoverable: boolean | null;
  };

  const rawTxnSpecs: RawTxnSpec[] = [];
  for (const dist of distributions) {
    for (let i = 0; i < dist.count; i++) {
      const code = typeof dist.failCode === "function" ? dist.failCode() : dist.failCode;
      rawTxnSpecs.push({
        failCode: code,
        trueReason: dist.trueReason,
        isRecoverable: dist.isRecoverable,
      });
    }
  }

  const shuffledSpecs = shuffle(rawTxnSpecs);
  const failedTxnData: Prisma.FailedTransactionCreateManyInput[] = [];

  for (let i = 0; i < shuffledSpecs.length; i++) {
    const spec = shuffledSpecs[i]!;
    const txnId = `TXN_${(i + 1).toString().padStart(6, "0")}`;
    
    // For MD failures, pick from expired customer pool, otherwise pick any customer
    let customerId: string;
    if (spec.trueReason === "MANDATE_EXPIRED") {
      customerId = `CUST_${(9 + (i % 8)).toString().padStart(4, "0")}`;
    } else {
      customerId = customerIds[i % customerIds.length]!;
    }

    const merchantId = getRandomElement(MERCHANTS);
    const paymentMode = getRandomElement(PAYMENT_MODES);
    const amount = getRandomDecimal(99, 4999);
    const failTimestamp = getRandomDateInLastDays(30);

    failedTxnData.push({
      txnId,
      customerId,
      merchantId,
      paymentMode,
      amount,
      failTimestamp,
      failCode: spec.failCode,
      trueReason: spec.trueReason,
      isRecoverable: spec.isRecoverable,
      status: TxnStatus.PENDING,
    });
  }

  await prisma.failedTransaction.createMany({
    data: failedTxnData,
  });
  console.log(`  ✓ Created ${failedTxnData.length} FailedTransaction records.`);

  // 4. Inject 5 compliance-boundary rows with exactly 3 RetryAttempts (RBI cap)
  console.log("\n[4/4] Injecting 5 compliance-boundary transactions at RBI attempt cap (3 attempts each)...");
  const complianceTxns = failedTxnData.slice(0, 5);
  const retryAttemptsData: Prisma.RetryAttemptCreateManyInput[] = [];

  for (const txn of complianceTxns) {
    const baseTimestamp = new Date(txn.failTimestamp).getTime();
    
    for (let attemptNo = 1; attemptNo <= 3; attemptNo++) {
      const attemptTimestamp = new Date(
        baseTimestamp + attemptNo * 24 * 60 * 60 * 1000 + Math.floor(Math.random() * 3600000)
      );

      retryAttemptsData.push({
        txnId: txn.txnId,
        attemptNo,
        attemptTimestamp,
        actionTaken: `${txn.paymentMode}_REPRESENTMENT_ATTEMPT_${attemptNo}`,
        result: AttemptResult.FAILED,
        feeCharged: attemptNo === 1 ? new Prisma.Decimal("0.00") : new Prisma.Decimal("25.00"),
      });
    }
  }

  await prisma.retryAttempt.createMany({
    data: retryAttemptsData,
  });
  console.log(`  ✓ Injected ${retryAttemptsData.length} RetryAttempts across 5 transactions.`);

  // 5. Console Breakdown Summary
  console.log("\n==================================================");
  console.log("               SEED SUMMARY BREAKDOWN             ");
  console.log("==================================================");

  const breakdown = await prisma.failedTransaction.groupBy({
    by: ["failCode", "trueReason", "isRecoverable"],
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
    breakdown.map((row) => ({
      "Fail Code": row.failCode,
      "True Reason": row.trueReason,
      "Is Recoverable": row.isRecoverable === null ? "null" : row.isRecoverable,
      "Count": row._count.txnId,
    }))
  );

  const totalTxns = await prisma.failedTransaction.count();
  const totalCustomers = await prisma.customerContext.count();
  const totalRetries = await prisma.retryAttempt.count();

  console.log(`Total Customer Contexts  : ${totalCustomers}`);
  console.log(`Total Failed Transactions: ${totalTxns}`);
  console.log(`Total Retry Attempts     : ${totalRetries}`);
  console.log("==================================================\n");
}

if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  seed()
    .catch((error) => {
      console.error("❌ Seed failed with error:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
