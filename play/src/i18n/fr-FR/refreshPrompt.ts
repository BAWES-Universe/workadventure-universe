import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Rafraîchir",
    serviceWorkerUpdate: {
        message: "Le jeu a été mis à jour - touchez pour recharger",
        reload: "Recharger",
        later: "Plus tard",
        dismissLabel: "Fermer l'invite de mise à jour",
    },
    nativeUpdate: {
        modal: {
            title: "Veuillez mettre à jour l'application",
            message:
                "La version {currentVersion} n'est plus prise en charge. Mettez à jour vers la version {requiredVersion} ou une version plus récente pour continuer.",
            updateButton: "Mettre à jour l'application",
            retryButton: "Réessayer",
        },
        banner: {
            message: "La nouvelle version {latestVersion} de l'application est disponible.",
            updateButton: "Mettre à jour",
            laterButton: "Plus tard",
            dismissLabel: "Fermer l'invite de mise à jour de l'application",
        },
    },
};

export default refreshPrompt;
