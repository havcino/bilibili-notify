import { useEffect, useMemo, useState } from "react";
import { Avatar, Btn, PlatformIcon, StatusDot, Toggle } from "../../components/atoms";
import { ModalShell } from "../../components/dialog";
import { Icon } from "../../components/icons";
import {
	FEATURE_LABELS,
	type FeatureKey,
	type PushTarget,
	type Subscription,
} from "../../types/domain";
import { colorFromUid, displayName, targetsById as makeTargetsById } from "./helpers";

const FEATURE_GROUPS: ReadonlyArray<{
	label: string;
	keys: ReadonlyArray<{ key: FeatureKey; sub?: string }>;
}> = [
	{
		label: "动态",
		keys: [
			{ key: "dynamic", sub: "投稿 / 转发 / 专栏" },
			{ key: "dynamicAtAll", sub: "动态推送时 @所有人" },
		],
	},
	{
		label: "直播",
		keys: [
			{ key: "live", sub: "开播提醒" },
			{ key: "liveAtAll", sub: "开播时 @所有人" },
			{ key: "liveEnd", sub: "下播提醒" },
			{ key: "liveGuardBuy", sub: "舰长 / 提督 / 总督" },
			{ key: "superchat", sub: "Super Chat 提醒" },
			{ key: "wordcloud", sub: "弹幕词云" },
			{ key: "liveSummary", sub: "直播结束后 AI 总结" },
		],
	},
	{
		label: "特别关注",
		keys: [
			{ key: "specialDanmaku", sub: "特别关注用户的弹幕" },
			{ key: "specialUserEnter", sub: "特别关注用户进直播间" },
		],
	},
];

export interface UpDialogProps {
	sub: Subscription | null;
	targets: PushTarget[];
	onClose: () => void;
	onSave: (next: Subscription) => void;
	onDelete: () => void;
	saving: boolean;
}

export function UpDialog({ sub, targets, onClose, onSave, onDelete, saving }: UpDialogProps) {
	const [draft, setDraft] = useState<Subscription | null>(sub);

	useEffect(() => {
		setDraft(sub);
	}, [sub]);

	const targetsByIdMap = useMemo(() => makeTargetsById(targets), [targets]);

	if (!draft) return null;

	const color = colorFromUid(draft.uid);
	const dirty = sub ? JSON.stringify(sub) !== JSON.stringify(draft) : false;

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

	function setFeatureEnabled(k: FeatureKey, on: boolean): void {
		setDraft((d) => {
			if (!d) return d;
			const next = { ...(d.overrides.features ?? {}) } as Record<string, boolean>;
			if (on) {
				// Removing the override lets the feature inherit the global default
				// (currently true for every feature, mirroring the design's
				// implicit "on by default" behaviour).
				delete next[k];
			} else {
				next[k] = false;
			}
			const features = Object.keys(next).length > 0 ? next : undefined;
			return { ...d, overrides: { ...d.overrides, features } };
		});
	}

	function toggleRoute(targetId: string, k: FeatureKey): void {
		setDraft((d) => {
			if (!d) return d;
			const list = d.routing[k];
			const has = list.includes(targetId);
			const nextList = has ? list.filter((id) => id !== targetId) : [...list, targetId];
			return { ...d, routing: { ...d.routing, [k]: nextList } };
		});
	}

	return (
		<ModalShell
			onCancel={onClose}
			width={540}
			bodyClassName=""
			bodyStyle={{ maxHeight: "90vh", display: "flex", flexDirection: "column" }}
		>
			{/* Cover header */}
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

			{/* Body */}
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-10">
				{/* Live status */}
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

				{/* Basic row: enabled + groups + notes inline */}
				<section>
					<SectionHeader label="基础" />
					<div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
						<BasicRow label="启用订阅" sub="关闭后整体停止接收推送">
							<Toggle value={draft.enabled} onChange={setEnabled} size="sm" />
						</BasicRow>
						<BasicRow label="分组" sub="多个分组以英文逗号分隔">
							<input
								className="w-40 rounded border border-gray-200 px-1.5 py-1 text-right text-[12px] focus:outline-none focus:ring-1 focus:ring-bn-pink"
								value={draft.groups.join(",")}
								onChange={(e) => setGroups(e.target.value)}
							/>
						</BasicRow>
						<BasicRow label="备注">
							<input
								className="w-40 rounded border border-gray-200 px-1.5 py-1 text-right text-[12px] focus:outline-none focus:ring-1 focus:ring-bn-pink"
								value={draft.notes ?? ""}
								onChange={(e) => setNotes(e.target.value)}
							/>
						</BasicRow>
					</div>
				</section>

				{/* Per-feature: 总开关 + target multi-select */}
				{FEATURE_GROUPS.map((group) => (
					<section key={group.label}>
						<SectionHeader label={group.label} />
						<div className="space-y-2">
							{group.keys.map(({ key, sub: featSub }) => (
								<FeatureRow
									key={key}
									featureKey={key}
									sub={featSub}
									enabled={draft.overrides.features?.[key] ?? true}
									routedIds={draft.routing[key]}
									targets={targets}
									targetsByIdMap={targetsByIdMap}
									onToggleFeature={(on) => setFeatureEnabled(key, on)}
									onToggleRoute={(targetId) => toggleRoute(targetId, key)}
								/>
							))}
						</div>
					</section>
				))}

				{targets.length === 0 ? (
					<div className="rounded-md border border-dashed border-gray-200 px-3 py-3 text-center text-[11.5px] text-bn-text-secondary">
						尚未配置任何推送目标 · 请先到「推送目标」页面创建
					</div>
				) : null}
			</div>

			{/* Footer */}
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
		</ModalShell>
	);
}

// ── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
	return (
		<div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-bn-text-tertiary">
			{label}
		</div>
	);
}

// ── Basic row (label/sub/control inline) ─────────────────────────────────────

function BasicRow({
	label,
	sub,
	children,
}: {
	label: string;
	sub?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0">
			<div className="min-w-0 flex-1">
				<div className="text-[12.5px] font-semibold text-bn-text-primary">{label}</div>
				{sub ? <div className="mt-0.5 text-[11px] text-bn-text-secondary">{sub}</div> : null}
			</div>
			{children}
		</div>
	);
}

// ── Feature row (master switch + per-target chips) ───────────────────────────

function FeatureRow({
	featureKey,
	sub,
	enabled,
	routedIds,
	targets,
	targetsByIdMap,
	onToggleFeature,
	onToggleRoute,
}: {
	featureKey: FeatureKey;
	sub?: string;
	enabled: boolean;
	routedIds: string[];
	targets: PushTarget[];
	targetsByIdMap: Map<string, PushTarget>;
	onToggleFeature: (on: boolean) => void;
	onToggleRoute: (targetId: string) => void;
}) {
	// Stale target ids (target was deleted after routing was recorded). Keep
	// them visible as a removable chip so users can clean up the dangling
	// reference without going back to the schema.
	const staleIds = routedIds.filter((id) => !targetsByIdMap.has(id));

	return (
		<div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
			{/* Header row */}
			<div className="flex items-center gap-3 px-3 py-2">
				<Toggle value={enabled} onChange={onToggleFeature} size="sm" />
				<div className="min-w-0 flex-1">
					<div
						className={`text-[12.5px] font-semibold ${
							enabled ? "text-bn-text-primary" : "text-bn-text-secondary"
						}`}
					>
						{FEATURE_LABELS[featureKey]}
					</div>
					{sub ? <div className="mt-0.5 text-[11px] text-bn-text-secondary">{sub}</div> : null}
				</div>
				{enabled ? (
					<span className="font-mono text-[10.5px] text-bn-text-tertiary">
						{routedIds.length}/{targets.length}
					</span>
				) : (
					<span className="text-[11px] text-bn-text-tertiary">已关闭</span>
				)}
			</div>

			{/* Target chips (only when feature ON) */}
			{enabled && targets.length > 0 ? (
				<div className="flex flex-wrap gap-1.5 border-t border-gray-100 bg-[#fafafa] px-3 py-2">
					{targets.map((t) => {
						const on = routedIds.includes(t.id);
						return (
							<button
								type="button"
								key={t.id}
								onClick={() => onToggleRoute(t.id)}
								className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition ${
									on
										? "border-bn-pink bg-bn-pink/10 text-bn-pink"
										: "border-gray-200 bg-white text-bn-text-secondary hover:border-bn-pink/60 hover:text-bn-text-primary"
								}`}
							>
								<PlatformIcon platform={t.platform} size={11} />
								<span className="max-w-[120px] truncate">{t.name}</span>
								{on ? <Icon.check size={11} /> : null}
							</button>
						);
					})}
					{staleIds.map((id) => (
						<button
							type="button"
							key={id}
							onClick={() => onToggleRoute(id)}
							className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-red-300 bg-red-50/50 px-2.5 py-1 text-[11.5px] text-red-500"
							title="该推送目标已被删除,点击移除"
						>
							已失效 {id.slice(0, 6)} ×
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
