import { prisma } from "../config/db.js";
import type { AuditLog } from "../generated/prisma/client.js";

/**
 * Creates an immutable AuditLog record in the database.
 * 
 * @param txnId Unique transaction identifier
 * @param decisionType Decision or execution event type (e.g., CLASSIFY, ACTION_DECIDE, EXECUTE_RETRY)
 * @param reasonText Explanation or context for the decision
 * @param confidenceScore Optional confidence score of the decision
 * @returns The created AuditLog record
 */
export async function logAudit(
  txnId: string,
  decisionType: string,
  reasonText: string,
  confidenceScore?: number
): Promise<AuditLog> {
  return await prisma.auditLog.create({
    data: {
      txnId,
      decisionType,
      reasonText,
      confidenceScore: confidenceScore ?? null,
    },
  });
}

export default logAudit;
