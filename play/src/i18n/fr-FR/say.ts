import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "Salut 👋",
        brb: "Je reviens",
        thanks: "Merci",
        ok: "OK",
    },
    type: {
        say: "Dire",
        think: "Penser",
    },
    placeholder: "Tapez votre message ici...",
    button: "Créer une bulle",
    raiseHand: {
        raise: "Lever la main",
        lower: "Baisser la main",
        next: "à vous ensuite",
        inLine: "numéro {position} dans la file",
        handUp: "Votre main est levée",
        handUpInLine: "Votre main est levée, numéro {position} dans la file",
        spoke: "Vous avez parlé, votre main va se baisser",
        keepRaised: "Garder la main levée",
        loweredByModerator: "Un modérateur a baissé votre main",
        lowerSomeone: "Baisser la main",
        lowerAll: "Baisser toutes les mains",
    },
    express: {
        button: "Exprimez-vous",
        close: "Fermer",
        placeholder: "Dites quelque chose…",
        say: "Dire",
        think: "Penser",
        send: "Envoyer",
        emote: "Jouer {emoji}",
        emotes: "Vos émotes",
        forcedSay: "En réunion, les bulles sont dites à voix haute",
        forcedThink: "Quand vous êtes absent ou occupé, les bulles sont des pensées",
        sayHint: "Visible par tous ceux qui vous voient pendant 5 secondes",
        thinkHint: "Reste au-dessus de vous jusqu'à ce que vous bougiez",
        enterToSend: "Entrée pour envoyer",
        phrases: "Phrases rapides",
        edit: "Modifier",
        done: "Terminé",
        editTitle: "Modifier Express",
        editHint: "Touchez une émote ou une phrase pour la changer",
        changeEmote: "Changer {emoji}",
        editPhrase: "Modifier « {phrase} »",
        shortcuts: {
            title: "Raccourcis",
            say: "Dire quelque chose",
            think: "Penser quelque chose",
            emote: "Jouer une émote",
            edit: "Modifier les émotes et phrases",
            rightClick: "Clic droit",
            longPress: "Appui long",
        },
    },
    tooltip: {
        description: {
            say: "Affiche une bulle de discussion au-dessus de votre personnage. Visible par tous sur la carte, elle reste affichée pendant 5 secondes.",
            think: "Affiche une bulle de pensée au-dessus de votre personnage. Visible par tous les joueurs sur la carte, elle reste affichée tant que vous ne bougez pas.",
        },
    },
};

export default say;
