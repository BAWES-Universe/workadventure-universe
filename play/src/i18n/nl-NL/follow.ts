import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Volgt {leader}",
        waitingFollowers: "Wachten op bevestiging van volgers",
        followed: {
            one: "{follower} volgt je",
            two: "{firstFollower} en {secondFollower} volgen je",
            many: "{followers} en {lastFollower} volgen je",
        },
    },
    interactMenu: {
        stop: {
            leader: "Wil je stoppen met de weg leiden?",
            follower: "Wil je stoppen met {leader} volgen?",
        },
        yes: "Ja",
        no: "Nee",
    },
    actionName: "Lokaliseren",
    ask: {
        one: "Vraagt {name} om je te volgen",
        many: "Vraagt {count} mensen om je te volgen",
    },
    request: {
        titleOne: "Je hebt {name} gevraagd je te volgen",
        titleMany: "Je hebt {count} mensen gevraagd je te volgen",
        waiting: "Wachten op antwoord",
        anyone: "Wie ja zegt, volgt je meteen",
        cancel: "Verzoek annuleren",
        state: {
            waiting: "Wacht…",
            following: "Volgt je",
            declined: "Zei nee",
        },
    },
    question: {
        title: "{leader} wil dat je volgt",
        desc: "Je Woka loopt achter {leader} tot je stopt",
        notNow: "Nu niet",
        follow: "Volgen",
    },
    stop: "Stop",
    notes: {
        saidNo: "{name} zei nee",
        noAnswer: "{name} heeft niet geantwoord",
        nobodySaidYes: "Niemand zei ja",
        cancelled: "{leader} heeft het verzoek geannuleerd",
        stoppedLeading: "{leader} leidt niet meer",
        timedOut: "Het verzoek is verlopen",
    },
    menu: {
        cancel: "Verzoek annuleren",
        stopLeading: "Stoppen met leiden",
    },
};

export default follow;
