import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Aktualisieren",
    serviceWorkerUpdate: {
        message: "Spiel wurde aktualisiert - zum Neuladen tippen",
        reload: "Neu laden",
        later: "Später",
        dismissLabel: "Update-Hinweis schließen",
    },
    nativeUpdate: {
        modal: {
            title: "Bitte aktualisiere die App",
            message:
                "Version {currentVersion} wird nicht mehr unterstützt. Aktualisiere auf {requiredVersion} oder neuer, um fortzufahren.",
            updateButton: "App aktualisieren",
            retryButton: "Erneut versuchen",
        },
        banner: {
            message: "Neue App-Version {latestVersion} ist verfügbar.",
            updateButton: "Aktualisieren",
            laterButton: "Später",
            dismissLabel: "Hinweis zum App-Update schließen",
        },
    },
};

export default refreshPrompt;
