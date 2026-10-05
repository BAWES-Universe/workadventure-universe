import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Slědujoš {leader}",
        waitingFollowers: "Cakanje na wobtwarźenje...",
        followed: {
            one: "{follower} slědujo śi",
            two: "{firstFollower} a {secondFollower} slědujotej śi",
            many: "{followers} a {lastFollower} slěduju śi",
        },
    },
    interactMenu: {
        stop: {
            leader: "Njocoš wěcej wjednik byś?",
            follower: "Njocoš wěcej slědowaś {leader}?",
        },
        yes: "Jo",
        no: "Ně",
    },
    actionName: "Lokalizěrowaś",
    ask: {
        one: "Pšosy {name}, aby śi slědował",
        many: "Pšosy {count} luźi, aby śi slědowali",
    },
    request: {
        titleOne: "Sy {name} pšosył, aby śi slědował",
        titleMany: "Sy {count} luźi pšosył, aby śi slědowali",
        waiting: "Cakanje na wótegrono",
        anyone: "Kenž jo groni, slědujo śi ned",
        cancel: "Pšosbu pśetergnuś",
        state: {
            waiting: "Caka…",
            following: "Slědujo",
            declined: "Jo wótpokazał",
        },
    },
    question: {
        title: "{leader} co, aby slědował",
        desc: "Twój Woka źo za {leader}, daniž njepśestanjoš",
        notNow: "Nic něnto",
        follow: "Slědowaś",
    },
    stop: "Stoj",
    notes: {
        saidNo: "{name} jo wótpokazał",
        noAnswer: "{name} njejo wótegronił",
        nobodySaidYes: "Nichten njejo jo groni",
        cancelled: "{leader} jo pšosbu pśetergnuł",
        stoppedLeading: "{leader} wěcej njewjeźo",
        timedOut: "Pšosba jo se minuła",
    },
    menu: {
        cancel: "Pšosbu pśetergnuś",
        stopLeading: "Wěcej njewjasć",
    },
};

export default follow;
