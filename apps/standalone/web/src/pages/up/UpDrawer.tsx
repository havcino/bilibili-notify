import { useEffect, useMemo, useState } from "react";
import { Avatar, Btn, PlatformIcon, Row, Section, StatusDot, Toggle } from "../../components/atoms";
import { Icon } from "../../components/icons";
import {
	FEATURE_KEYS,
	FEATURE_LABELS,
	type FeatureKey,
	type PushTarget,
	type Subscription,
} from "../../types/domain";
import {
	activeFeatures,
	colorFromUid,
	displayName,
	targetsById as makeTargetsById,
	routedTargetIds,
} from "./helpers";

const PRIMARY_FEATURES: ReadonlyArray<{ key: FeatureKey; sub: string; tone: string }> = [
	{ key: "live", sub: "直播开播提醒", tone: "#FB7299" },
	{ key: "liveEnd", sub: "直播下播提醒", tone: "#FB7299" },
	{ key: "dynamic", sub: "投稿 / 转发 / 专栏", tone: "#00AEEC" },
	{ key: "superchat", sub: "直播 SuperChat", tone: "#fdcb6e" },
	{ key: "liveGuardBuy", sub: "舰长 / 提督 / 总督", tone: "#f2a053" },
	{ key: "liveSummary", sub: "直播结束后生成总结", tone: "#a29bfe" },
];

export interface UpDrawerProps {
	sub: Subscription | null;
	targets: PushTarget[];
	onClose: () => void;
	onSave: (next: Subscription) => void;
	onDelete: () => void;
	saving: boolean;
}

