import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const actionbar: DeepPartial<Translation["actionbar"]> = {
    botEditor: "机器人编辑器",
    botEditorModule: {
        visionMarker: "👁 视觉",
        providerDisabled: "(已禁用)",
        visionHelper: "能够查看图片的提供商标有 👁 — 玩家发送的图片会自动处理，无需额外设置。",
        aiProviderLabel: "AI 提供商",
        aiProviderHelp: "(为此机器人选择 AI 提供商)",
        loadingProviders: "正在加载提供商...",
        retry: "重试",
        noProvidersConfigured: "未配置 AI 提供商。请先在管理 API 中设置提供商。",
        errorNotInitialized: "机器人 API 服务未初始化",
        errorNoProviders: "没有可用的 AI 提供商。请在管理 API 中配置提供商。",
        errorLoadFailed: "加载 AI 提供商失败",
        providerVisionHeading: "AI 提供商与视觉",
        chatInstructions: "聊天指令",
        chatInstructionsHelp: "(机器人应说什么以及如何沟通)",
        chatInstructionsPlaceholder:
            "示例：你是一个名叫“WelcomeBot”的友好迎宾机器人。你的工作是欢迎大厅里的新访客。保持愉快和乐于助人。回答有关空间的问题。不要对今天已经问候过的人重复相同的问候。",
        noChatInstructions: "未设置聊天指令",
    },
    help: {
        audioManager: {
            title: "环境声音音量",
            desc: "点击此处配置音频音量。",
            pause: "点击此处暂停音频",
            play: "点击此处播放音频",
            stop: "点击此处停止音频",
        },
        audioManagerNotAllowed: {
            title: "环境声音已阻止",
            desc: "您的浏览器已阻止环境声音播放。点击图标开始播放声音。",
        },
    },
    personalDesk: {
        label: "前往我的办公桌",
        unclaim: "释放我的办公桌",
        errorNoUser: "无法找到您的用户信息",
        errorNotFound: "您还没有个人办公桌",
        errorMoving: "无法到达您的个人办公桌",
        errorUnclaiming: "无法释放您的个人办公桌",
    },
};

export default actionbar;
