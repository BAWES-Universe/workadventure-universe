import type { BaseTranslation } from "../i18n-types";

const refreshPrompt: BaseTranslation = {
    refresh: "Refresh",
    serviceWorkerUpdate: {
        message: "Game updated - tap to reload",
        reload: "Reload",
        later: "Later",
        dismissLabel: "Dismiss update prompt",
    },
    nativeUpdate: {
        modal: {
            title: "Please update the app",
            message:
                "Version {currentVersion} is no longer supported. Update to {requiredVersion} or newer to continue.",
            updateButton: "Update app",
            retryButton: "Try again",
        },
        banner: {
            message: "New app version {latestVersion} is available.",
            updateButton: "Update",
            laterButton: "Later",
            dismissLabel: "Dismiss native update prompt",
        },
    },
};

export default refreshPrompt;
