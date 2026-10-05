import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Vous suivez {leader}",
        waitingFollowers: "En attente de la confirmation des suiveurs",
        followed: {
            one: "{follower} vous suit",
            two: "{firstFollower} et {secondFollower} vous suivent",
            many: "{followers} et {lastFollower} vous suivent",
        },
    },
    interactMenu: {
        stop: {
            leader: "Voulez-vous qu'on arrête de vous suivre?",
            follower: "Voulez-vous arrêter de suivre {leader}?",
        },
        yes: "Oui",
        no: "Non",
    },
    actionName: "Localiser",
    ask: {
        one: "Demande à {name} de vous suivre",
        many: "Demande à {count} personnes de vous suivre",
    },
    request: {
        titleOne: "Vous avez demandé à {name} de vous suivre",
        titleMany: "Vous avez demandé à {count} personnes de vous suivre",
        waiting: "En attente de sa réponse",
        anyone: "Toute personne qui accepte vous suit tout de suite",
        cancel: "Annuler la demande",
        state: {
            waiting: "En attente…",
            following: "Vous suit",
            declined: "A refusé",
        },
    },
    question: {
        title: "Invitation à suivre {leader}",
        desc: "Votre Woka marche derrière {leader} jusqu'à ce que vous arrêtiez",
        notNow: "Pas maintenant",
        follow: "Suivre",
    },
    stop: "Arrêter",
    notes: {
        saidNo: "{name} a refusé",
        noAnswer: "{name} n'a pas répondu",
        nobodySaidYes: "Personne n'a accepté",
        cancelled: "{leader} a annulé la demande",
        stoppedLeading: "{leader} a arrêté de guider",
        timedOut: "La demande a expiré",
    },
    menu: {
        cancel: "Annuler la demande",
        stopLeading: "Arrêter de guider",
    },
};

export default follow;
