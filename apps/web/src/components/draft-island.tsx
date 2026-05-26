/**
 * DraftIsland —— 灵动岛草稿机制(Phase D:5 态 chip 视觉)。
 *
 * 从 zustand draftStore 订阅 uiState / current / errorMessage,AnimatePresence
 * mode="wait" 切 5 个子组件:
 * - idle  → 不渲染(灵动岛消失)
 * - dirty → 粉紫 dot + 页名 + 字段数徽章(pop 动画)+ 「保存」主按钮
 * - saving → 旋转 refresh + "保存中…"
 * - saved → 绿色 ✓ + "已保存"(1.2s 后 runSaveFlow 自动转 idle)
 * - error → 摇晃 200ms + 红边 pulse + 错误文案 + dismiss x(不自动消失)
 *
 * 位置 / 层级:fixed 居中底部,bottom = 1rem + safe-area。z-100 故意低于
 * ToastShell(z-200)与 Dialog(z-300)— toast/dialog 弹出时不被遮挡。
 *
 * Phase E 加 expand panel(hover preview / click 锁定)+ 字段级 diff 列表 +
 * click 跳转字段。Phase G 接 ai-bar-store 实现「跟随 FloatingAiBar 状态垂直
 * 堆叠」。
 */

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { DraftRegistration, DraftUiState } from "../store/draft";
import { useDraftStore } from "../store/draft";
import { Icon } from "./icons";

const SHELL_SPRING = { type: "spring" as const, stiffness: 380, damping: 28 };

/**
 * 灵动岛 chip 子组件选择:5 态 + (idle / 无 current) → "none"。抽成纯函数
 * 便于单测条件分支,不被 motion / DOM 渲染复杂度卡住。
 */
export type ChipKind = "dirty" | "saving" | "saved" | "error" | "none";

export function selectChipKind(uiState: DraftUiState, current: DraftRegistration | null): ChipKind {
	if (uiState === "dirty" && current !== null) return "dirty";
	if (uiState === "saving") return "saving";
	if (uiState === "saved") return "saved";
	if (uiState === "error") return "error";
	return "none";
}

export function DraftIsland(): ReactNode {
	const uiState = useDraftStore((s) => s.uiState);
	const current = useDraftStore((s) => s.current);
	const errorMessage = useDraftStore((s) => s.errorMessage);

	const kind = selectChipKind(uiState, current);
	let content: ReactNode = null;
	if (kind === "dirty" && current !== null) {
		content = <DirtyContent key="dirty" current={current} />;
	} else if (kind === "saving") {
		content = <SavingContent key="saving" />;
	} else if (kind === "saved") {
		content = <SavedContent key="saved" />;
	} else if (kind === "error") {
		content = <ErrorContent key="error" message={errorMessage} />;
	}

	return (
		<div
			aria-live="polite"
			data-testid="draft-island"
			className="pointer-events-none fixed left-1/2 z-100 -translate-x-1/2"
			style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
		>
			<AnimatePresence mode="wait">{content}</AnimatePresence>
		</div>
	);
}

// ── Chip shell:共享外形 / 进退动画 ─────────────────────────────────────────

function ChipShell({
	children,
	extraAnimate,
	className = "",
}: {
	children: ReactNode;
	extraAnimate?: Record<string, unknown>;
	className?: string;
}) {
	return (
		<motion.div
			layout
			initial={{ opacity: 0, y: 16, scale: 0.92 }}
			animate={{ opacity: 1, y: 0, scale: 1, ...extraAnimate }}
			exit={{ opacity: 0, y: 16, scale: 0.92 }}
			transition={SHELL_SPRING}
			className={`pointer-events-auto flex items-center gap-2.5 rounded-full bg-black/85 px-4 py-2 text-white shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-xl ${className}`}
		>
			{children}
		</motion.div>
	);
}

// ── DirtyContent ──────────────────────────────────────────────────────────

function DirtyContent({ current }: { current: DraftRegistration }) {
	return (
		<ChipShell>
			<span className="block h-1.5 w-1.5 rounded-full bg-bn-pink" aria-hidden />
			<span className="text-[12px] font-medium">{current.pageLabel}</span>
			{/* 数字徽章:diff.length 变化时通过 key 强制重 mount,触发 initial→animate 的 pop。 */}
			<motion.span
				key={current.diff.length}
				initial={{ scale: 0.6, opacity: 0 }}
				animate={{ scale: 1, opacity: 1 }}
				transition={{ type: "spring", stiffness: 500, damping: 22 }}
				className="rounded-full bg-bn-pink px-1.5 py-px text-[10.5px] font-bold leading-[14px]"
				aria-label={`${current.diff.length} 项未保存`}
			>
				{current.diff.length}
			</motion.span>
			<button
				type="button"
				onClick={current.onSave}
				className="rounded-full bg-white px-3 py-1 text-[11.5px] font-bold text-black transition hover:bg-white/90 active:scale-95"
			>
				保存
			</button>
		</ChipShell>
	);
}

// ── SavingContent ─────────────────────────────────────────────────────────

function SavingContent() {
	return (
		<ChipShell>
			<motion.span
				animate={{ rotate: 360 }}
				transition={{ duration: 0.9, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
				className="grid h-3.5 w-3.5 place-items-center text-bn-purple"
				aria-hidden
			>
				<Icon.refresh size={14} />
			</motion.span>
			<span className="text-[12px]">保存中…</span>
		</ChipShell>
	);
}

// ── SavedContent ──────────────────────────────────────────────────────────

function SavedContent() {
	return (
		<ChipShell>
			<motion.span
				initial={{ scale: 0.4, opacity: 0 }}
				animate={{ scale: 1, opacity: 1 }}
				transition={{ type: "spring", stiffness: 500, damping: 18 }}
				className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white"
				aria-hidden
			>
				<Icon.check size={11} />
			</motion.span>
			<span className="text-[12px]">已保存</span>
		</ChipShell>
	);
}

// ── ErrorContent ──────────────────────────────────────────────────────────

const ERROR_SHAKE_X = [0, -6, 6, -4, 4, -2, 2, 0];
const ERROR_PULSE_BOX_SHADOW = [
	"0 0 0 0 rgba(239, 68, 68, 0.55)",
	"0 0 0 9px rgba(239, 68, 68, 0)",
];

function ErrorContent({ message }: { message: string | null }) {
	const setUiState = useDraftStore((s) => s.setUiState);
	return (
		<ChipShell
			extraAnimate={{
				x: ERROR_SHAKE_X,
				boxShadow: ERROR_PULSE_BOX_SHADOW,
				transition: {
					x: { duration: 0.2, ease: "easeInOut" },
					boxShadow: {
						duration: 1.4,
						repeat: Number.POSITIVE_INFINITY,
						ease: "easeOut",
					},
				},
			}}
			className="border border-red-400/60"
		>
			<span
				className="grid h-4 w-4 place-items-center rounded-full bg-red-500 text-white"
				aria-hidden
			>
				!
			</span>
			<span className="max-w-[260px] truncate text-[12px]" title={message ?? undefined}>
				{message ?? "保存失败"}
			</span>
			<button
				type="button"
				onClick={() => setUiState("dirty")}
				aria-label="关闭"
				className="grid h-5 w-5 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
			>
				<Icon.close size={12} />
			</button>
		</ChipShell>
	);
}
