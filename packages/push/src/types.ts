/**
 * Push type enum — kept for historical reference / compatibility.
 * New code should use FeatureKey from @bilibili-notify/internal.
 */
export enum PushType {
	Live = 0,
	Dynamic = 1,
	StartBroadcasting = 3,
	LiveGuardBuy = 4,
	WordCloudAndLiveSummary = 5,
	Superchat = 6,
	UserDanmakuMsg = 7,
	UserActions = 8,
	LiveEnd = 9,
}

export const PUSH_TYPE_LABEL: Record<PushType, string> = {
	[PushType.Live]: "直播推送",
	[PushType.Dynamic]: "动态推送",
	[PushType.StartBroadcasting]: "开播推送",
	[PushType.LiveGuardBuy]: "上舰推送",
	[PushType.WordCloudAndLiveSummary]: "弹幕词云和直播总结推送",
	[PushType.Superchat]: "SC推送",
	[PushType.UserDanmakuMsg]: "用户弹幕推送",
	[PushType.UserActions]: "用户行为推送",
	[PushType.LiveEnd]: "下播推送",
};
