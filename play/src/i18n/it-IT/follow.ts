import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Seguendo {leader}",
        waitingFollowers: "In attesa della conferma dei follower",
        followed: {
            one: "{follower} ti sta seguendo",
            two: "{firstFollower} e {secondFollower} ti stanno seguendo",
            many: "{followers} e {lastFollower} ti stanno seguendo",
        },
    },
    interactMenu: {
        yes: "Sì",
        no: "No",
    },
    actionName: "Localizza",
    ask: {
        one: "Chiede a {name} di seguirti",
        many: "Chiede a {count} persone di seguirti",
    },
    request: {
        titleOne: "Hai chiesto a {name} di seguirti",
        titleMany: "Hai chiesto a {count} persone di seguirti",
        waiting: "In attesa della risposta",
        anyone: "Chi accetta inizia subito a seguirti",
        cancel: "Annulla richiesta",
        state: {
            waiting: "In attesa…",
            following: "Ti segue",
            declined: "Ha rifiutato",
        },
    },
    question: {
        title: "Invito a seguire {leader}",
        desc: "Il tuo Woka cammina dietro a {leader} finché non ti fermi",
        notNow: "Non ora",
        follow: "Segui",
    },
    stop: "Ferma",
    notes: {
        saidNo: "{name} ha rifiutato",
        noAnswer: "{name} non ha risposto",
        nobodySaidYes: "Nessuno ha accettato",
        cancelled: "{leader} ha annullato la richiesta",
        stoppedLeading: "{leader} ha smesso di guidare",
        timedOut: "La richiesta è scaduta",
    },
    menu: {
        cancel: "Annulla richiesta",
        stopLeading: "Smetti di guidare",
    },
};

export default follow;
