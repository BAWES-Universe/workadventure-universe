import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Seguint a {leader}",
        waitingFollowers: "Esperant la confirmació dels seguidors",
        followed: {
            one: "{follower} et segueix",
            two: "{firstFollower} i {secondFollower} et segueixen",
            many: "{followers} i {lastFollower} et segueixen",
        },
    },
    interactMenu: {
        stop: {
            leader: "Voleu deixar de liderar?",
            follower: "Voleu deixar de seguir a {leader}?",
        },
        yes: "Si",
        no: "No",
    },
    actionName: "Localitzar",
    ask: {
        one: "Demana a {name} que et segueixi",
        many: "Demana a {count} persones que et segueixin",
    },
    request: {
        titleOne: "Has demanat a {name} que et segueixi",
        titleMany: "Has demanat a {count} persones que et segueixin",
        waiting: "Esperant la resposta",
        anyone: "Qui digui que sí et segueix de seguida",
        cancel: "Cancel·la la sol·licitud",
        state: {
            waiting: "Esperant…",
            following: "Et segueix",
            declined: "Ha dit que no",
        },
    },
    question: {
        title: "Invitació per seguir {leader}",
        desc: "El teu Woka camina darrere de {leader} fins que t'aturis",
        notNow: "Ara no",
        follow: "Segueix",
    },
    stop: "Atura",
    notes: {
        saidNo: "{name} ha dit que no",
        noAnswer: "{name} no ha respost",
        nobodySaidYes: "Ningú ha dit que sí",
        cancelled: "{leader} ha cancel·lat la sol·licitud",
        stoppedLeading: "{leader} ha deixat de guiar",
        timedOut: "La sol·licitud ha caducat",
    },
    menu: {
        cancel: "Cancel·la la sol·licitud",
        stopLeading: "Deixa de guiar",
    },
};

export default follow;
