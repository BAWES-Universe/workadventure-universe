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
    },
};

export default chat;
