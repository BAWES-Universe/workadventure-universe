import type { BaseTranslation } from "../i18n-types";

const refreshPrompt: BaseTranslation = {
    refresh: "Atualizar",
    serviceWorkerUpdate: {
        message: "Jogo atualizado - toque para recarregar",
        reload: "Recarregar",
        later: "Depois",
        dismissLabel: "Dispensar aviso de atualização",
    },
    nativeUpdate: {
        modal: {
            title: "Atualize o app",
            message:
                "A versão {currentVersion} não é mais compatível. Atualize para {requiredVersion} ou mais recente para continuar.",
            updateButton: "Atualizar app",
            retryButton: "Tentar novamente",
        },
        banner: {
            message: "A nova versão {latestVersion} do app está disponível.",
            updateButton: "Atualizar",
            laterButton: "Depois",
            dismissLabel: "Dispensar aviso de atualização do app",
        },
    },
};

export default refreshPrompt;
