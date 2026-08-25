import { prisma } from "../config/db.js";
import { TxnStatus, type FailedTransaction } from "../generated/prisma/client.js";

export interface LoadTransactionsOptions {
  limit?: number;
  offset?: number;
}

/**
 * Reads FailedTransaction rows in PENDING status from the database using Prisma.
 * Returns a strongly-typed array of FailedTransaction models.
 * 
 * @param options Optional pagination parameters (limit, offset)
 * @returns Array of pending FailedTransaction records ordered by failure timestamp
 */
export async function loadTransactions(
  options?: LoadTransactionsOptions
): Promise<FailedTransaction[]> {
  const queryArgs: Parameters<typeof prisma.failedTransaction.findMany>[0] = {
    where: {
      status: TxnStatus.PENDING,
    },
    orderBy: {
      failTimestamp: "asc",
    },
  };

  if (options?.limit !== undefined) {
    queryArgs.take = options.limit;
  }

  if (options?.offset !== undefined) {
    queryArgs.skip = options.offset;
  }

  return await prisma.failedTransaction.findMany(queryArgs);
}

export default loadTransactions;
