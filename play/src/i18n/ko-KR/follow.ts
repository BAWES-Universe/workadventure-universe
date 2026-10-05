import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "{leader}님을 따라가는 중",
        waitingFollowers: "팔로워 확인 대기 중",
        followed: {
            one: "{follower}님이 당신을 따라가는 중입니다",
            two: "{firstFollower}님과 {secondFollower}님이 당신을 따라가는 중입니다",
            many: "{followers}님과 {lastFollower}님이 당신을 따라가는 중입니다",
        },
    },
    interactMenu: {
        yes: "예",
        no: "아니오",
    },
    actionName: "위치 찾기",
    ask: {
        one: "{name}님에게 따라오기를 요청합니다",
        many: "{count}명에게 따라오기를 요청합니다",
    },
    request: {
        titleOne: "{name}님에게 따라오기를 요청했습니다",
        titleMany: "{count}명에게 따라오기를 요청했습니다",
        waiting: "답변을 기다리는 중",
        anyone: "수락한 사람은 바로 따라오기 시작합니다",
        cancel: "요청 취소",
        state: {
            waiting: "대기 중…",
            following: "따라오는 중",
            declined: "거절함",
        },
    },
    question: {
        title: "{leader}님이 따라오기를 요청했습니다",
        desc: "멈출 때까지 내 Woka가 {leader}님 뒤를 따라 걷습니다",
        notNow: "나중에",
        follow: "따라가기",
    },
    stop: "멈추기",
    notes: {
        saidNo: "{name}님이 거절했습니다",
        noAnswer: "{name}님이 답하지 않았습니다",
        nobodySaidYes: "아무도 수락하지 않았습니다",
        cancelled: "{leader}님이 요청을 취소했습니다",
        stoppedLeading: "{leader}님이 안내를 멈췄습니다",
        timedOut: "따라가기 요청이 만료되었습니다",
    },
    menu: {
        cancel: "요청 취소",
        stopLeading: "안내 멈추기",
    },
};

export default follow;
