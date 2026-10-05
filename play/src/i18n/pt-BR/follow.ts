import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Seguindo {leader}",
        waitingFollowers: "Aguardando confirmação dos seguidores",
        followed: {
            one: "{follower} está seguindo você",
            two: "{firstFollower} e {secondFollower} estão seguindo você",
            many: "{followers} e {lastFollower} estão seguindo você",
        },
    },
    interactMenu: {
        stop: {
            leader: "Você quer parar de liderar o caminho?",
            follower: "Você quer parar de seguir {leader}?",
        },
        yes: "Sim",
        no: "Não",
    },
    actionName: "Localizar",
    ask: {
        one: "Pede a {name} para seguir você",
        many: "Pede a {count} pessoas para seguir você",
    },
    request: {
        titleOne: "Você pediu a {name} para seguir você",
        titleMany: "Você pediu a {count} pessoas para seguir você",
        waiting: "Aguardando a resposta",
        anyone: "Quem disser sim começa a seguir você na hora",
        cancel: "Cancelar pedido",
        state: {
            waiting: "Aguardando…",
            following: "Seguindo",
            declined: "Disse não",
        },
    },
    question: {
        title: "{leader} quer que você siga",
        desc: "Seu Woka anda atrás de {leader} até você parar",
        notNow: "Agora não",
        follow: "Seguir",
    },
    stop: "Parar",
    notes: {
        saidNo: "{name} disse não",
        noAnswer: "{name} não respondeu",
        nobodySaidYes: "Ninguém disse sim",
        cancelled: "{leader} cancelou o pedido",
        stoppedLeading: "{leader} parou de guiar",
        timedOut: "O pedido expirou",
    },
    menu: {
        cancel: "Cancelar pedido",
        stopLeading: "Parar de guiar",
    },
};

export default follow;
