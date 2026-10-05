import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "{leader} folgen",
        waitingFollowers: "Warten auf Bestätigung...",
        followed: {
            one: "{follower} folgt dir",
            two: "{firstFollower} und {secondFollower} folgen dir",
            many: "{followers} und {lastFollower} folgen dir",
        },
    },
    interactMenu: {
        yes: "Ja",
        no: "Nein",
    },
    actionName: "Lokalisieren",
    ask: {
        one: "Bittet {name}, dir zu folgen",
        many: "Bittet {count} Personen, dir zu folgen",
    },
    request: {
        titleOne: "Du hast {name} gebeten, dir zu folgen",
        titleMany: "Du hast {count} Personen gebeten, dir zu folgen",
        waiting: "Warte auf die Antwort",
        anyone: "Wer zusagt, folgt dir sofort",
        cancel: "Anfrage abbrechen",
        state: {
            waiting: "Wartet…",
            following: "Folgt dir",
            declined: "Abgelehnt",
        },
    },
    question: {
        title: "{leader} möchte, dass du folgst",
        desc: "Dein Woka läuft hinter {leader}, bis du stoppst",
        notNow: "Nicht jetzt",
        follow: "Folgen",
    },
    stop: "Stopp",
    notes: {
        saidNo: "{name} hat abgelehnt",
        noAnswer: "{name} hat nicht geantwortet",
        nobodySaidYes: "Niemand hat zugesagt",
        cancelled: "{leader} hat die Anfrage abgebrochen",
        stoppedLeading: "{leader} führt nicht mehr",
        timedOut: "Die Anfrage ist abgelaufen",
    },
    menu: {
        cancel: "Anfrage abbrechen",
        stopLeading: "Nicht mehr führen",
    },
};

export default follow;
