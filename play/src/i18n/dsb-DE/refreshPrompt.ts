import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "Aktualizěrowanje",
    serviceWorkerUpdate: {
        message: "Gra jo se zaktualizěrowała - pótusniśo, aby znowego zacytał",
        reload: "Znowego zacytaś",
        later: "Pózdźej",
        dismissLabel: "Aktualizěrowańske powěźeńje zacyniś",
    },
    nativeUpdate: {
        modal: {
            title: "Pšosym aktualizěrujśo nałoženje",
            message:
                "Wersija {currentVersion} se wěcej njepódpěra. Aktualizěrujśo na {requiredVersion} abo nowšu, aby pókšacował.",
            updateButton: "Nałoženje aktualizěrowaś",
            retryButton: "Hyšći raz wopytaś",
        },
        banner: {
            message: "Nowa wersija nałoženja {latestVersion} jo k dispoziciji.",
            updateButton: "Aktualizěrowaś",
            laterButton: "Pózdźej",
            dismissLabel: "Powěźeńje aktualizěrowanja nałoženja zacyniś",
        },
    },
};

export default refreshPrompt;