export function UpDrawer({ sub, targets, onClose, onSave, onDelete, saving }: UpDrawerProps) {
	const [draft, setDraft] = useState<Subscription | null>(sub);

	// Re-seed when caller swaps the subject. Avoid resetting on every render.
	useEffect(() => {
		setDraft(sub);
	}, [sub]);

	const targetsByIdMap = useMemo(() => makeTargetsById(targets), [targets]);

	if (!draft) return null;

	const color = colorFromUid(draft.uid);
	const dirty = sub ? JSON.stringify(sub) !== JSON.stringify(draft) : false;

	function toggleFeature(feature: FeatureKey, on: boolean): void {
		setDraft((d) => {
			if (!d) return d;
			// Default newly-enabled features to broadcasting through every routed target
			// so the UP keeps receiving notifications instead of silently going dark.
			const allRouted = routedTargetIds(d);
			const next: typeof d.routing = { ...d.routing };
			next[feature] = on ? allRouted : [];
			return { ...d, routing: next };
		});
	}

	function setEnabled(on: boolean): void {
		setDraft((d) => (d ? { ...d, enabled: on } : d));
	}

	function setNotes(value: string): void {
		setDraft((d) => (d ? { ...d, notes: value || undefined } : d));
	}

	function setGroups(value: string): void {
		const parts = value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		setDraft((d) => (d ? { ...d, groups: parts } : d));
	}

	function attachTarget(targetId: string): void {
		setDraft((d) => {
			if (!d) return d;
			const next: typeof d.routing = { ...d.routing };
			// Attach the target to every currently-active feature; if none, attach to dynamic+live
			// so the user has at least the basic notifications routed.
			const activeKeys = activeFeatures(d.routing);
			const keys = activeKeys.length > 0 ? activeKeys : (["dynamic", "live"] as FeatureKey[]);
			for (const k of keys) {
				if (!next[k].includes(targetId)) next[k] = [...next[k], targetId];
			}
			return { ...d, routing: next };
		});
	}

	function detachTarget(targetId: string): void {
		setDraft((d) => {
			if (!d) return d;
			const next: typeof d.routing = { ...d.routing };
			for (const k of FEATURE_KEYS) {
				next[k] = next[k].filter((id) => id !== targetId);
			}
			return { ...d, routing: next };
		});
	}

	const routedIds = routedTargetIds(draft);
	const unroutedTargets = targets.filter((t) => !routedIds.includes(t.id));

	return (
		<div className="fixed inset-0 z-30">
			<button
				type="button"
				aria-label="关闭抽屉"
				onClick={onClose}
				className="absolute inset-0 cursor-default border-0 bg-black/30 backdrop-blur-sm"
			/>
			<aside
				className="bn-anim-fade-in absolute right-0 top-0 flex h-full w-[420px] flex-col bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.12)]"
				role="dialog"
				aria-label="UP 详情"
			>
				{/* cover header */}
				<div
					className="relative h-[140px] px-5 pb-4 pt-4"
					style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}
				>
					<button
						type="button"
						onClick={onClose}
						className="absolute right-3.5 top-3.5 grid h-7 w-7 place-items-center rounded-full bg-white/25 text-white backdrop-blur-sm"
						title="关闭"
					>
						<Icon.close size={14} />
					</button>
					<div className="absolute -bottom-7 left-5 flex items-end gap-3">
						<Avatar name={displayName(draft)} color={color} size={64} ring />
						<div className="pb-2 text-white drop-shadow-sm">
							<div className="text-base font-bold">{displayName(draft)}</div>
							<div className="text-[11px] opacity-90">
								UID {draft.uid}
								{draft.cachedProfile?.fans != null
									? ` · ${
											draft.cachedProfile.fans >= 10_000
												? `${(draft.cachedProfile.fans / 10_000).toFixed(1)}万`
												: draft.cachedProfile.fans
										}`
									: ""}
							</div>
						</div>
					</div>
				</div>

				<div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-10">
					{/* live status row */}
					<div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
						<StatusDot kind={draft.state.liveStatus === "live" ? "living" : "off"} />
						<span className="text-[12.5px] font-bold text-bn-text-primary">
							{draft.state.liveStatus === "live"
								? "正在直播"
								: draft.state.liveStatus === "idle"
									? "未在直播"
									: "直播状态未知"}
						</span>
					</div>

					<Section label="基本">
						<Row label="启用订阅" sub="关闭后不再接收推送">
							<Toggle value={draft.enabled} onChange={setEnabled} size="sm" />
						</Row>
						<Row label="分组" sub="多个分组以逗号分隔">
							<input
								className="w-32 rounded border border-gray-200 px-1.5 py-1 text-right text-[12px] focus:outline-none focus:ring-1 focus:ring-bn-pink"
								value={draft.groups.join(",")}
								onChange={(e) => setGroups(e.target.value)}
							/>
						</Row>
						<Row label="备注">
							<input
								className="w-32 rounded border border-gray-200 px-1.5 py-1 text-right text-[12px] focus:outline-none focus:ring-1 focus:ring-bn-pink"
								value={draft.notes ?? ""}
								onChange={(e) => setNotes(e.target.value)}
							/>
						</Row>
					</Section>

					<Section label="推送类型">
						{PRIMARY_FEATURES.map(({ key, sub, tone }) => (
							<Row
								key={key}
								label={FEATURE_LABELS[key]}
								sub={sub}
								icon={<span className="block h-2 w-2 rounded-sm" style={{ background: tone }} />}
							>
								<Toggle
									value={draft.routing[key].length > 0}
									onChange={(on) => toggleFeature(key, on)}
									size="sm"
								/>
							</Row>
						))}
					</Section>

					<Section label="推送目标">
						<div className="space-y-2 px-3 py-2.5">
							<div className="flex flex-wrap gap-1.5">
								{routedIds.length === 0 ? (
									<span className="text-[11px] text-bn-text-secondary">尚未绑定任何目标</span>
								) : (
									routedIds.map((id) => {
										const t = targetsByIdMap.get(id);
										return (
											<span
												key={id}
												className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[11.5px] text-bn-text-tertiary"
											>
												<PlatformIcon platform={t?.platform ?? "onebot"} size={12} />
												{t?.name ?? id.slice(0, 6)}
												<button
													type="button"
													onClick={() => detachTarget(id)}
													className="text-bn-text-secondary hover:text-red-500"
													aria-label="移除目标"
												>
													×
												</button>
											</span>
										);
									})
								)}
							</div>
							{unroutedTargets.length > 0 ? (
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="text-[11px] text-bn-text-secondary">添加：</span>
									{unroutedTargets.map((t) => (
										<button
											type="button"
											key={t.id}
											onClick={() => attachTarget(t.id)}
											className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[11.5px] text-bn-text-secondary hover:border-bn-pink hover:text-bn-pink"
										>
											<Icon.plus size={11} />
											<PlatformIcon platform={t.platform} size={12} />
											{t.name}
										</button>
									))}
								</div>
							) : null}
						</div>
					</Section>

					<Section label="高级规则">
						<Row label="进入「高级规则」配置过滤词、模板、AI 偏好" sub="覆盖全局默认值">
							<Btn
								size="sm"
								variant="ghost"
								onClick={() => {
									window.location.assign("/rules");
								}}
							>
								前往
							</Btn>
						</Row>
					</Section>
				</div>

				<div className="flex items-center gap-2 border-t border-gray-200 px-3.5 py-3">
					<Btn
						variant="danger"
						size="sm"
						icon={<Icon.trash size={12} />}
						onClick={onDelete}
						disabled={saving}
					>
						移除订阅
					</Btn>
					<div className="flex-1" />
					<Btn variant="outline" size="sm" onClick={onClose} disabled={saving}>
						取消
					</Btn>
					<Btn
						variant="primary"
						size="sm"
						onClick={() => onSave(draft)}
						disabled={saving || !dirty}
					>
						{saving ? "保存中…" : "保存配置"}
					</Btn>
				</div>
			</aside>
		</div>
	);
}
