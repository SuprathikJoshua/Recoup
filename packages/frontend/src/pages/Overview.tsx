import React, { useEffect, useState } from "react";
import { fetchSummary } from "../services/api.js";
import type { EngineSummaryReport } from "../types/index.js";
import { StatusBadge } from "../components/StatusBadge.js";
import {
	ShieldCheckIcon,
	ActivityIcon,
	RefreshIcon,
	AlertTriangleIcon,
	ArrowRightIcon,
	CheckCircleIcon,
} from "../components/Icons.js";

interface OverviewProps {
	onNavigateToCases: (statusFilter?: string) => void;
	onNavigateToDetail: (txnId: string) => void;
}

export function Overview({
	onNavigateToCases,
	onNavigateToDetail,
}: OverviewProps) {
	const [summary, setSummary] = useState<EngineSummaryReport | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);

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
			<div className="flex flex-col items-center justify-center min-h-100 text-slate-400">
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
		0,
	);

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
				<div className="p-5 rounded-2xl bg-linear-to-b from-slate-800/60 to-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
					<div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
					<div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
						<span>Gross Recovered</span>
						<span className="p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/50 text-emerald-400">
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
						{summary.statusCounts["RESOLVED_RECOVERED"] || 0} successfully
						settled cases
					</div>
				</div>

				{/* Net Recovered */}
				<div className="p-5 rounded-2xl bg-linear-to-b from-slate-800/60 to-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
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
				<div className="p-5 rounded-2xl bg-linear-to-b from-slate-800/60 to-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
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
				<div className="p-5 rounded-2xl bg-linear-to-b from-slate-800/60 to-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
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
								Guard-Rail Policy Enforcement
							</h2>
							<p className="text-xs text-slate-400">
								Hard regulatory and cost guard-rails triggered during decision
								routing.
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
		</div>
	);
}
