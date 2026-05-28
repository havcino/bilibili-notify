import { create } from "zustand";
import type { FieldDiff } from "../utils/walkTreeDiff";

/**
 * Draft store —— 灵动岛草稿机制的全局单例 state(plan Phase C)。
 *
 * 设计:**任意时刻只有一个页面在被编辑**(用户 UI 上也只能停留在一个页面),
 * 所以 store 维护一个 `current: DraftRegistration | null`,而不是按 pageKey
 * 多注册并发存在。切页 / 卸载会 unregister,新页 mount 时 register 顶替。
 *
 * uiState 5 态:
 * - `idle`     当前无草稿(diff 空 或 current=null)
 * - `dirty`    有未保存改动,灵动岛显示「未保存 + 字段数徽章」
 * - `saving`   保存进行中(mutation pending)
 * - `saved`    保存成功,1.2s 自动转 idle(由 useDirtyDraft 调度)
 * - `error`    保存失败,不自动消失,等用户 dismiss 或重新点保存
 *
 * panelLocked:灵动岛 expand panel 的"hover 预览 vs click 锁定"双轨(Q8)。
 * 锁定后即使鼠标移开 panel 也不收起,需要再次 click chip 或外部 click 关闭。
 */

export type DraftUiState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface DraftRegistration {
	/** 页面唯一 key,用于 register 顶替时识别。 */
	pageKey: string;
	/** 灵动岛展示的页面友好名(中文)。 */
	pageLabel: string;
	/** 当前 diff(由 useDirtyDraft 算好 + debounce 后塞进来)。 */
	diff: FieldDiff[];
	/** 主按钮 onSave 回调(由页面组件提供,内部走 mutation)。 */
	onSave: () => void;
	/** 丢弃回调(扔回 baseline)。 */
	onDiscard: () => void;
}

export interface DraftState {
	current: DraftRegistration | null;
	uiState: DraftUiState;
	errorMessage: string | null;
	panelLocked: boolean;

	/** 注册或更新 current。pageKey 相同 → 更新 diff/callbacks;不同 → 顶替。 */
	register: (reg: DraftRegistration) => void;
	/** 当前页卸载或 diff 清空时调用 → current=null + uiState=idle + panelLocked=false。 */
	unregister: () => void;
	/** 显式切 uiState(useDirtyDraft 用)。error 态可带 errorMessage。 */
	setUiState: (next: DraftUiState, errorMessage?: string | null) => void;
	/** 切 panelLocked。不传参 → toggle;传 boolean → 显式 set。 */
	togglePanelLocked: (next?: boolean) => void;
}

/**
 * 纯函数:基于 current/diff 派生 uiState 自然态(idle vs dirty)。
 * `saving` / `saved` / `error` 由 useDirtyDraft 在 save 流程中显式 setUiState
 * 覆盖,不在此派生。导出供测试。
 */
export function deriveNaturalUiState(current: DraftRegistration | null): DraftUiState {
	if (current === null || current.diff.length === 0) return "idle";
	return "dirty";
}

export const useDraftStore = create<DraftState>((set) => ({
	current: null,
	uiState: "idle",
	errorMessage: null,
	panelLocked: false,

	register: (reg) =>
		set((s) => {
			const isNewPage = s.current?.pageKey !== reg.pageKey;
			// 顶替页面 → uiState 重置(原页可能停在 saved/error 态不该污染新页)
			// + panelLocked 重置(原页 panel 不该跟到新页)。
			// 同页面更新 → 只刷 current,保留 uiState(可能正在 saving / 刚 saved)
			// 与 panelLocked。但若已是 idle/dirty 自然态,跟随 diff 重算。
			//
			// 已知契约(audit R2):同页 + uiState=saved 时,即使新 diff 非空,仍
			// 保留 saved 态 ~1.2s 让用户看完反馈;1.2s 后 runSaveFlow 的 linger
			// timer 会调 deriveNaturalUiState 把状态转回 dirty。期间用户视觉上看
			// 不到立即变 dirty,这是设计选择(让保存反馈显示完整)。
			const nextUiState =
				isNewPage || s.uiState === "idle" || s.uiState === "dirty"
					? deriveNaturalUiState(reg)
					: s.uiState;
			return {
				current: reg,
				uiState: nextUiState,
				errorMessage: isNewPage ? null : s.errorMessage,
				panelLocked: isNewPage ? false : s.panelLocked,
			};
		}),

	unregister: () => set({ current: null, uiState: "idle", errorMessage: null, panelLocked: false }),

	setUiState: (next, errorMessage = null) =>
		set({ uiState: next, errorMessage: next === "error" ? errorMessage : null }),

	togglePanelLocked: (next) =>
		set((s) => ({ panelLocked: typeof next === "boolean" ? next : !s.panelLocked })),
}));
