import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "{leader} sćěhować",
        waitingFollowers: "čakaj na wobkrućenje družliny",
        followed: {
            one: "{follower} tebi slěduje",
            two: "{firstFollower} a {secondFollower} sćěhujetaj tebi",
            many: "{followers} a {lastFollower} sćěhujetaj tebi",
        },
    },
    interactMenu: {
        stop: {
            leader: "Nochceš puć dale pokazać?",
            follower: "Nochceš wjace {leader} sćěhować?",
        },
        yes: "haj",
        no: "ně",
    },
    actionName: "Lokalizować",
    ask: {
        one: "Prosy {name}, zo by tebi sćěhował",
        many: "Prosy {count} ludźi, zo bychu tebi sćěhowali",
    },
    request: {
        titleOne: "Sy {name} prosył, zo by tebi sćěhował",
        titleMany: "Sy {count} ludźi prosył, zo bychu tebi sćěhowali",
        waiting: "Čaka so na wotmołwu",
        anyone: "Štóž haj praji, tebi hnydom sćěhuje",
        cancel: "Prošstwo přetorhnyć",
        state: {
            waiting: "Čaka…",
            following: "Sćěhuje",
            declined: "Je wotpokazał",
        },
    },
    question: {
        title: "{leader} chce, zo by sćěhował",
        desc: "Twój Woka dźe za {leader}, doniž njepřestanješ",
        notNow: "Nic nětko",
        follow: "Sćěhować",
    },
    stop: "Stój",
    notes: {
        saidNo: "{name} je wotpokazał",
        noAnswer: "{name} njeje wotmołwił",
        nobodySaidYes: "Nichtó njeje haj prajił",
        cancelled: "{leader} je prošstwo přetorhnył",
        stoppedLeading: "{leader} hižo njewjedźe",
        timedOut: "Prošstwo je so minyło",
    },
    menu: {
        cancel: "Prošstwo přetorhnyć",
        stopLeading: "Hižo njewjesć",
    },
};

export default follow;
