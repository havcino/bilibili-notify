import { create } from "zustand";

/**
 * FloatingAiBar 显示态。提到 zustand 是为了让 DraftIsland(灵动岛)按 dismissed
 * 切位移避让 AiBar(plan Q9):
 * - dismissed=false → AiBar 全宽贴底显示 → 灵动岛上移 64px 让位
 * - dismissed=true → AiBar 收成右下小圆按钮 → 灵动岛回 bottom 默认位
 *
 * `expanded` 也搬过来纯粹是顺手(原 FloatingAiBar 内 useState 也是双 toggle),
 * 当前 DraftIsland 不订阅它,但留口给后续 polish(若 expanded 时 AiBar 更高,
 * 灵动岛位移更多)。
 */

export interface AiBarState {
	dismissed: boolean;
	expanded: boolean;
	setDismissed: (next: boolean) => void;
	setExpanded: (next: boolean | ((prev: boolean) => boolean)) => void;
}

export const useAiBarStore = create<AiBarState>((set) => ({
	dismissed: false,
	expanded: false,
	setDismissed: (next) => set({ dismissed: next }),
	setExpanded: (next) =>
		set((s) => ({ expanded: typeof next === "function" ? next(s.expanded) : next })),
}));
