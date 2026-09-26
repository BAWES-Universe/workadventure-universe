import "phaser";
import "./front/style/index.scss";

import * as Sentry from "@sentry/svelte";
import App from "./front/Components/App.svelte";
import { HtmlUtils } from "./front/WebRtc/HtmlUtils";
import { e2eHooks } from "./front/Utils/E2EHooks";
import { installViewportGuard, isTouchScreen } from "./front/Utils/ViewportGuard";
import { installViewportResync } from "./front/Utils/ViewportResync";
import { analyticsClient } from "./front/Administration/AnalyticsClient";
import { startStoreFreezeWatchdog } from "./front/Utils/StoreFreezeWatchdog";
import { browserWatchdogStorage } from "./front/Connection/ReconnectWatchdog";

// Initialize E2E hooks
declare global {
    interface Window {
        e2eHooks: typeof e2eHooks;
    }
}
window.e2eHooks = e2eHooks;

// Keeps the app pinned to the screen and unzoomed on phones and tablets (the keyboard, a pinch on the interface).
// Desktop never pans or zooms the page this way, so nothing changes there.
if (isTouchScreen(window)) {
    document.documentElement.classList.add("touch-screen");
    installViewportGuard(undefined, {
        onZoomReset: (scale, reason) => analyticsClient.pageZoomReset({ scale, reason }),
    });
    // A phone can report a wrong size to a page loaded or restored in the background, with no `resize` once it's
    // right: check again whenever the page is shown.
    installViewportResync(undefined, {
        onResync: (properties) => analyticsClient.viewportResync(properties),
    });
}

// If the interface ever stops updating (see StoreFreezeWatchdog), refresh the page instead of leaving it dead.
startStoreFreezeWatchdog({
    isVisible: () => document.visibilityState === "visible",
    now: () => Date.now(),
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    lastReloadAt: browserWatchdogStorage.readLastReload,
    rememberReloadAt: browserWatchdogStorage.writeLastReload,
    reload: () => window.location.reload(),
    report: (properties) => {
        console.error("The interface stopped updating", properties);
        Sentry.captureMessage("Interface stopped updating (Svelte store queue stuck)", {
            level: "error",
            extra: properties,
        });
        analyticsClient.uiFrozen(properties);
    },
});

const app = new App({
    target: HtmlUtils.getElementByIdOrFail("app"),
});

export default app;
