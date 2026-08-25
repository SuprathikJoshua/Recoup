import { prisma } from "./db.js";

export interface ResetContactsResult {
  count: number;
}

/**
 * Resets the weekly customer contact counters back to 0 for all customer profiles.
 * Implements Guard-rail 10 weekly contact reset support.
 * 
 * @returns Object containing the count of updated CustomerContext rows
 */
export async function resetWeeklyContactCounts(): Promise<ResetContactsResult> {
  const result = await prisma.customerContext.updateMany({
    data: {
      contactCountThisWeek: 0,
    },
  });

  return {
    count: result.count,
  };
}

export default resetWeeklyContactCounts;
