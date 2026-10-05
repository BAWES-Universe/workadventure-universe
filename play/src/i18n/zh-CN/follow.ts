import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "跟随 {leader}",
        waitingFollowers: "等待跟随者确认",
        followed: {
            one: "{follower} 正在跟随你",
            two: "{firstFollower} 和 {secondFollower} 正在跟随你",
            many: "{followers} 和 {lastFollower} 正在跟随你",
        },
    },
    interactMenu: {
        stop: {
            leader: "要停止领路吗?",
            follower: "要停止跟随 {leader} 吗？",
        },
        yes: "是",
        no: "否",
    },
    actionName: "定位",
    ask: {
        one: "请 {name} 跟随你",
        many: "请 {count} 人跟随你",
    },
    request: {
        titleOne: "你已请 {name} 跟随你",
        titleMany: "你已请 {count} 人跟随你",
        waiting: "正在等待对方回答",
        anyone: "同意的人会立即开始跟随",
        cancel: "取消请求",
        state: {
            waiting: "等待中…",
            following: "正在跟随",
            declined: "已拒绝",
        },
    },
    question: {
        title: "{leader} 想让你跟随",
        desc: "你的 Woka 会走在 {leader} 身后，直到你停止",
        notNow: "暂不",
        follow: "跟随",
    },
    stop: "停止",
    notes: {
        saidNo: "{name} 拒绝了",
        noAnswer: "{name} 没有回答",
        nobodySaidYes: "没有人同意",
        cancelled: "{leader} 取消了跟随请求",
        stoppedLeading: "{leader} 停止了带领",
        timedOut: "跟随请求已超时",
    },
    menu: {
        cancel: "取消跟随请求",
        stopLeading: "停止带领",
    },
};

export default follow;
