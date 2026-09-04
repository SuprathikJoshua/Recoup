import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { fetchSummary, injectLiveFailure } from "../services/api.js";
import type { EngineSummaryReport, LiveDemoResult } from "../types/index.js";
import {
  ShieldCheckIcon,
  ActivityIcon,
  RefreshIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  BoltIcon,
  CloseIcon,
} from "../components/Icons.js";

interface OverviewProps {
  onNavigateToCases: (statusFilter?: string) => void;
  onNavigateToDetail: (txnId: string) => void;
}

// Custom Tooltip for 30-Day Recovery Trend
interface TrendTooltipPayload {
  payload?: {
    formattedDate: string;
    amount: number;
    count: number;
  };
}

function TrendCustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TrendTooltipPayload[];
}) {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl text-xs space-y-1">
        <p className="font-semibold text-slate-300">{data.formattedDate}</p>
        <p className="text-emerald-400 font-bold text-sm">
          ₹{Number(data.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
        </p>
        <p className="text-[11px] text-slate-400">
          {data.count} {data.count === 1 ? "transaction" : "transactions"} settled
        </p>
      </div>
    );
  }
  return null;
}

// Custom Tooltip for Donut Chart
interface PieTooltipPayload {
  name?: string;
  value?: number;
  payload?: {
    color: string;
    pct: number;
  };
}

function OutcomeCustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: PieTooltipPayload[];
}) {
  if (active && payload && payload.length) {
    const data = payload[0];
    if (!data) return null;
    return (
      <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-xl shadow-2xl text-xs space-y-0.5">
        <p className="font-bold text-white">{data.name}</p>
        <p className="text-slate-300">
          Count: <span className="font-mono font-semibold">{data.value}</span> ({data.payload?.pct.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
}

// Custom Tooltip for Guard-Rail Bar Chart
interface BarTooltipPayload {
  payload?: {
    name: string;
    fullTitle: string;
    triggers: number;
    description: string;
  };
}

function GuardRailCustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: BarTooltipPayload[];
}) {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl text-xs space-y-1 max-w-[220px]">
        <p className="font-bold text-white">{data.fullTitle}</p>
        <p className="text-indigo-400 font-semibold font-mono text-sm">
          {data.triggers} Triggers Enforced
        </p>
        <p className="text-[11px] text-slate-400 leading-snug">{data.description}</p>
      </div>
    );
  }
  return null;
}

