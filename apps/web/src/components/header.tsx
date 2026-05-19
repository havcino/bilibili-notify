import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useBackendReachable } from "../hooks/useBackendReachable";
import { api } from "../services/api";
import { submitLogout } from "../services/session";
import { useAuthStore } from "../store/auth";
import { useSessionStore } from "../store/session";
import { BiliLoginStatus } from "../types/auth";
import type { PushTarget, Subscription } from "../types/domain";
import { Btn } from "./atoms";
import { Icon } from "./icons";

interface UserCardData {
	card?: {
		mid?: string;
		name?: string;
		face?: string;
	};
}

const NAV: ReadonlyArray<{
	to: string;
	label: string;
	countKey?: "subs" | "targets";
}> = [
	{ to: "/", label: "概览" },
	{ to: "/subs", label: "订阅 UP 主", countKey: "subs" },
	{ to: "/targets", label: "推送目标", countKey: "targets" },
	{ to: "/history", label: "推送历史" },
	{ to: "/rules", label: "高级规则" },
	{ to: "/cards", label: "卡片渲染 · 样式" },
	{ to: "/ai", label: "智能女仆" },
	{ to: "/system", label: "系统" },
	{ to: "/logs", label: "日志" },
];

function AccountChip() {
	const snapshot = useAuthStore((s) => s.snapshot);
	const loggedIn = snapshot?.status === BiliLoginStatus.LOGGED_IN;
	const card = loggedIn ? (snapshot?.data as UserCardData | undefined)?.card : undefined;
	const name = card?.name;
	const face = card?.face;
	if (loggedIn && name) {
		return (
			<span>
				当前账号 <span className="font-bold text-bn-pink">{name}</span> 已登录
				{face ? (
					<img
						alt={name}
						src={face}
						referrerPolicy="no-referrer"
						className="ml-2 inline-block h-5 w-5 rounded-full ring-2 ring-white"
					/>
				) : null}
			</span>
		);
	}
	return (
		<span>
			女仆为您打理一切～(*´∀`)~♡{" "}
			<span className="text-bn-text-secondary">{snapshot?.msg ?? "登录态加载中"}</span>
		</span>
	);
}

/**
 * Dashboard logout (Q6). Icon-only, rightmost in the header cluster, rendered
 * only when auth is configured AND the session is authed. Lightweight 2-step
 * inline confirm (click → "确认登出?" ~3s → second click executes) — guards a
 * fat-finger from dropping unsaved edits, no modal infra.
 */
function LogoutButton() {
	const qc = useQueryClient();
	const authRequired = useSessionStore((s) => s.authRequired);
	const authed = useSessionStore((s) => s.authed);
	const markLoggedOut = useSessionStore((s) => s.markLoggedOut);
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (revertTimer.current) clearTimeout(revertTimer.current);
		};
	}, []);

	if (!authRequired || !authed) return null;

	function armOrConfirm(): void {
		if (busy) return;
		if (!confirming) {
			setConfirming(true);
			if (revertTimer.current) clearTimeout(revertTimer.current);
			revertTimer.current = setTimeout(() => setConfirming(false), 3000);
			return;
		}
		if (revertTimer.current) clearTimeout(revertTimer.current);
		setBusy(true);
		void submitLogout().finally(() => {
			// authed=false → AuthGate effect tears the WS down + shows the
			// (cold) login card; drop cached server data so a re-login starts
			// from a clean slate.
			markLoggedOut();
			qc.clear();
		});
	}

	return (
		<>
			<span className="mx-1 h-5 w-px bg-black/10" aria-hidden="true" />
			<Btn
				variant="outline"
				size="sm"
				icon={<Icon.logout size={14} />}
				onClick={armOrConfirm}
				disabled={busy}
				title="登出 Dashboard"
			>
				{confirming ? "确认登出?" : ""}
			</Btn>
		</>
	);
}

export function GlassHeader() {
	const qc = useQueryClient();
	const reachable = useBackendReachable();
	const subs = useQuery({
		queryKey: ["subscriptions"],
		queryFn: () => api.get<Subscription[]>("/api/subs"),
	});
	const targets = useQuery({
		queryKey: ["targets"],
		queryFn: () => api.get<PushTarget[]>("/api/targets"),
	});
	const counts = {
		subs: subs.data?.length ?? 0,
		targets: targets.data?.length ?? 0,
	};

	function refreshAll(): void {
		qc.invalidateQueries({ queryKey: ["health"] });
		qc.invalidateQueries({ queryKey: ["auth-status"] });
		qc.invalidateQueries({ queryKey: ["subscriptions"] });
		qc.invalidateQueries({ queryKey: ["targets"] });
	}

	return (
		<header className="bn-glass-strong sticky top-0 z-10">
			<div className="flex items-center justify-between gap-4 px-7 pt-4">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex h-13 items-center px-1">
						<img alt="Bilibili Notify" src="/logo.png" className="h-13 w-auto object-contain" />
					</div>
					<div className="min-w-0">
						<div className="text-[17px] font-bold tracking-tight text-bn-text-primary">
							Bilibili Notify · 女仆值班室
						</div>
						<div className="mt-0.5 truncate text-[11.5px] text-bn-text-secondary">
							<AccountChip />
						</div>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{reachable ? (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700">
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
							推送服务运行中
						</span>
					) : (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/12 px-2.5 py-1 text-[11.5px] font-semibold text-red-600">
							<span className="h-1.5 w-1.5 rounded-full bg-red-500" />
							后端失联
						</span>
					)}
					<Btn variant="outline" size="sm" icon={<Icon.refresh size={14} />} onClick={refreshAll}>
						刷新
					</Btn>
					<NavLink to="/subs">
						<Btn variant="primary" size="sm" icon={<Icon.plus size={14} />}>
							添加 UP 主
						</Btn>
					</NavLink>
					<LogoutButton />
				</div>
			</div>
			<nav className="flex gap-0 px-5 pt-3">
				{NAV.map((t) => (
					<NavLink
						key={t.to}
						to={t.to}
						end
						className={({ isActive }) =>
							`relative flex items-center gap-1.5 px-4 py-2.5 text-[13px] transition ${
								isActive
									? "font-bold text-bn-pink"
									: "font-medium text-bn-text-tertiary hover:text-bn-text-primary"
							}`
						}
					>
						{({ isActive }) => (
							<>
								{t.label}
								{t.countKey ? (
									<span
										className={`rounded-lg px-1.5 py-px text-[10px] font-bold ${
											isActive ? "bg-bn-pink/15 text-bn-pink" : "bg-black/5 text-bn-text-secondary"
										}`}
									>
										{counts[t.countKey]}
									</span>
								) : null}
								<span
									className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full transition ${
										isActive ? "bg-bn-pink" : "bg-transparent"
									}`}
								/>
							</>
						)}
					</NavLink>
				))}
			</nav>
		</header>
	);
}
