import { useEffect, useState } from "react";
import { fetchTransactions } from "../services/api.js";
import type { FailedTransaction } from "../types/index.js";
import { StatusBadge, PaymentModeBadge } from "../components/StatusBadge.js";
import {
  SearchIcon,
  RefreshIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  AlertTriangleIcon,
} from "../components/Icons.js";

interface CaseListProps {
  initialStatusFilter?: string;
  onNavigateToDetail: (txnId: string) => void;
}

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: "All Statuses", value: "ALL" },
  { label: "Recovered", value: "RESOLVED_RECOVERED" },
  { label: "Pending Scheduled", value: "PENDING" },
  { label: "Escalated to Ops", value: "ESCALATED" },
  { label: "Unrecoverable", value: "RESOLVED_UNRECOVERABLE" },
  { label: "Dead (Cap Reached)", value: "DEAD" },
];

export function CaseList({ initialStatusFilter = "ALL", onNavigateToDetail }: CaseListProps) {
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(15);

  const [transactions, setTransactions] = useState<FailedTransaction[]>([]);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadCases = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchTransactions({
        status: statusFilter,
        page,
        limit,
        search: searchTerm,
      });
      setTransactions(res.data);
      setTotalPages(res.pagination.totalPages || 1);
      setTotalRecords(res.pagination.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchTerm]);

  useEffect(() => {
    loadCases();
  }, [statusFilter, searchTerm, page]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Case Registry & Pipeline
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse and inspect all failed transaction recovery lifecycle states.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadCases}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer disabled:opacity-50"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search Txn ID, Customer, Fail Code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-800/80 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        {/* Status Dropdown Filter */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <label className="text-xs font-semibold text-slate-400 whitespace-nowrap">Filter Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer w-full md:w-auto"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {statusFilter !== "ALL" && (
            <button
              onClick={() => setStatusFilter("ALL")}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium underline cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="w-5 h-5 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={loadCases}
            className="px-3 py-1 bg-rose-900 text-white rounded font-medium cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Table Container */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
              <tr>
                <th className="py-3.5 px-4">Transaction ID</th>
                <th className="py-3.5 px-4">Customer ID</th>
                <th className="py-3.5 px-4">Mode</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Failure Code</th>
                <th className="py-3.5 px-4">True Root Cause</th>
                <th className="py-3.5 px-4">Recovery Status</th>
                <th className="py-3.5 px-4">Failed At</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    Loading cases...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 text-sm">
                    No transactions match the selected criteria.
                  </td>
                </tr>
              ) : (
                transactions.map((txn) => (
                  <tr
                    key={txn.txnId}
                    className="hover:bg-slate-800/40 transition group cursor-pointer"
                    onClick={() => onNavigateToDetail(txn.txnId)}
                  >
                    <td className="py-3.5 px-4 font-mono font-semibold text-indigo-300 group-hover:text-indigo-200">
                      {txn.txnId}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {txn.customerId}
                    </td>
                    <td className="py-3.5 px-4">
                      <PaymentModeBadge mode={txn.paymentMode} />
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">
                      ₹{Number(txn.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-mono px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-200 border border-slate-700">
                        {txn.failCode}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-400 text-[11px]">
                      {txn.trueReason}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={txn.status} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                      {new Date(txn.failTimestamp).toLocaleString("en-IN", {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToDetail(txn.txnId);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-indigo-600 group-hover:bg-indigo-600 text-slate-200 group-hover:text-white font-medium transition cursor-pointer"
                      >
                        Inspect →
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 bg-slate-800/40 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div>
            Showing <span className="text-white font-semibold">{transactions.length}</span> of{" "}
            <span className="text-white font-semibold">{totalRecords}</span> total transactions
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" />
              Previous
            </button>
            <span className="px-3 py-1 bg-slate-900 border border-slate-700 rounded-lg text-slate-300 font-mono">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Next
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
