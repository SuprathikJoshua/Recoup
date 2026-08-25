export type PaymentMode = "UPI_AUTOPAY" | "NACH" | "EMANDATE";

export type TxnStatus =
  | "PENDING"
  | "RESOLVED_RECOVERED"
  | "RESOLVED_UNRECOVERABLE"
  | "ESCALATED"
  | "DEAD";

export type AttemptResult = "SUCCESS" | "FAILED" | "SKIPPED";

export interface FailedTransaction {
  id: string;
  txnId: string;
  customerId: string;
  merchantId: string;
  paymentMode: PaymentMode;
  amount: number | string;
  failTimestamp: string;
  failCode: string;
  trueReason: string;
  isRecoverable?: boolean | null;
  status: TxnStatus;
  createdAt: string;
}

export interface CustomerContext {
  customerId: string;
  debitPatternDays: number[];
  pastSuccessTxnDates: string[];
  contactCountThisWeek: number;
  mandateExpiryDate: string;
}

export interface RetryAttempt {
  id: string;
  txnId: string;
  attemptNo: number;
  attemptTimestamp: string;
  actionTaken: string;
  result: AttemptResult;
  feeCharged: number | string;
}

export interface AuditLog {
  id: string;
  txnId: string;
  timestamp: string;
  decisionType: string;
  reasonText: string;
  confidenceScore?: number | null;
}

export interface FailedTransactionDetail extends FailedTransaction {
  customerContext?: CustomerContext | null;
  retryAttempts: RetryAttempt[];
  auditLogs: AuditLog[];
}

export interface EscalatedException {
  txnId: string;
  customerId: string;
  amount: number;
  failCode: string;
  trueReason: string;
  reason: string;
}

export interface GuardRailTriggerCounts {
  rbiAttemptCap: number;
  minGapDays: number;
  feeToRecoveryRatio: number;
  contactCap: number;
  unknownCodeEscalation: number;
  lowConfidenceEscalation: number;
}

export interface DailyRecoveryStat {
  date: string;
  formattedDate: string;
  amount: number;
  count: number;
}

export interface EngineSummaryReport {
  totalRecovered: number;
  totalFeesSpent: number;
  netRecovered: number;
  classifierAccuracy: {
    totalNonEdgeCases: number;
    correctMatches: number;
    accuracyRatePercentage: number;
  };
  statusCounts: Record<string, number>;
  escalatedExceptions: EscalatedException[];
  guardRailTriggers: GuardRailTriggerCounts;
  dailyRecoveries?: DailyRecoveryStat[];
}

export interface PaginatedTransactions {
  data: FailedTransaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CaseExplanationResponse {
  txnId: string;
  explanation: string;
  source?: string;
}
