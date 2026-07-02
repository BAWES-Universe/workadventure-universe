import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Aggiornare",
    serviceWorkerUpdate: {
        message: "Gioco aggiornato - tocca per ricaricare",
        reload: "Ricarica",
        later: "Più tardi",
        dismissLabel: "Chiudi avviso di aggiornamento",
    },
    nativeUpdate: {
        modal: {
            title: "Aggiorna l'app",
            message:
                "La versione {currentVersion} non è più supportata. Aggiorna alla versione {requiredVersion} o successiva per continuare.",
            updateButton: "Aggiorna app",
            retryButton: "Riprova",
        },
        banner: {
            message: "È disponibile la nuova versione {latestVersion} dell'app.",
            updateButton: "Aggiorna",
            laterButton: "Più tardi",
            dismissLabel: "Chiudi avviso di aggiornamento dell'app",
        },
    },
};

export default refreshPrompt;
