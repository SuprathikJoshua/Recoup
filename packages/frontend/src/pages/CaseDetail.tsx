import { useEffect, useState } from "react";
import { fetchTransactionDetail } from "../services/api.js";
import type { FailedTransactionDetail, AuditLog } from "../types/index.js";
import {
	StatusBadge,
	PaymentModeBadge,
	AttemptBadge,
} from "../components/StatusBadge.js";
import {
	ArrowLeftIcon,
	RefreshIcon,
	ShieldCheckIcon,
	ActivityIcon,
	AlertTriangleIcon,
} from "../components/Icons.js";

interface CaseDetailProps {
	txnId: string;
	onBack: () => void;
}

export function CaseDetail({ txnId, onBack }: CaseDetailProps) {
	const [detail, setDetail] = useState<FailedTransactionDetail | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);

	const loadDetail = async () => {
		try {
			setLoading(true);
			setError(null);
			const data = await fetchTransactionDetail(txnId);
			setDetail(data);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Failed to load transaction details",
			);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadDetail();
	}, [txnId]);

	if (loading && !detail) {
		return (
			<div className="flex flex-col items-center justify-center min-h-100 text-slate-400">
				<div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
				<p className="font-medium text-slate-300">
					Retrieving Full Case History & Decision Logs for {txnId}...
				</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="p-6 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-200">
				<div className="flex items-center gap-3 mb-2">
					<AlertTriangleIcon className="w-6 h-6 text-rose-400" />
					<h3 className="text-lg font-bold">Failed to load case details</h3>
				</div>
				<p className="text-sm text-rose-300/80 mb-4">{error}</p>
				<button
					onClick={onBack}
					className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition cursor-pointer"
				>
					← Back to Cases
				</button>
			</div>
		);
	}

	if (!detail) return null;

	const customer = detail.customerContext;

	return (
		<div className="space-y-6 animate-fadeIn">
			{/* Top Navigation */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
				<div className="flex items-center gap-3">
					<button
						onClick={onBack}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
					>
						<ArrowLeftIcon className="w-4 h-4" />
						Back to Cases
					</button>
					<div>
						<div className="flex items-center gap-2">
							<h1 className="text-xl sm:text-2xl font-extrabold text-white font-mono tracking-tight">
								{detail.txnId}
							</h1>
							<StatusBadge status={detail.status} />
						</div>
						<p className="text-xs text-slate-400 mt-0.5">
							Customer:{" "}
							<span className="font-mono text-slate-300">
								{detail.customerId}
							</span>{" "}
							• Merchant:{" "}
							<span className="font-mono text-slate-300">
								{detail.merchantId}
							</span>
						</p>
					</div>
				</div>

				<button
					onClick={loadDetail}
					disabled={loading}
					className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer self-start sm:self-auto"
				>
					<RefreshIcon
						className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
					/>
					Refresh
				</button>
			</div>

			{/* Overview Cards Grid */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-5">
				{/* Transaction Summary Card */}
				<div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
					<h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
						Transaction Details
					</h2>
					<div className="space-y-2 text-xs">
						<div className="flex justify-between">
							<span className="text-slate-400">Amount:</span>
							<span className="font-bold text-white text-base">
								₹
								{Number(detail.amount).toLocaleString("en-IN", {
									minimumFractionDigits: 2,
								})}
							</span>
						</div>
						<div className="flex justify-between items-center">
							<span className="text-slate-400">Payment Mode:</span>
							<PaymentModeBadge mode={detail.paymentMode} />
						</div>
						<div className="flex justify-between items-center">
							<span className="text-slate-400">Initial Fail Code:</span>
							<span className="font-mono px-2 py-0.5 rounded bg-slate-800 text-rose-300 border border-slate-700">
								{detail.failCode}
							</span>
						</div>
						<div className="flex justify-between items-center">
							<span className="text-slate-400">Underlying Root Cause:</span>
							<span className="font-mono text-slate-200">
								{detail.trueReason}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-slate-400">Failure Date:</span>
							<span className="text-slate-200">
								{new Date(detail.failTimestamp).toLocaleString("en-IN")}
							</span>
						</div>
					</div>
				</div>

				{/* Customer Context Card */}
				<div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
					<h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
						Customer Context & Heuristics
					</h2>
					{customer ? (
						<div className="space-y-2 text-xs">
							<div className="flex justify-between">
								<span className="text-slate-400">Customer ID:</span>
								<span className="font-mono text-slate-200">
									{customer.customerId}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-slate-400">Weekly Contact Count:</span>
								<span
									className={`font-semibold ${
										customer.contactCountThisWeek >= 2
											? "text-amber-400"
											: "text-emerald-400"
									}`}
								>
									{customer.contactCountThisWeek} contacts (Cap: 2)
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-slate-400">Mandate Expiry:</span>
								<span className="text-slate-200">
									{new Date(customer.mandateExpiryDate).toLocaleDateString(
										"en-IN",
									)}
								</span>
							</div>
							<div>
								<span className="text-slate-400 block mb-1">
									Debit Pattern Days:
								</span>
								<div className="flex flex-wrap gap-1">
									{customer.debitPatternDays &&
									customer.debitPatternDays.length > 0 ? (
										customer.debitPatternDays.map((d) => (
											<span
												key={d}
												className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/40 text-[11px] font-mono"
											>
												Day {d}
											</span>
										))
									) : (
										<span className="text-slate-500 italic">
											No patterns recorded
										</span>
									)}
								</div>
							</div>
						</div>
					) : (
						<div className="text-xs text-slate-500 italic py-4">
							No customer context available
						</div>
					)}
				</div>

				{/* Retry Financial Impact */}
				<div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3">
					<h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
						Execution Cost Summary
					</h2>
					<div className="space-y-2 text-xs">
						<div className="flex justify-between">
							<span className="text-slate-400">Total Attempts Made:</span>
							<span className="font-mono font-bold text-white text-base">
								{detail.retryAttempts.length} / 3 max
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-slate-400">Cumulative Fees Spent:</span>
							<span className="font-mono text-slate-200">
								₹
								{detail.retryAttempts
									.reduce((sum, a) => sum + Number(a.feeCharged), 0)
									.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-slate-400">Recovery Status:</span>
							<span className="font-semibold text-white">
								{detail.status === "RESOLVED_RECOVERED"
									? "Recovered ₹" + Number(detail.amount).toFixed(2)
									: "Unrecovered"}
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Retry Attempts Table */}
			<div className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl p-5">
				<h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
					<ActivityIcon className="w-4 h-4 text-indigo-400" />
					Retry Attempts History
				</h2>
				{detail.retryAttempts.length === 0 ? (
					<div className="p-4 bg-slate-800/40 rounded-xl text-center text-xs text-slate-400">
						No physical retry attempts have been triggered yet for this case.
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-800/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
								<tr>
									<th className="py-2.5 px-3">Attempt #</th>
									<th className="py-2.5 px-3">Action Taken</th>
									<th className="py-2.5 px-3">Execution Result</th>
									<th className="py-2.5 px-3">Fee Charged</th>
									<th className="py-2.5 px-3">Attempt Timestamp</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-800/60 font-mono">
								{detail.retryAttempts.map((att) => (
									<tr
										key={att.id || att.attemptNo}
										className="hover:bg-slate-800/30 transition"
									>
										<td className="py-2.5 px-3 font-semibold text-slate-200">
											Attempt #{att.attemptNo}
										</td>
										<td className="py-2.5 px-3 text-indigo-300 font-sans">
											{att.actionTaken}
										</td>
										<td className="py-2.5 px-3">
											<AttemptBadge result={att.result} />
										</td>
										<td className="py-2.5 px-3 text-slate-300 font-sans">
											₹{Number(att.feeCharged).toFixed(2)}
										</td>
										<td className="py-2.5 px-3 text-slate-400 text-[11px] font-sans">
											{new Date(att.attemptTimestamp).toLocaleString("en-IN")}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Vertical Audit Trail & Decision Engine Timeline */}
			<div className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl p-6">
				<div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
					<div>
						<h2 className="text-base font-bold text-white flex items-center gap-2">
							<ShieldCheckIcon className="w-5 h-5 text-indigo-400" />
							Decision Engine Audit Trail & Timeline
						</h2>
						<p className="text-xs text-slate-400 mt-0.5">
							Chronological log of classification, guard-rail policy checks, and
							autonomous execution.
						</p>
					</div>
					<span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
						{detail.auditLogs.length} Events Logged
					</span>
				</div>

				{detail.auditLogs.length === 0 ? (
					<div className="p-8 text-center text-slate-500 text-xs">
						No audit logs found for this transaction.
					</div>
				) : (
					<div className="relative pl-6 sm:pl-8 space-y-6 before:absolute before:left-3 sm:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
						{detail.auditLogs.map((log: AuditLog, idx: number) => {
							const isClassify = log.decisionType === "CLASSIFY";
							const isDecide = log.decisionType === "ACTION_DECIDE";
							const isRecovered =
								log.reasonText.toLowerCase().includes("recovered") ||
								log.reasonText.toLowerCase().includes("success");
							const isEscalated = log.reasonText
								.toLowerCase()
								.includes("escalat");
							const isUnrecoverable =
								log.reasonText.toLowerCase().includes("unrecoverable") ||
								log.reasonText.toLowerCase().includes("dead");

							let dotColor = "bg-indigo-500 ring-indigo-500/20";
							let badgeColor =
								"bg-indigo-950 text-indigo-300 border-indigo-700/50";

							if (isClassify) {
								dotColor = "bg-cyan-500 ring-cyan-500/20";
								badgeColor = "bg-cyan-950 text-cyan-300 border-cyan-700/50";
							} else if (isDecide) {
								dotColor = "bg-purple-500 ring-purple-500/20";
								badgeColor =
									"bg-purple-950 text-purple-300 border-purple-700/50";
							} else if (isRecovered) {
								dotColor = "bg-emerald-500 ring-emerald-500/20";
								badgeColor =
									"bg-emerald-950 text-emerald-300 border-emerald-700/50";
							} else if (isEscalated) {
								dotColor = "bg-amber-500 ring-amber-500/20";
								badgeColor = "bg-amber-950 text-amber-300 border-amber-700/50";
							} else if (isUnrecoverable) {
								dotColor = "bg-rose-500 ring-rose-500/20";
								badgeColor = "bg-rose-950 text-rose-300 border-rose-700/50";
							}

							return (
								<div key={log.id || idx} className="relative group">
									{/* Timeline bullet */}
									<div
										className={`absolute -left-6 sm:-left-8 top-1.5 w-3 h-3 rounded-full ${dotColor} ring-4 transition group-hover:scale-125`}
									></div>

									{/* Content card */}
									<div className="p-4 rounded-xl bg-slate-800/50 hover:bg-slate-800/80 border border-slate-700/70 transition shadow-sm">
										<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
											<div className="flex items-center gap-2">
												<span
													className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase border ${badgeColor}`}
												>
													{log.decisionType}
												</span>
												{log.confidenceScore !== null &&
													log.confidenceScore !== undefined && (
														<span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
															Confidence:{" "}
															{(log.confidenceScore * 100).toFixed(0)}%
														</span>
													)}
											</div>
											<span className="text-[11px] text-slate-400 font-mono">
												{new Date(log.timestamp).toLocaleString("en-IN", {
													month: "short",
													day: "2-digit",
													hour: "2-digit",
													minute: "2-digit",
													second: "2-digit",
												})}
											</span>
										</div>

										<p className="text-xs text-slate-200 font-sans leading-relaxed">
											{log.reasonText}
										</p>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
