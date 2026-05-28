import { type DependencyList, useEffect, useState } from "react";

/**
 * useDebouncedMemo —— 像 useMemo,但 deps 变化后等 `delay` 毫秒静默期再重算,
 * 中间 deps 又变会 reset 计时。等价 useMemo + debounce 包装。
 *
 * 主要用在灵动岛草稿机制(useDirtyDraft):用户连续打字 / 拖滑动条时 draft
 * 抖动剧烈,walkTreeDiff 跑全树 N 次没必要,150ms 静默后跑一次足够。
 *
 * 首次 mount 不 debounce —— 用 factory() 立即出值,避免 1 帧空状态闪烁。
 */
export function useDebouncedMemo<T>(factory: () => T, delay: number, deps: DependencyList): T {
	const [value, setValue] = useState<T>(factory);
	useEffect(() => {
		const t = window.setTimeout(() => setValue(factory()), delay);
		return () => window.clearTimeout(t);
		// biome-ignore lint/correctness/useExhaustiveDependencies: deps 是动态长度数组,deps 变化才是触发条件;factory 故意每次新建不算输入。
	}, deps);
	return value;
}
