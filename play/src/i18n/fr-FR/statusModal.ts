import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const statusModal: DeepPartial<Translation["statusModal"]> = {
    accept: "Accepter",
    close: "Fermer",
    confirm: "Confirmer",
    goBackToOnlineStatusLabel: "Veux-tu revenir en ligne ?",
    allowNotification: "Activer les notifications ?",
    allowNotificationExplanation:
        "Recevoir une notification lorsque quelqu'un souhaite me parler, même quand cet onglet est en arrière-plan.",
    notNow: "Pas maintenant",
    turnOn: "Activer",
};

export default statusModal;
