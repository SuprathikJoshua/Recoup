export interface ClassifyInput {
  failCode: string;
  daysToMandateExpiry?: number;       // computed from mandateExpiryDate
  pastSuccessTxnCount?: number;       // customer.pastSuccessTxnDates.length
}

export interface ClassifyResult {
  bucket: string;
  confidence: number;
  adjustmentReason?: string;
}

const FAIL_CODE_MAP: Record<string, { bucket: string; confidence: number }> = {
  "01": { bucket: "INSUFFICIENT_FUND", confidence: 0.95 },
  MD: { bucket: "MANDATE_EXPIRED", confidence: 0.95 },
  BE: { bucket: "BANK_ERROR", confidence: 0.85 },
  FD: { bucket: "FRAUD_BLOCK", confidence: 0.90 },
  WA: { bucket: "WRONG_ACCOUNT", confidence: 0.90 },
};

/**
 * Classifies a failure code into a standardized recovery bucket with a multi-factor confidence score.
 * Pure function with zero side-effects or external dependencies.
 * 
 * @param input Object containing the failure code and optional customer context factors
 * @returns Standardized bucket, multi-factor confidence level, and optional adjustment reason
 */
export function classify(input: ClassifyInput): ClassifyResult {
  const normalizedCode = input.failCode?.trim().toUpperCase();
  const matched = FAIL_CODE_MAP[normalizedCode];

  let bucket: string;
  let confidence: number;

  if (matched) {
    bucket = matched.bucket;
    confidence = matched.confidence;
  } else {
    bucket = "UNKNOWN";
    confidence = 0.30;
  }

  let adjustmentReason: string | undefined;

  // 1. INSUFFICIENT_FUND: boost confidence if customer has consistent past payment history
  if (
    bucket === "INSUFFICIENT_FUND" &&
    typeof input.pastSuccessTxnCount === "number" &&
    input.pastSuccessTxnCount >= 3
  ) {
    confidence += 0.03;
    adjustmentReason = "Frequent prior successes (>=3, +0.03)";
  }

  // 2. MANDATE_EXPIRED: adjust confidence based on distance to mandate expiry
  if (bucket === "MANDATE_EXPIRED" && typeof input.daysToMandateExpiry === "number") {
    if (input.daysToMandateExpiry < -30) {
      confidence += 0.03;
      adjustmentReason = "Mandate expired >30 days ago (+0.03)";
    } else if (input.daysToMandateExpiry >= -5 && input.daysToMandateExpiry <= 0) {
      confidence -= 0.05;
      adjustmentReason = "Mandate expired within last 5 days (-0.05)";
    }
  }

  // 3. Clamp final confidence: Math.min(0.98, Math.max(0.10, confidence))
  const roundedConfidence = Math.round(confidence * 100) / 100;
  confidence = Math.min(0.98, Math.max(0.10, roundedConfidence));

  return {
    bucket,
    confidence,
    ...(adjustmentReason ? { adjustmentReason } : {}),
  };
}

export default classify;
