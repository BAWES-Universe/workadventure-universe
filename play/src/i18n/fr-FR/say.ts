import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    type: {
        say: "Dire",
        think: "Penser",
    },
    placeholder: "Tapez votre message ici...",
    button: "Créer une bulle",
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
    },
    tooltip: {
        description: {
            say: "Affiche une bulle de discussion au-dessus de votre personnage. Visible par tous sur la carte, elle reste affichée pendant 5 secondes.",
            think: "Affiche une bulle de pensée au-dessus de votre personnage. Visible par tous les joueurs sur la carte, elle reste affichée tant que vous ne bougez pas.",
        },
    },
};

export default say;
