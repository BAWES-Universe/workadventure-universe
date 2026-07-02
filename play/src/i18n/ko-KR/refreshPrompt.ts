import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "새로 고침",
    serviceWorkerUpdate: {
        message: "게임이 업데이트되었습니다 - 탭하여 다시 불러오기",
        reload: "다시 불러오기",
        later: "나중에",
        dismissLabel: "업데이트 알림 닫기",
    },
    nativeUpdate: {
        modal: {
            title: "앱을 업데이트하세요",
            message:
                "버전 {currentVersion}은 더 이상 지원되지 않습니다. 계속하려면 {requiredVersion} 이상으로 업데이트하세요.",
            updateButton: "앱 업데이트",
            retryButton: "다시 시도",
        },
        banner: {
            message: "새 앱 버전 {latestVersion}을 사용할 수 있습니다.",
            updateButton: "업데이트",
            laterButton: "나중에",
            dismissLabel: "앱 업데이트 알림 닫기",
        },
    },
};

export default refreshPrompt;
