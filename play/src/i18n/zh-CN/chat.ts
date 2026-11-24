import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const chat: DeepPartial<Translation["chat"]> = {
    intro: "聊天历史:",
    enter: "输入消息...",
    menu: {
        visitCard: "访问卡",
        addFriend: "添加朋友",
    },
    typing: "在打字...",
    userList: {
        editMyVisitCard: "编辑我的名片",
        viewProfile: "查看个人资料",
        follow: "定位",
    },
    botStatus: {
        online: "在线",
        resting: "休息中",
        unready: "尚未准备好",
        gone: "已离开",
        restingPlaceholder: "回复已暂停",
        unreadyPlaceholder: "暂时还不能回复",
        closed: "此聊天已关闭",
        left: "{name}已离开",
        visit: "前往",
        visitAria: "前往{room}找{name}",
        livesIn: "所在房间",
        nowIn: "当前所在",
        inThisRoom: "你就在这个房间",
    },
    artifacts: {
        openPublic: "公开",
        openPublicHelp: "拥有链接的任何人只能看到你发布的内容",
        notPublished: "尚未发布",
        publishHelp: "大家看到的是你发布的版本。之后的更改会保持私密，直到你再次发布。",
        publishVersion: "发布版本 {version}",
        publishedStatus: "已发布 · 版本 {version} · {time}",
        unpublishedChanges: "版本 {version} 尚未发布",
        linkFollows: "链接始终显示你的最新版本。",
        publishBar: "已发布：版本 {version}。版本 {latest} 尚未发布。",
        publish: "发布",
        publishing: "正在发布…",
        publishFailed: "无法发布，请重试。",
        publicUnavailable: "公开版本不可用",
        publicUnavailableHelp: "在你发布版本之前，大家会看到“不可用”。",
    },
};

export default chat;
