import { useState } from "react";
import { Overview } from "./pages/Overview.js";
import { CaseList } from "./pages/CaseList.js";
import { CaseDetail } from "./pages/CaseDetail.js";
import {
	DashboardIcon,
	CasesIcon,
	ShieldCheckIcon,
} from "./components/Icons.js";

type Route = "OVERVIEW" | "CASES" | "CASE_DETAIL";

export function App() {
	const [currentRoute, setCurrentRoute] = useState<Route>("OVERVIEW");
	const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);
	const [statusFilter, setStatusFilter] = useState<string>("ALL");

	const navigateToOverview = () => {
		setCurrentRoute("OVERVIEW");
		setSelectedTxnId(null);
	};

	const navigateToCases = (filter: string = "ALL") => {
		setStatusFilter(filter);
		setCurrentRoute("CASES");
		setSelectedTxnId(null);
	};

	const navigateToDetail = (txnId: string) => {
		setSelectedTxnId(txnId);
		setCurrentRoute("CASE_DETAIL");
	};

	return (
		<div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col md:flex-row antialiased">
			{/* Sidebar Navigation */}
			<aside className="w-full md:w-64 bg-slate-900/95 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col shrink-0">
				{/* Brand Header */}
				<div className="p-6 border-b border-slate-800 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="w-9 h-9 rounded-xl bg-linear-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 font-black text-white text-lg tracking-tighter">
							R
						</div>
						<div>
							<div className="font-extrabold tracking-tight text-white text-base leading-none">
								RECOUP
							</div>
							<div className="text-[10px] font-mono tracking-wider text-indigo-400 font-semibold uppercase mt-1">
								Recovery Engine
							</div>
						</div>
					</div>

					<span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
						<span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
						v1.0
					</span>
				</div>

				{/* Nav Links */}
				<nav className="p-4 space-y-1.5 flex-1">
					<button
						onClick={navigateToOverview}
						className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${currentRoute === "OVERVIEW"
								? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
								: "text-slate-400 hover:text-slate-200 hover:bg-slate-800/70"
							}`}
					>
						<DashboardIcon className="w-4 h-4" />
						<span>Dashboard Overview</span>
					</button>

					<button
						onClick={() => navigateToCases("ALL")}
						className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${currentRoute === "CASES" || currentRoute === "CASE_DETAIL"
								? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
								: "text-slate-400 hover:text-slate-200 hover:bg-slate-800/70"
							}`}
					>
						<CasesIcon className="w-4 h-4" />
						<span>Case Registry</span>
					</button>
				</nav>

				{/* Sidebar Footer System Info */}
				<div className="p-4 border-t border-slate-800 hidden md:block">
					<div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/50 space-y-2">
						<div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
							<ShieldCheckIcon className="w-4 h-4 text-emerald-400" />
							<span>Engine Status</span>
						</div>
						<div className="text-[11px] text-slate-400 space-y-1">
							<div className="flex justify-between">
								<span>Fastify API:</span>
								<span className="text-emerald-400 font-mono font-medium">
									Ready
								</span>
							</div>
							<div className="flex justify-between">
								<span>Guard-Rails:</span>
								<span className="text-cyan-400 font-mono font-medium">
									Enforced
								</span>
							</div>
						</div>
					</div>
				</div>
			</aside>

			{/* Main Content Area */}
			<div className="flex-1 flex flex-col min-w-0 bg-[#0b0f19]">
				{/* Top Header Bar */}
				<header className="h-14 px-6 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40 backdrop-blur-md sticky top-0 z-10">
					<div className="flex items-center gap-2 text-xs text-slate-400">
						<span
							className="hover:text-slate-200 cursor-pointer"
							onClick={navigateToOverview}
						>
							Recoup
						</span>
						<span>/</span>
						{currentRoute === "OVERVIEW" && (
							<span className="text-slate-200 font-medium">Overview</span>
						)}
						{currentRoute === "CASES" && (
							<span className="text-slate-200 font-medium">
								Case Registry{" "}
								{statusFilter !== "ALL" ? `(${statusFilter})` : ""}
							</span>
						)}
						{currentRoute === "CASE_DETAIL" && (
							<>
								<span
									className="hover:text-slate-200 cursor-pointer"
									onClick={() => navigateToCases(statusFilter)}
								>
									Case Registry
								</span>
								<span>/</span>
								<span className="font-mono text-indigo-400 font-medium">
									{selectedTxnId}
								</span>
							</>
						)}
					</div>

					<div className="flex items-center gap-3">
						<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-slate-800/80 border border-slate-700 text-slate-300">
							<span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
							Live Pipeline
						</span>
					</div>
				</header>

				{/* Dynamic Page Container */}
				<main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
					{currentRoute === "OVERVIEW" && (
						<Overview
							onNavigateToCases={(filter) => navigateToCases(filter || "ALL")}
							onNavigateToDetail={(txnId) => navigateToDetail(txnId)}
						/>
					)}

					{currentRoute === "CASES" && (
						<CaseList
							initialStatusFilter={statusFilter}
							onNavigateToDetail={(txnId) => navigateToDetail(txnId)}
						/>
					)}

					{currentRoute === "CASE_DETAIL" && selectedTxnId && (
						<CaseDetail
							txnId={selectedTxnId}
							onBack={() => navigateToCases(statusFilter)}
						/>
					)}
				</main>
			</div>
		</div>
	);
}

export default App;
