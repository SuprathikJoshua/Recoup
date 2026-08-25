import type { TxnStatus, AttemptResult } from "../types/index.js";

export function StatusBadge({ status }: { status: TxnStatus | string }) {
  switch (status) {
    case "RESOLVED_RECOVERED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          Recovered
        </span>
      );
    case "PENDING":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          Pending
        </span>
      );
    case "ESCALATED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-950/80 text-purple-300 border border-purple-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
          Escalated
        </span>
      );
    case "RESOLVED_UNRECOVERABLE":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
          Unrecoverable
        </span>
      );
    case "DEAD":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
          Dead (Cap Reached)
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
          {status}
        </span>
      );
  }
}

export function AttemptBadge({ result }: { result: AttemptResult | string }) {
  switch (result) {
    case "SUCCESS":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-600/40">
          SUCCESS
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-950 text-rose-300 border border-rose-600/40">
          FAILED
        </span>
      );
    case "SKIPPED":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-600/40">
          SKIPPED
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300">
          {result}
        </span>
      );
  }
}

export function PaymentModeBadge({ mode }: { mode: string }) {
  const modeColors: Record<string, string> = {
    UPI_AUTOPAY: "text-cyan-300 bg-cyan-950/60 border-cyan-700/40",
    NACH: "text-indigo-300 bg-indigo-950/60 border-indigo-700/40",
    EMANDATE: "text-violet-300 bg-violet-950/60 border-violet-700/40",
  };

  const style = modeColors[mode] || "text-slate-300 bg-slate-800 border-slate-700";

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded font-mono text-xs border ${style}`}>
      {mode}
    </span>
  );
}
