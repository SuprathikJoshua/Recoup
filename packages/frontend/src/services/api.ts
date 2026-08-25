import type {
  EngineSummaryReport,
  PaginatedTransactions,
  FailedTransactionDetail,
} from "../types/index.js";

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" && window.location.port === "5173"
    ? "http://localhost:3000"
    : "");

async function fetchJson<T>(endpoint: string): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API Error [${response.status}]: ${errorBody || response.statusText}`);
  }
  return response.json();
}

export async function fetchSummary(): Promise<EngineSummaryReport> {
  return fetchJson<EngineSummaryReport>("/api/summary");
}

export async function fetchTransactions(params: {
  status?: string;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<PaginatedTransactions> {
  const query = new URLSearchParams();
  if (params.status && params.status !== "ALL") {
    query.set("status", params.status);
  }
  if (params.page) {
    query.set("page", params.page.toString());
  }
  if (params.limit) {
    query.set("limit", params.limit.toString());
  }
  if (params.search && params.search.trim()) {
    query.set("search", params.search.trim());
  }

  const qs = query.toString();
  return fetchJson<PaginatedTransactions>(`/api/transactions${qs ? `?${qs}` : ""}`);
}

export async function fetchTransactionDetail(txnId: string): Promise<FailedTransactionDetail> {
  return fetchJson<FailedTransactionDetail>(`/api/transactions/${encodeURIComponent(txnId)}`);
}
