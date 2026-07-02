import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Herlaad",
    serviceWorkerUpdate: {
        message: "Game bijgewerkt - tik om opnieuw te laden",
        reload: "Opnieuw laden",
        later: "Later",
        dismissLabel: "Updateprompt sluiten",
    },
    nativeUpdate: {
        modal: {
            title: "Werk de app bij",
            message:
                "Versie {currentVersion} wordt niet meer ondersteund. Werk bij naar {requiredVersion} of nieuwer om door te gaan.",
            updateButton: "App bijwerken",
            retryButton: "Opnieuw proberen",
        },
        banner: {
            message: "Nieuwe app-versie {latestVersion} is beschikbaar.",
            updateButton: "Bijwerken",
            laterButton: "Later",
            dismissLabel: "App-updateprompt sluiten",
        },
    },
};

export default refreshPrompt;
