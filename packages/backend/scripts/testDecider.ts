import { classify } from "../src/classifier/classify.js";
import { decide } from "../src/decider/decide.js";
import { Prisma, AttemptResult, PaymentMode } from "../src/generated/prisma/client.js";

const fixedNow = new Date("2026-08-24T10:00:00.000Z");

const baseCustomer = {
  customerId: "CUST_0001",
  debitPatternDays: [1, 2, 3],
  pastSuccessTxnDates: [new Date("2026-07-01"), new Date("2026-06-01")],
  contactCountThisWeek: 0,
  mandateExpiryDate: new Date("2027-12-31"),
};

console.log("==================================================");
console.log("       RECOUP PHASE 2: DECIDER UNIT TESTS        ");
console.log("==================================================\n");

// Test Case 1: Exceeded RBI Attempt Cap (>= 3 attempts)
const test1Attempts = [
  { id: "1", txnId: "TXN_1", attemptNo: 1, attemptTimestamp: new Date("2026-08-01"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(0) },
  { id: "2", txnId: "TXN_1", attemptNo: 2, attemptTimestamp: new Date("2026-08-08"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(25) },
  { id: "3", txnId: "TXN_1", attemptNo: 3, attemptTimestamp: new Date("2026-08-15"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(25) },
];
const res1 = decide({
  paymentMode: PaymentMode.UPI_AUTOPAY,
  bucket: "INSUFFICIENT_FUND",
  confidence: 0.95,
  customer: baseCustomer,
  existingAttempts: test1Attempts,
  transactionAmount: new Prisma.Decimal(1000),
  now: fixedNow,
});
console.log("1. RBI Cap Test (3 attempts):");
console.log("   Result:", res1);

// Test Case 2: Attempted Too Soon (< 5 days)
const test2Attempts = [
  { id: "1", txnId: "TXN_2", attemptNo: 1, attemptTimestamp: new Date("2026-08-22T10:00:00.000Z"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(0) },
];
const res2 = decide({
  paymentMode: PaymentMode.UPI_AUTOPAY,
  bucket: "INSUFFICIENT_FUND",
  confidence: 0.95,
  customer: baseCustomer,
  existingAttempts: test2Attempts,
  transactionAmount: new Prisma.Decimal(1000),
  now: fixedNow,
});
console.log("\n2. Retry Too Soon Test (2 days ago < 5 days):");
console.log("   Result:", res2);

// Test Case 3: Exceeded Fee-to-Recovery Ratio (> 0.5)
const test3Attempts = [
  { id: "1", txnId: "TXN_3", attemptNo: 1, attemptTimestamp: new Date("2026-08-10"), actionTaken: "RETRY", result: AttemptResult.FAILED, feeCharged: new Prisma.Decimal(60) },
];
const res3 = decide({
  paymentMode: PaymentMode.UPI_AUTOPAY,
  bucket: "INSUFFICIENT_FUND",
  confidence: 0.95,
  customer: baseCustomer,
  existingAttempts: test3Attempts,
  transactionAmount: new Prisma.Decimal(100), // Fee is 60 / 100 = 0.6 > 0.5
  now: fixedNow,
});
console.log("\n3. Fee-to-Recovery Ratio Exceeded Test (₹60 fee on ₹100 txn):");
console.log("   Result:", res3);

// Test Case 4: Unknown Failure Code
const class4 = classify({ failCode: "ZZ" });
const res4 = decide({
  paymentMode: PaymentMode.UPI_AUTOPAY,
  bucket: class4.bucket,
  confidence: class4.confidence,
  customer: baseCustomer,
  existingAttempts: [],
  transactionAmount: new Prisma.Decimal(500),
  now: fixedNow,
});
console.log("\n4. Unknown Failure Code Test (failCode: 'ZZ'):");
console.log("   Classify:", class4);
console.log("   Result:", res4);

// Test Case 5: Low Confidence Escalation
const res5 = decide({
  paymentMode: PaymentMode.UPI_AUTOPAY,
  bucket: "INSUFFICIENT_FUND",
  confidence: 0.60, // < 0.70 threshold
  customer: baseCustomer,
  existingAttempts: [],
  transactionAmount: new Prisma.Decimal(500),
  now: fixedNow,
});
console.log("\n5. Low Confidence Classification Test (confidence: 0.60 < 0.70):");
console.log("   Result:", res5);

// Test Case 6: Weekly Contact Cap Reached
const cappedCustomer = { ...baseCustomer, contactCountThisWeek: 2 };
const res6 = decide({
  paymentMode: PaymentMode.UPI_AUTOPAY,
  bucket: "INSUFFICIENT_FUND",
  confidence: 0.95,
  customer: cappedCustomer,
  existingAttempts: [],
  transactionAmount: new Prisma.Decimal(500),
  now: fixedNow,
});
console.log("\n6. Customer Contact Cap Reached Test (contactCount: 2):");
console.log("   Result:", res6);

// Test Case 7: INSUFFICIENT_FUND Scheduled on Debit Pattern Day
const res7 = decide({
  paymentMode: PaymentMode.UPI_AUTOPAY,
  bucket: "INSUFFICIENT_FUND",
  confidence: 0.95,
  customer: { ...baseCustomer, debitPatternDays: [1, 2, 3] },
  existingAttempts: [],
  transactionAmount: new Prisma.Decimal(1500),
  now: fixedNow, // Aug 24 -> next match Sept 1
});
console.log("\n7. INSUFFICIENT_FUND Scheduling Test (Aug 24 -> pattern [1,2,3]):");
console.log("   Result:", res7);

// Test Case 8: Transient BANK_ERROR Fast Retry (+3h)
const class8 = classify({ failCode: "BE" });
const res8 = decide({
  paymentMode: PaymentMode.UPI_AUTOPAY,
  bucket: class8.bucket,
  confidence: class8.confidence,
  customer: baseCustomer,
  existingAttempts: [],
  transactionAmount: new Prisma.Decimal(800),
  now: fixedNow,
});
console.log("\n8. BANK_ERROR Fast Retry Test (+3 hours):");
console.log("   Classify:", class8);
console.log("   Result:", res8);

// Test Case 9: Hard Failures (MANDATE_EXPIRED, WRONG_ACCOUNT, FRAUD_BLOCK)
for (const code of ["MD", "WA", "FD"]) {
  const classified = classify({ failCode: code });
  const decision = decide({
    paymentMode: PaymentMode.UPI_AUTOPAY,
    bucket: classified.bucket,
    confidence: classified.confidence,
    customer: baseCustomer,
    existingAttempts: [],
    transactionAmount: new Prisma.Decimal(1200),
    now: fixedNow,
  });
  console.log(`\n9. Hard Failure Test for ${code} -> ${classified.bucket}:`);
  console.log("   Result:", decision);
}

console.log("\n==================================================");
console.log("             ALL TESTS RUN SUCCESSFULLY           ");
console.log("==================================================");
