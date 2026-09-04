import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../config/db.js";
import { getEngineSummary } from "./summaryService.js";
import { processTransaction } from "../engine/processTransaction.js";
import {
  TxnStatus,
  PaymentMode,
  Prisma,
} from "../generated/prisma/client.js";

interface TransactionsQuery {
  status?: TxnStatus;
  page?: string;
  limit?: string;
  search?: string;
}

interface TransactionParams {
  txnId: string;
}

/**
 * Deterministic fallback generator for plain-English explanations when
 * ANTHROPIC_API_KEY is unavailable or for local testing.
 */
function generateFallbackExplanation(
  txn: {
    txnId: string;
    customerId: string;
    amount: unknown;
    paymentMode: string;
    status: string;
    failCode: string;
    trueReason: string;
  },
  auditLogs: { decisionType: string; reasonText: string; timestamp: Date }[],
  retryAttempts: { attemptNo: number; actionTaken: string; result: string; feeCharged: unknown }[]
): string {
  const formattedAmount = Number(txn.amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
  });

  const lastAudit = auditLogs.length > 0 ? auditLogs[auditLogs.length - 1] : null;
  const successAttempt = retryAttempts.find((r) => r.result === "SUCCESS");

  if (txn.status === "RESOLVED_RECOVERED" && successAttempt) {
    return `Payment of ₹${formattedAmount} via ${txn.paymentMode} initially failed due to ${txn.trueReason.toLowerCase().replace(/_/g, " ")} (${txn.failCode}). The recovery engine scheduled an automated retry (Attempt #${successAttempt.attemptNo}) which successfully collected the full amount without customer friction.`;
  }

  if (txn.status === "ESCALATED") {
    return `The payment of ₹${formattedAmount} encountered an ambiguous failure code (${txn.failCode}). To safeguard merchant margins and prevent unauthorized retries, the autonomous engine paused execution and escalated this case for human operational review.`;
  }

  if (txn.status === "RESOLVED_UNRECOVERABLE") {
    return `This payment failed with error code ${txn.failCode} (${txn.trueReason.replace(/_/g, " ")}), which indicates a permanent block or expired mandate. The engine identified this immediately and avoided incurring futile retry fees.`;
  }

  if (txn.status === "DEAD") {
    return `Payment recovery for ₹${formattedAmount} was halted after reaching the statutory maximum of 3 retry attempts under RBI compliance rules. No further retries will be executed for this invoice.`;
  }

  if (lastAudit) {
    return `Transaction ${txn.txnId} for ₹${formattedAmount} is actively handled by the recovery engine. ${lastAudit.reasonText}`;
  }

  return `The transaction of ₹${formattedAmount} failed with code ${txn.failCode}. The autonomous recovery pipeline is evaluating customer context and scheduling optimal representment.`;
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

  /**
   * GET /api/transactions/:txnId/explain
   * Explainability layer: Fetches the transaction and its AuditLog history,
   * calls Anthropic Claude to generate a 2-3 sentence plain-English merchant summary.
   * Strict constraint: Narrates already-completed decisions only; no execution influence.
   */
  fastify.get<{ Params: TransactionParams }>("/api/transactions/:txnId/explain", async (request, reply) => {
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

      const [auditLogs, retryAttempts] = await Promise.all([
        prisma.auditLog.findMany({
          where: { txnId },
          orderBy: { timestamp: "asc" },
        }),
        prisma.retryAttempt.findMany({
          where: { txnId },
          orderBy: { attemptNo: "asc" },
        }),
      ]);

      const apiKey = process.env.ANTHROPIC_API_KEY;

      if (apiKey && apiKey.trim().length > 0 && apiKey !== "mock_key") {
        try {
          const anthropic = new Anthropic({ apiKey });

          const logSummary = auditLogs
            .map(
              (log) =>
                `[${new Date(log.timestamp).toISOString()}] [${log.decisionType}] ${log.reasonText}${
                  log.confidenceScore !== null ? ` (confidence: ${log.confidenceScore})` : ""
                }`
            )
            .join("\n");

          const retrySummary = retryAttempts
            .map(
              (att) =>
                `Attempt #${att.attemptNo} on ${new Date(att.attemptTimestamp).toISOString()}: ${
                  att.actionTaken
                } -> Result: ${att.result} (Fee Charged: ₹${Number(att.feeCharged).toFixed(2)})`
            )
            .join("\n");

          const promptContent = `Transaction Metadata:
- Transaction ID: ${txn.txnId}
- Customer ID: ${txn.customerId}
- Merchant ID: ${txn.merchantId}
- Amount: ₹${Number(txn.amount).toFixed(2)}
- Payment Mode: ${txn.paymentMode}
- Failure Code: ${txn.failCode}
- Root Cause: ${txn.trueReason}
- Final Status: ${txn.status}

Audit Log Trail:
${logSummary || "No explicit audit entries recorded."}

Retry Attempt History:
${retrySummary || "No retry attempts executed."}`;

          const messageResponse = await anthropic.messages.create({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 300,
            system:
              "You are explaining a payment-recovery decision to a non-technical merchant. Given this audit log, write 2-3 plain-English sentences on what happened and why.",
            messages: [
              {
                role: "user",
                content: promptContent,
              },
            ],
          });

          const firstBlock = messageResponse.content[0];
          const explanation =
            firstBlock && firstBlock.type === "text"
              ? firstBlock.text.trim()
              : generateFallbackExplanation(txn, auditLogs, retryAttempts);

          return reply.send({
            txnId: txn.txnId,
            explanation,
            source: "anthropic-claude",
          });
        } catch (llmError) {
          fastify.log.warn(llmError, "Anthropic API invocation failed, falling back to deterministic explanation");
          const fallback = generateFallbackExplanation(txn, auditLogs, retryAttempts);
          return reply.send({
            txnId: txn.txnId,
            explanation: fallback,
            source: "rules-engine-fallback",
          });
        }
      }

      // Fallback when ANTHROPIC_API_KEY is not configured
      const explanation = generateFallbackExplanation(txn, auditLogs, retryAttempts);
      return reply.send({
        txnId: txn.txnId,
        explanation,
        source: "rules-engine-fallback",
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Failed to generate case explanation",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/demo/inject-failure
   * Injects a single live failed transaction into the database and processes it through the pipeline in real time.
   */
  fastify.post<{ Body?: { failCode?: string } }>("/api/demo/inject-failure", async (request, reply) => {
    try {
      const requestedCode = request.body?.failCode?.trim().toUpperCase();

      const KNOWN_DEMO_CODES = ["01", "MD", "BE", "FD", "WA"];
      const UNKNOWN_DEMO_CODES = [
        "ZZ",
        "99X",
        "ERR_UNKNOWN",
        "U99",
        "INVALID_RESP",
        "E_CORRUPT_PKT",
      ];

      const CODE_REASON_MAP: Record<string, { trueReason: string; isRecoverable: boolean | null }> = {
        "01": { trueReason: "INSUFFICIENT_FUND", isRecoverable: true },
        MD: { trueReason: "MANDATE_EXPIRED", isRecoverable: false },
        BE: { trueReason: "BANK_ERROR", isRecoverable: true },
        FD: { trueReason: "FRAUD_BLOCK", isRecoverable: false },
        WA: { trueReason: "WRONG_ACCOUNT", isRecoverable: false },
      };

      const DEMO_MERCHANTS = [
        "MERCH_STREAM_PLUS",
        "MERCH_FITNESS_CLUB",
        "MERCH_INSURANCE_LTD",
        "MERCH_BROADBAND_FIBER",
        "MERCH_EDTECH_LEARN",
        "MERCH_FINTECH_CREDIT",
        "MERCH_POWER_UTILITY",
        "MERCH_SAAS_CLOUD",
      ];

      const DEMO_PAYMENT_MODES: PaymentMode[] = [
        PaymentMode.UPI_AUTOPAY,
        PaymentMode.NACH,
        PaymentMode.EMANDATE,
      ];

      let failCode: string;
      if (requestedCode && requestedCode.length > 0) {
        failCode = requestedCode;
      } else {
        // ~30% chance of an unknown / garbage code to deliberately demo escalation guard-rail
        const isUnknown = Math.random() < 0.30;
        if (isUnknown) {
          failCode = UNKNOWN_DEMO_CODES[Math.floor(Math.random() * UNKNOWN_DEMO_CODES.length)]!;
        } else {
          failCode = KNOWN_DEMO_CODES[Math.floor(Math.random() * KNOWN_DEMO_CODES.length)]!;
        }
      }

      // Query random existing customer
      const existingCustomers = await prisma.customerContext.findMany({
        select: { customerId: true },
        take: 50,
      });

      const customerId =
        existingCustomers.length > 0
          ? existingCustomers[Math.floor(Math.random() * existingCustomers.length)]!.customerId
          : "CUST_0001";

      const merchantId = DEMO_MERCHANTS[Math.floor(Math.random() * DEMO_MERCHANTS.length)]!;
      const paymentMode = DEMO_PAYMENT_MODES[Math.floor(Math.random() * DEMO_PAYMENT_MODES.length)]!;

      // Realistic random transaction amount (₹500 to ₹5,000)
      const randomAmountNum = Math.floor(Math.random() * 450000 + 50000) / 100;
      const amount = new Prisma.Decimal(randomAmountNum.toFixed(2));

      const reasonMeta = CODE_REASON_MAP[failCode] || {
        trueReason: "UNKNOWN",
        isRecoverable: null,
      };

      const txnId = `TXN_LIVE_${Date.now().toString(36).toUpperCase()}_${Math.floor(1000 + Math.random() * 9000)}`;

      // 1. Create fresh FailedTransaction record
      const newTxn = await prisma.failedTransaction.create({
        data: {
          txnId,
          customerId,
          merchantId,
          paymentMode,
          amount,
          failTimestamp: new Date(),
          failCode,
          trueReason: reasonMeta.trueReason,
          isRecoverable: reasonMeta.isRecoverable,
          status: TxnStatus.PENDING,
        },
      });

      // 2. Immediately execute through shared pipeline
      const pipelineResult = await processTransaction(newTxn);

      return reply.status(201).send({
        success: true,
        result: pipelineResult,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Failed to inject live demo transaction",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
};

export default apiRoutes;
