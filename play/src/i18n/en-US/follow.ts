import type { BaseTranslation } from "../i18n-types";

const follow: BaseTranslation = {
    interactStatus: {
        following: "Following {leader}",
        waitingFollowers: "Waiting for followers confirmation",
        followed: {
            one: "{follower} is following you",
            two: "{firstFollower} and {secondFollower} are following you",
            many: "{followers} and {lastFollower} are following you",
        },
    },
    interactMenu: {
        stop: {
            leader: "Do you want to stop leading the way?",
            follower: "Do you want to stop following {leader}?",
        },
        yes: "Yes",
        no: "No",
    },
    actionName: "Locate",
    // Asking the bubble to follow: the menu row, the leader's card, the question, the pills and the notes.
    ask: {
        one: "Asks {name} to follow you",
        many: "Asks {count} people to follow you",
    },
    request: {
        titleOne: "You asked {name} to follow you",
        titleMany: "You asked {count} people to follow you",
        waiting: "Waiting for their answer",
        anyone: "Anyone who says yes starts following right away",
        cancel: "Cancel request",
        state: {
            waiting: "Waiting…",
            following: "Following",
            declined: "Said no",
        },
    },
    question: {
        title: "{leader} wants you to follow",
        desc: "Your Woka walks behind {leader} until you stop",
        notNow: "Not now",
        follow: "Follow",
    },
    stop: "Stop",
    notes: {
        saidNo: "{name} said no",
        noAnswer: "{name} didn't answer",
        nobodySaidYes: "Nobody said yes",
        cancelled: "{leader} cancelled the follow request",
        stoppedLeading: "{leader} stopped leading",
        timedOut: "The follow request timed out",
    },
    menu: {
        cancel: "Cancel follow request",
        stopLeading: "Stop leading",
    },
};

export default follow;
