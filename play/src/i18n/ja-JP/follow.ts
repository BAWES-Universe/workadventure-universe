import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "{leader} をフォローします",
        waitingFollowers: "フォロワーの確認を待っています",
        followed: {
            one: "{follower} がフォローしています",
            two: "{firstFollower} と {secondFollower} がフォローしています",
            many: "{followers} と {lastFollower} がフォローしています",
        },
    },
    interactMenu: {
        yes: "はい",
        no: "いいえ",
    },
    actionName: "位置を特定",
    ask: {
        one: "{name} にフォローを頼みます",
        many: "{count} 人にフォローを頼みます",
    },
    request: {
        titleOne: "{name} にフォローを頼みました",
        titleMany: "{count} 人にフォローを頼みました",
        waiting: "返事を待っています",
        anyone: "「はい」と答えた人からすぐにフォローを始めます",
        cancel: "リクエストを取り消す",
        state: {
            waiting: "待機中…",
            following: "フォロー中",
            declined: "断りました",
        },
    },
    question: {
        title: "{leader} がフォローを頼んでいます",
        desc: "止めるまで、あなたの Woka が {leader} の後ろを歩きます",
        notNow: "今はしない",
        follow: "フォローする",
    },
    stop: "やめる",
    notes: {
        saidNo: "{name} が断りました",
        noAnswer: "{name} から返事がありませんでした",
        nobodySaidYes: "誰も「はい」と答えませんでした",
        cancelled: "{leader} がリクエストを取り消しました",
        stoppedLeading: "{leader} が先導をやめました",
        timedOut: "フォローのリクエストが期限切れになりました",
    },
    menu: {
        cancel: "リクエストを取り消す",
        stopLeading: "先導をやめる",
    },
};

export default follow;
