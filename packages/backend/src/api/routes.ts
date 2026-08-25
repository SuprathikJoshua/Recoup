import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { prisma } from "../config/db.js";
import { getEngineSummary } from "./summaryService.js";
import type { TxnStatus } from "../generated/prisma/client.js";

interface TransactionsQuery {
  status?: TxnStatus;
  page?: string;
  limit?: string;
  search?: string;
}

interface TransactionParams {
  txnId: string;
}

export const apiRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * GET /api/summary
   * Returns aggregated recovery metrics, classifier match rate, guard-rail triggers, and escalated cases.
   */
  fastify.get("/api/summary", async (_request, reply) => {
    try {
      const summary = await getEngineSummary();
      return reply.send(summary);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Failed to generate engine summary",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/transactions
   * Returns a paginated list of failed transactions with optional status and search filters.
   */
  fastify.get<{ Querystring: TransactionsQuery }>("/api/transactions", async (request, reply) => {
    try {
      const { status, page = "1", limit = "20", search } = request.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
      const skip = (pageNum - 1) * limitNum;

      const whereClause: Record<string, unknown> = {};

      if (status) {
        whereClause.status = status;
      }

      if (search && search.trim().length > 0) {
        const query = search.trim();
        whereClause.OR = [
          { txnId: { contains: query, mode: "insensitive" } },
          { customerId: { contains: query, mode: "insensitive" } },
          { failCode: { contains: query, mode: "insensitive" } },
        ];
      }

      const [total, transactions] = await Promise.all([
        prisma.failedTransaction.count({ where: whereClause }),
        prisma.failedTransaction.findMany({
          where: whereClause,
          orderBy: { failTimestamp: "desc" },
          skip,
          take: limitNum,
        }),
      ]);

      return reply.send({
        data: transactions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Failed to retrieve transactions",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/transactions/:txnId
   * Returns a single FailedTransaction with full relation tree (CustomerContext, RetryAttempts, and AuditLogs).
   */
  fastify.get<{ Params: TransactionParams }>("/api/transactions/:txnId", async (request, reply) => {
    try {
      const { txnId } = request.params;

      const txn = await prisma.failedTransaction.findUnique({
        where: { txnId },
      });

      if (!txn) {
        return reply.status(404).send({
          error: "Transaction Not Found",
          message: `No transaction found with txnId '${txnId}'`,
        });
      }

      const [customerContext, retryAttempts, auditLogs] = await Promise.all([
        prisma.customerContext.findUnique({
          where: { customerId: txn.customerId },
        }),
        prisma.retryAttempt.findMany({
          where: { txnId },
          orderBy: { attemptNo: "asc" },
        }),
        prisma.auditLog.findMany({
          where: { txnId },
          orderBy: { timestamp: "asc" },
        }),
      ]);

      return reply.send({
        ...txn,
        customerContext: customerContext ?? null,
        retryAttempts,
        auditLogs,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Failed to retrieve transaction details",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
};

export default apiRoutes;
