import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Siguiendo a {leader}",
        waitingFollowers: "Esperando la confirmación de los seguidores",
        followed: {
            one: "{follower} le está siguiendo",
            two: "{firstFollower} y {secondFollower} le están siguiendo",
            many: "{followers} y {lastFollower} le están siguiendo",
        },
    },
    interactMenu: {
        stop: {
            leader: "¿Quiere dejar de liderar?",
            follower: "¿Quiere dejar de seguir a {leader}?",
        },
        yes: "Sí",
        no: "No",
    },
    actionName: "Localizar",
    ask: {
        one: "Pide a {name} que te siga",
        many: "Pide a {count} personas que te sigan",
    },
    request: {
        titleOne: "Pediste a {name} que te siga",
        titleMany: "Pediste a {count} personas que te sigan",
        waiting: "Esperando su respuesta",
        anyone: "Quien diga que sí te sigue enseguida",
        cancel: "Cancelar solicitud",
        state: {
            waiting: "Esperando…",
            following: "Te sigue",
            declined: "Dijo que no",
        },
    },
    question: {
        title: "{leader} quiere que le sigas",
        desc: "Tu Woka camina detrás de {leader} hasta que pares",
        notNow: "Ahora no",
        follow: "Seguir",
    },
    stop: "Parar",
    notes: {
        saidNo: "{name} dijo que no",
        noAnswer: "{name} no respondió",
        nobodySaidYes: "Nadie dijo que sí",
        cancelled: "{leader} canceló la solicitud",
        stoppedLeading: "{leader} dejó de guiar",
        timedOut: "La solicitud ha caducado",
    },
    menu: {
        cancel: "Cancelar solicitud",
        stopLeading: "Dejar de guiar",
    },
};

export default follow;