export function Overview({
  onNavigateToCases,
  onNavigateToDetail,
}: OverviewProps) {
  const [summary, setSummary] = useState<EngineSummaryReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Live Demo Injection state
  const [showDemoModal, setShowDemoModal] = useState<boolean>(false);
  const [demoFailCode, setDemoFailCode] = useState<string>("");
  const [injecting, setInjecting] = useState<boolean>(false);
  const [demoResult, setDemoResult] = useState<LiveDemoResult | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number>(0);

  const handleInject = async () => {
    try {
      setInjecting(true);
      setDemoError(null);
      setDemoResult(null);
      setActiveStep(1);

      const response = await injectLiveFailure(demoFailCode || undefined);

      setTimeout(() => setActiveStep(2), 250);
      setTimeout(() => setActiveStep(3), 500);
      setTimeout(() => {
        setActiveStep(4);
        setDemoResult(response.result);
        setInjecting(false);
        loadData();
      }, 750);
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : "Failed to inject live demo failure");
      setInjecting(false);
      setActiveStep(0);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSummary();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading && !summary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-400">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium text-slate-300">
          Computing Recoup Engine Performance Summary...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-200">
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangleIcon className="w-6 h-6 text-rose-400" />
          <h3 className="text-lg font-bold">Failed to load recovery metrics</h3>
        </div>
        <p className="text-sm text-rose-300/80 mb-4">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-rose-900 hover:bg-rose-800 text-white rounded-lg text-sm font-medium transition cursor-pointer"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!summary) return null;

  const totalCases = Object.values(summary.statusCounts).reduce(
    (a, b) => a + b,
    0
  );

  // 1. Chart 1 Data: ₹ Recovered over last 30 days (bucketed by failTimestamp)
  const recoveryTrendData = summary.dailyRecoveries && summary.dailyRecoveries.length > 0
    ? summary.dailyRecoveries
    : Array.from({ length: 30 }).map((_, i) => {
        const d = new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000);
        return {
          date: d.toISOString().split("T")[0]!,
          formattedDate: d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
          amount: 0,
          count: 0,
        };
      });

  const peakDay = recoveryTrendData.reduce(
    (max, d) => (d.amount > max.amount ? d : max),
    recoveryTrendData[0] || { amount: 0, formattedDate: "N/A" }
  );

  // 2. Chart 2 Data: Case Outcome Breakdown (recovered / unrecoverable / escalated / dead / pending)
  const outcomePieData = [
    {
      name: "Recovered",
      value: summary.statusCounts["RESOLVED_RECOVERED"] || 0,
      color: "#10b981", // Emerald
      pct: totalCases > 0 ? ((summary.statusCounts["RESOLVED_RECOVERED"] || 0) / totalCases) * 100 : 0,
    },
    {
      name: "Unrecoverable",
      value: summary.statusCounts["RESOLVED_UNRECOVERABLE"] || 0,
      color: "#f43f5e", // Rose
      pct: totalCases > 0 ? ((summary.statusCounts["RESOLVED_UNRECOVERABLE"] || 0) / totalCases) * 100 : 0,
    },
    {
      name: "Escalated",
      value: summary.statusCounts["ESCALATED"] || 0,
      color: "#a855f7", // Purple
      pct: totalCases > 0 ? ((summary.statusCounts["ESCALATED"] || 0) / totalCases) * 100 : 0,
    },
    {
      name: "Dead (Cap Reached)",
      value: summary.statusCounts["DEAD"] || 0,
      color: "#64748b", // Slate
      pct: totalCases > 0 ? ((summary.statusCounts["DEAD"] || 0) / totalCases) * 100 : 0,
    },
    {
      name: "Pending Retries",
      value: summary.statusCounts["PENDING"] || 0,
      color: "#f59e0b", // Amber
      pct: totalCases > 0 ? ((summary.statusCounts["PENDING"] || 0) / totalCases) * 100 : 0,
    },
  ].filter((item) => item.value > 0);

  // 3. Chart 3 Data: Guard-Rail Trigger Counts
  const guardRailBarData = [
    {
      name: "RBI Cap",
      fullTitle: "RBI 3-Attempt Cap",
      triggers: summary.guardRailTriggers.rbiAttemptCap,
      color: "#ef4444",
      description: "Halted retries exceeding statutory limit.",
    },
    {
      name: "5-Day Gap",
      fullTitle: "Minimum 5-Day Gap",
      triggers: summary.guardRailTriggers.minGapDays,
      color: "#f59e0b",
      description: "Prevented rapid successive attempts.",
    },
    {
      name: "Fee/Rec >50%",
      fullTitle: "Fee-to-Recovery Cap (>50%)",
      triggers: summary.guardRailTriggers.feeToRecoveryRatio,
      color: "#10b981",
      description: "Protected margins against excessive bank fees.",
    },
    {
      name: "Contact Cap",
      fullTitle: "Customer Contact Cap (≥2/wk)",
      triggers: summary.guardRailTriggers.contactCap,
      color: "#8b5cf6",
      description: "Suppressed nudge spam to prevent harassment.",
    },
    {
      name: "Unknown Code",
      fullTitle: "Unknown Code Escalation",
      triggers: summary.guardRailTriggers.unknownCodeEscalation,
      color: "#ec4899",
      description: "Routed unmapped NPCI/Bank codes to human review.",
    },
    {
      name: "Low Conf.",
      fullTitle: "Low Confidence Filter",
      triggers: summary.guardRailTriggers.lowConfidenceEscalation,
      color: "#06b6d4",
      description: "Escalated ambiguous classification scores.",
    },
  ];

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Recovery Intelligence Engine
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time telemetry, classifier accuracy, and automated guard-rail
            enforcement.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDemoModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-white text-xs font-bold shadow-lg shadow-orange-500/25 transition cursor-pointer"
          >
            <BoltIcon className="w-3.5 h-3.5 text-amber-100" />
            Inject Live Failure
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer disabled:opacity-50"
          >
            <RefreshIcon
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh Telemetry
          </button>
          <button
            onClick={() => onNavigateToCases()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition cursor-pointer"
          >
            View All Cases
            <ArrowRightIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4 Headline Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Gross Recovered */}
        <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Gross Recovered</span>
            <span className="p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 font-bold">
              ₹
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            ₹
            {summary.totalRecovered.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
            })}
          </div>
          <div className="mt-3 flex items-center text-xs text-emerald-400 font-medium">
            <CheckCircleIcon className="w-4 h-4 mr-1 text-emerald-400 inline" />
            {summary.statusCounts["RESOLVED_RECOVERED"] || 0} successfully settled cases
          </div>
        </div>

        {/* Net Recovered */}
        <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Net Recovered</span>
            <ActivityIcon className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-300 tracking-tight">
            ₹
            {summary.netRecovered.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
            })}
          </div>
          <div className="mt-3 text-xs text-slate-400 flex items-center justify-between">
            <span>Total Fees Spent:</span>
            <span className="font-mono text-slate-300 font-medium">
              ₹
              {summary.totalFeesSpent.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>

        {/* Classifier Match Rate % */}
        <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Classifier Match Rate</span>
            <span className="p-1 rounded-md bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 font-mono text-[10px]">
              AI/RULE
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-cyan-300 tracking-tight">
            {summary.classifierAccuracy.accuracyRatePercentage}%
          </div>
          <div className="mt-3 text-xs text-slate-400">
            <span className="text-cyan-400 font-semibold">
              {summary.classifierAccuracy.correctMatches}
            </span>{" "}
            of{" "}
            <span className="text-slate-300">
              {summary.classifierAccuracy.totalNonEdgeCases}
            </span>{" "}
            evaluated root causes
          </div>
        </div>

        {/* Total Cases Pipeline */}
        <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Total Pipeline Cases</span>
            <ShieldCheckIcon className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            {totalCases}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="text-xs text-slate-300">
              {(
                ((summary.statusCounts["RESOLVED_RECOVERED"] || 0) /
                  (totalCases || 1)) *
                100
              ).toFixed(1)}
              % recovery rate
            </span>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* PHASE 6 CHARTS: RECHARTS VISUALIZATION SUITE             */}
      {/* ======================================================== */}
      <div className="space-y-6">
        {/* CHART 1: 30-Day Recovery Trajectory (Area / Line Chart) */}
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-950/80 border border-emerald-700/40 text-emerald-400 font-bold text-xs">
                  ₹ TREND
                </span>
                <h2 className="text-base font-bold text-white">
                  30-Day ₹ Recovered Trajectory
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Measured daily recovery volume bucketed by transaction failure date.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
                Peak Day: <span className="text-emerald-400 font-semibold">{peakDay.formattedDate}</span> (₹{Number(peakDay.amount).toLocaleString("en-IN")})
              </span>
            </div>
          </div>

          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={recoveryTrendData}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="recoveredGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis
                  dataKey="formattedDate"
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  interval={4}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(val) =>
                    `₹${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`
                  }
                />
                <Tooltip content={<TrendCustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="amount"
                  name="₹ Recovered"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#recoveredGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2-COLUMN GRID FOR CHART 2 & CHART 3 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CHART 2: Donut Chart for Case Outcome Breakdown */}
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl flex flex-col justify-between">
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-md bg-indigo-950/80 border border-indigo-700/40 text-indigo-300 font-mono text-[10px]">
                    OUTCOMES
                  </span>
                  <h2 className="text-base font-bold text-white">
                    Case Outcome Breakdown
                  </h2>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {totalCases} Total Cases
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Distribution across Recovered, Unrecoverable, Escalated, and Dead status states.
              </p>
            </div>

            <div className="h-[240px] w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={outcomePieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                  >
                    {outcomePieData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        stroke="#0f172a"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<OutcomeCustomTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => (
                      <span className="text-[11px] text-slate-300 font-medium">
                        {value}
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* CHART 3: Bar Chart for Guard-Rail Trigger Counts */}
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl flex flex-col justify-between">
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-md bg-purple-950/80 border border-purple-700/40 text-purple-300 font-mono text-[10px]">
                    SAFETY
                  </span>
                  <h2 className="text-base font-bold text-white">
                    Guard-Rail Trigger Counts
                  </h2>
                </div>
                <span className="text-xs font-mono text-purple-300 bg-purple-950 px-2 py-0.5 rounded border border-purple-800/50">
                  6 Policy Rules
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Autonomous safety rules invoked to protect compliance and merchant margins.
              </p>
            </div>

            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={guardRailBarData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis
                    dataKey="name"
                    stroke="#94a3b8"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                  />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip content={<GuardRailCustomTooltip />} />
                  <Bar dataKey="triggers" radius={[4, 4, 0, 0]}>
                    {guardRailBarData.map((entry, index) => (
                      <Cell key={`bar-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Status Breakdown & Guard-Rail Enforcement Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Distribution */}
        <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
          <h2 className="text-base font-bold text-white mb-4 flex items-center justify-between">
            <span>Status Breakdown</span>
            <span className="text-xs font-normal text-slate-400">
              Click to filter
            </span>
          </h2>
          <div className="space-y-3">
            {[
              {
                status: "RESOLVED_RECOVERED",
                label: "Recovered",
                count: summary.statusCounts["RESOLVED_RECOVERED"] || 0,
                color: "bg-emerald-500",
                textColor: "text-emerald-400",
              },
              {
                status: "PENDING",
                label: "Pending Scheduled",
                count: summary.statusCounts["PENDING"] || 0,
                color: "bg-amber-500",
                textColor: "text-amber-400",
              },
              {
                status: "ESCALATED",
                label: "Escalated to Ops",
                count: summary.statusCounts["ESCALATED"] || 0,
                color: "bg-purple-500",
                textColor: "text-purple-400",
              },
              {
                status: "RESOLVED_UNRECOVERABLE",
                label: "Unrecoverable (Technical/Account)",
                count: summary.statusCounts["RESOLVED_UNRECOVERABLE"] || 0,
                color: "bg-rose-500",
                textColor: "text-rose-400",
              },
              {
                status: "DEAD",
                label: "Dead (Cap Reached)",
                count: summary.statusCounts["DEAD"] || 0,
                color: "bg-slate-600",
                textColor: "text-slate-400",
              },
            ].map((item) => {
              const pct = totalCases > 0 ? (item.count / totalCases) * 100 : 0;
              return (
                <button
                  key={item.status}
                  onClick={() => onNavigateToCases(item.status)}
                  className="w-full text-left p-3 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 transition group cursor-pointer"
                >
                  <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                    <span className="text-slate-300 group-hover:text-white transition">
                      {item.label}
                    </span>
                    <span className={`font-mono ${item.textColor}`}>
                      {item.count} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${item.color} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    ></div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Guard-Rail Enforcement Telemetry */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white">
                Guard-Rail Policy Enforcement Details
              </h2>
              <p className="text-xs text-slate-400">
                Hard regulatory and cost guard-rails triggered during decision routing.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-indigo-950 text-indigo-300 border border-indigo-700/40">
              6 Active Rules
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">
                  RBI 3-Attempt Cap
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-bold font-mono bg-rose-950/70 text-rose-300 border border-rose-700/40">
                  {summary.guardRailTriggers.rbiAttemptCap} Triggers
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Halted retries exceeding statutory maximum limit.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">
                  Minimum 5-Day Gap
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-bold font-mono bg-amber-950/70 text-amber-300 border border-amber-700/40">
                  {summary.guardRailTriggers.minGapDays} Triggers
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Prevented rapid successive attempts on same mandate.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">
                  Fee-to-Recovery Cap (&gt;50%)
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-bold font-mono bg-emerald-950/70 text-emerald-300 border border-emerald-700/40">
                  {summary.guardRailTriggers.feeToRecoveryRatio} Triggers
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Protected margins when cumulative fees exceed 50% of amount.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">
                  Customer Contact Cap (&ge;2/wk)
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-bold font-mono bg-purple-950/70 text-purple-300 border border-purple-700/40">
                  {summary.guardRailTriggers.contactCap} Triggers
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Suppressed nudge spam to prevent customer harassment.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">
                  Unknown Code Escalation
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-bold font-mono bg-violet-950/70 text-violet-300 border border-violet-700/40">
                  {summary.guardRailTriggers.unknownCodeEscalation} Triggers
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Routed unmapped NPCI/Bank codes straight to human review.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">
                  Low Confidence Filter
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-bold font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  {summary.guardRailTriggers.lowConfidenceEscalation} Triggers
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Escalated ambiguous classification scores under threshold.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Escalated Exceptions (Human-in-the-loop Review) */}
      <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse"></span>
              Escalated Exceptions Awaiting Operations Review
            </h2>
            <p className="text-xs text-slate-400">
              Transactions where automated heuristics deferred execution to ops
              due to anomalous failure codes.
            </p>
          </div>
          <span className="text-xs font-mono text-purple-300 bg-purple-950/80 px-2.5 py-1 rounded-md border border-purple-800/40">
            {summary.escalatedExceptions.length} Cases Requiring Attention
          </span>
        </div>

        {summary.escalatedExceptions.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-sm">
            No transactions currently escalated. All cases processed
            automatically!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
                <tr>
                  <th className="py-3 px-4">Txn ID</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Fail Code</th>
                  <th className="py-3 px-4">Escalation Reason</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {summary.escalatedExceptions.map((ex) => (
                  <tr
                    key={ex.txnId}
                    className="hover:bg-slate-800/30 transition"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-purple-300">
                      {ex.txnId}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {ex.customerId}
                    </td>
                    <td className="py-3 px-4 font-semibold text-white">
                      ₹
                      {ex.amount.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-rose-950/60 text-rose-300 border border-rose-800/40">
                        {ex.failCode}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300">{ex.reason}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => onNavigateToDetail(ex.txnId)}
                        className="px-2.5 py-1 rounded bg-indigo-600/80 hover:bg-indigo-600 text-white font-medium transition cursor-pointer"
                      >
                        Inspect Audit Trail →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Live Demo Injection Modal */}
      {showDemoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-950/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-rose-600 text-white shadow-lg shadow-amber-500/20">
                  <BoltIcon className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white">
                      Live Failure Injection Simulator
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-semibold">
                      Real-Time Engine
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Inject a single failed transaction into the autonomous recovery pipeline to observe real-time classification, policy routing, and settlement simulation.
                  </p>
                </div>
              </div>
              <button
                onClick={() => !injecting && setShowDemoModal(false)}
                disabled={injecting}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
                aria-label="Close Modal"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Controls */}
              <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/70 space-y-3">
                <label className="block text-xs font-semibold text-slate-300">
                  Select Failure Scenario / Code:
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={demoFailCode}
                    onChange={(e) => setDemoFailCode(e.target.value)}
                    disabled={injecting}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  >
                    <option value="">Random (~70% Known Codes, ~30% Unknown Escalation)</option>
                    <option value="01">01 - Insufficient Funds (Auto salary-cycle retry)</option>
                    <option value="MD">MD - Mandate Expired (Re-mandate customer nudge)</option>
                    <option value="BE">BE - Bank Error (Off-peak retry)</option>
                    <option value="ZZ">ZZ - Unknown/Garbage Code (Ops Escalation Guard-rail Demo)</option>
                    <option value="FD">FD - Account Closed / Fraud (Unrecoverable Dead)</option>
                    <option value="WA">WA - Mandate Withdrawn (Unrecoverable Dead)</option>
                  </select>

                  <button
                    onClick={handleInject}
                    disabled={injecting}
                    className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-white text-xs font-bold shadow-lg shadow-orange-500/25 transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <BoltIcon className={`w-4 h-4 ${injecting ? "animate-spin" : ""}`} />
                    {injecting ? "Processing Pipeline..." : "Inject Live Failure"}
                  </button>
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
                  <span className="text-slate-400 text-xs mr-1">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setDemoFailCode("")}
                    disabled={injecting}
                    className={`px-2 py-1 rounded transition cursor-pointer font-medium ${demoFailCode === "" ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
                  >
                    🎲 70/30 Random
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoFailCode("01")}
                    disabled={injecting}
                    className={`px-2 py-1 rounded font-mono transition cursor-pointer ${demoFailCode === "01" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
                  >
                    01 (Funds)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoFailCode("MD")}
                    disabled={injecting}
                    className={`px-2 py-1 rounded font-mono transition cursor-pointer ${demoFailCode === "MD" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
                  >
                    MD (Expired)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoFailCode("BE")}
                    disabled={injecting}
                    className={`px-2 py-1 rounded font-mono transition cursor-pointer ${demoFailCode === "BE" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
                  >
                    BE (Bank Err)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoFailCode("ZZ")}
                    disabled={injecting}
                    className={`px-2 py-1 rounded font-mono transition cursor-pointer ${demoFailCode === "ZZ" ? "bg-rose-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
                  >
                    ZZ (Unknown Escalation)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoFailCode("FD")}
                    disabled={injecting}
                    className={`px-2 py-1 rounded font-mono transition cursor-pointer ${demoFailCode === "FD" ? "bg-rose-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
                  >
                    FD (Fraud Stop)
                  </button>
                </div>
              </div>

              {/* Error Message */}
              {demoError && (
                <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-200 text-xs flex items-center gap-3">
                  <AlertTriangleIcon className="w-5 h-5 text-rose-400 flex-shrink-0" />
                  <span>{demoError}</span>
                </div>
              )}

              {/* Stepper Progress Indicator */}
              {(injecting || demoResult || activeStep > 0) && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div
                    className={`p-3 rounded-xl border transition-all text-center ${
                      activeStep >= 1
                        ? "bg-indigo-950/60 border-indigo-500/80 text-indigo-200"
                        : "bg-slate-800/40 border-slate-800 text-slate-500"
                    }`}
                  >
                    <div className="text-[10px] uppercase font-mono font-bold">Step 1</div>
                    <div className="text-xs font-semibold mt-0.5">Webhook Ingest</div>
                  </div>
                  <div
                    className={`p-3 rounded-xl border transition-all text-center ${
                      activeStep >= 2
                        ? "bg-indigo-950/60 border-indigo-500/80 text-indigo-200"
                        : "bg-slate-800/40 border-slate-800 text-slate-500"
                    }`}
                  >
                    <div className="text-[10px] uppercase font-mono font-bold">Step 2</div>
                    <div className="text-xs font-semibold mt-0.5">Multi-Factor Classify</div>
                  </div>
                  <div
                    className={`p-3 rounded-xl border transition-all text-center ${
                      activeStep >= 3
                        ? "bg-indigo-950/60 border-indigo-500/80 text-indigo-200"
                        : "bg-slate-800/40 border-slate-800 text-slate-500"
                    }`}
                  >
                    <div className="text-[10px] uppercase font-mono font-bold">Step 3</div>
                    <div className="text-xs font-semibold mt-0.5">Policy & Guard-Rails</div>
                  </div>
                  <div
                    className={`p-3 rounded-xl border transition-all text-center ${
                      activeStep >= 4
                        ? "bg-indigo-950/60 border-indigo-500/80 text-indigo-200"
                        : "bg-slate-800/40 border-slate-800 text-slate-500"
                    }`}
                  >
                    <div className="text-[10px] uppercase font-mono font-bold">Step 4</div>
                    <div className="text-xs font-semibold mt-0.5">Execute & Audit</div>
                  </div>
                </div>
              )}

              {/* Processing Spinner */}
              {injecting && (
                <div className="py-8 flex flex-col items-center justify-center text-slate-400 space-y-3">
                  <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs font-mono text-amber-300">
                    Executing live pipeline through classifier and decision engine...
                  </p>
                </div>
              )}

              {/* Live Result Breakdown */}
              {demoResult && (
                <div className="space-y-4 animate-fadeIn">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Stage 1: Transaction Details */}
                    <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                          1. Ingested Transaction
                        </span>
                        <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-indigo-950 text-indigo-300 border border-indigo-800/50">
                          {demoResult.transaction.txnId}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                        <div>
                          <span className="text-slate-400 text-[11px] block">Customer:</span>
                          <span className="font-mono text-slate-200">{demoResult.customer.customerId}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[11px] block">Amount:</span>
                          <span className="font-bold text-emerald-400">
                            ₹{demoResult.transaction.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[11px] block">Failure Code:</span>
                          <span className="font-mono px-1.5 py-0.5 rounded bg-rose-950/70 text-rose-300 border border-rose-800/50 text-[11px]">
                            {demoResult.transaction.failCode}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[11px] block">Customer Contacts:</span>
                          <span className="font-mono text-slate-200">
                            {demoResult.customer.contactCountThisWeek} this week
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stage 2: Classification */}
                    <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                          2. Multi-Factor Classifier
                        </span>
                        <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-purple-950 text-purple-300 border border-purple-800/50">
                          {(demoResult.classification.confidence * 100).toFixed(0)}% Confidence
                        </span>
                      </div>
                      <div className="text-xs space-y-1.5 pt-1">
                        <div>
                          <span className="text-slate-400 text-[11px] block">Classification Bucket:</span>
                          <span className="font-mono font-semibold text-white">
                            {demoResult.classification.bucket}
                          </span>
                        </div>
                        {demoResult.classification.adjustmentReason && (
                          <div>
                            <span className="text-slate-400 text-[11px] block">Multi-Factor Adjustment:</span>
                            <span className="text-slate-300 text-[11px]">
                              {demoResult.classification.adjustmentReason}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stage 3: Decision Engine */}
                    <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                          3. Policy & Guard-Rails
                        </span>
                        <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${
                          demoResult.decision.action === "RETRY_SCHEDULED"
                            ? "bg-emerald-950 text-emerald-300 border-emerald-800/50"
                            : demoResult.decision.action === "CUSTOMER_NUDGE"
                            ? "bg-amber-950 text-amber-300 border-amber-800/50"
                            : demoResult.decision.action === "ESCALATED_HUMAN_REVIEW"
                            ? "bg-violet-950 text-violet-300 border-violet-800/50"
                            : "bg-rose-950 text-rose-300 border-rose-800/50"
                        }`}>
                          {demoResult.decision.action}
                        </span>
                      </div>
                      <div className="text-xs space-y-1 pt-1">
                        {demoResult.decision.scheduledFor && (
                          <div>
                            <span className="text-slate-400 text-[11px] block">Scheduled Retry:</span>
                            <span className="font-mono text-slate-200">
                              {new Date(demoResult.decision.scheduledFor).toLocaleString("en-IN")}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="text-slate-400 text-[11px] block">Decision Rule:</span>
                          <span className="text-slate-300 text-[11px] leading-relaxed">
                            {demoResult.decision.reason}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stage 4: Execution & Settlement */}
                    <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                          4. Execution & Settlement
                        </span>
                        <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${
                          demoResult.executionResult.status === "RESOLVED_RECOVERED"
                            ? "bg-emerald-950 text-emerald-300 border-emerald-800/50"
                            : demoResult.executionResult.status === "PENDING"
                            ? "bg-amber-950 text-amber-300 border-amber-800/50"
                            : demoResult.executionResult.status === "ESCALATED"
                            ? "bg-violet-950 text-violet-300 border-violet-800/50"
                            : "bg-rose-950 text-rose-300 border-rose-800/50"
                        }`}>
                          {demoResult.executionResult.status}
                        </span>
                      </div>
                      <div className="text-xs space-y-1 pt-1">
                        <div>
                          <span className="text-slate-400 text-[11px] block">Action Executed:</span>
                          <span className="font-mono text-slate-200">{demoResult.executionResult.actionTaken}</span>
                        </div>
                        {demoResult.executionResult.retryAttempt && (
                          <div className="space-y-1 pt-1.5 border-t border-slate-700/40 text-[11px]">
                            <div className="flex justify-between">
                              <span className="text-slate-400">Attempt:</span>
                              <span className="font-mono text-slate-200 font-semibold">
                                Attempt #{demoResult.executionResult.retryAttempt.attemptNo}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Settlement Result:</span>
                              <span className={`font-mono font-bold ${
                                demoResult.executionResult.retryAttempt.result === "SUCCESS"
                                  ? "text-emerald-400"
                                  : demoResult.executionResult.retryAttempt.result === "FAILED"
                                  ? "text-rose-400"
                                  : "text-amber-400"
                              }`}>
                                {demoResult.executionResult.retryAttempt.result}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Fee Charged:</span>
                              <span className="font-mono text-slate-300">
                                ₹{Number(demoResult.executionResult.retryAttempt.feeCharged).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Audit Trail Log */}
                  <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldCheckIcon className="w-4 h-4 text-indigo-400" />
                        Audit Trail Generated ({demoResult.auditLogs.length} Events)
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">Immutable Ledger</span>
                    </div>

                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {demoResult.auditLogs.map((log) => (
                        <div
                          key={log.id}
                          className="p-2 rounded-lg bg-slate-900/90 border border-slate-800/80 flex items-start justify-between gap-3 text-[11px]"
                        >
                          <div className="space-y-0.5 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-indigo-300 font-semibold border border-slate-700">
                                {log.decisionType}
                              </span>
                              <span className="text-slate-400 font-mono text-[10px]">
                                {new Date(log.timestamp).toLocaleTimeString("en-IN")}
                              </span>
                              {log.confidenceScore !== null && log.confidenceScore !== undefined && (
                                <span className="text-[10px] font-mono text-slate-400">
                                  {(Number(log.confidenceScore) * 100).toFixed(0)}% conf
                                </span>
                              )}
                            </div>
                            <p className="text-slate-300">{log.reasonText}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {demoResult ? (
                  <span>
                    Dashboard telemetry automatically synchronized with latest settlement.
                  </span>
                ) : (
                  <span>Ready to inject failure webhook into recovery engine.</span>
                )}
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {demoResult && (
                  <button
                    onClick={() => {
                      setShowDemoModal(false);
                      onNavigateToDetail(demoResult.transaction.txnId);
                    }}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition cursor-pointer"
                  >
                    Inspect Full Case Details →
                  </button>
                )}
                <button
                  onClick={() => !injecting && setShowDemoModal(false)}
                  disabled={injecting}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition cursor-pointer disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
