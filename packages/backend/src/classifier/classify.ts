export interface ClassifyInput {
  failCode: string;
}

export interface ClassifyResult {
  bucket: string;
  confidence: number;
}

const FAIL_CODE_MAP: Record<string, { bucket: string; confidence: number }> = {
  "01": { bucket: "INSUFFICIENT_FUND", confidence: 0.95 },
  MD: { bucket: "MANDATE_EXPIRED", confidence: 0.95 },
  BE: { bucket: "BANK_ERROR", confidence: 0.85 },
  FD: { bucket: "FRAUD_BLOCK", confidence: 0.90 },
  WA: { bucket: "WRONG_ACCOUNT", confidence: 0.90 },
};

/**
 * Classifies a failure code into a standardized recovery bucket with a confidence score.
 * Pure function with zero side-effects or external dependencies.
 * 
 * @param input Object containing the failure code
 * @returns Standardized bucket and confidence level
 */
export function classify(input: ClassifyInput): ClassifyResult {
  const normalizedCode = input.failCode?.trim().toUpperCase();
  const matched = FAIL_CODE_MAP[normalizedCode];

  if (matched) {
    return {
      bucket: matched.bucket,
      confidence: matched.confidence,
    };
  }

  return {
    bucket: "UNKNOWN",
    confidence: 0.30,
  };
}

export default classify;
