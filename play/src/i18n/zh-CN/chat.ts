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
    brick: {
        computer: {
            screenInControl: "你正在操作 · {name} 在等待",
            lastStepLine: "完成付款并提交，然后交还操作。{name} 会等到你完成。",
            trustTitle: "{name} 可以完全使用这台电脑",
            trustLine:
                "{name} 可以在上面安装并运行任何东西，也能访问上面的所有内容。在这台电脑上完成的登录，可用于 {name} 的任何任务。",
            screenControlLine: "你正在 {name} 的电脑上输入。{name} 能访问上面的所有内容。",
            gettingItReady: "正在准备…",
            runningTitle: "仍有程序在运行",
            runningLine: "{name} 安装的程序仍在这台电脑上运行，可能看到你输入的内容。重启后会将其关闭。",
            restartFirst: "先重启",
            takeOverAnyway: "仍然接管",
            restartingHead: "正在重启 · {name} 会再次询问你",
            restartingLine: "正在重启 {name} 的电脑。所有内容都会关闭，然后 {name} 重新准备好页面并询问你。",
            restartingBar: "{job} · 正在重启电脑",
            runningAgainTitle: "它仍在运行",
            runningAgainLine: "它在重启后又启动了，所以仍可能看到你输入的内容。只有在这一步没有问题时才继续。",
            notNow: "暂不",
            screenInControlRunning: "你正在操作 · 仍有程序在运行",
            screenControlRunningLine: "你正在 {name} 的电脑上输入。{name} 安装的程序仍在运行，可能看到你输入的内容。",
            notReady: "无法准备好电脑。电脑上没有任何改动。请重试。",
        },
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
