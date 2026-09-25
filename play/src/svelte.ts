import "phaser";
import "./front/style/index.scss";

import App from "./front/Components/App.svelte";
import { HtmlUtils } from "./front/WebRtc/HtmlUtils";
import { e2eHooks } from "./front/Utils/E2EHooks";
import { installViewportGuard, isTouchScreen } from "./front/Utils/ViewportGuard";
import { analyticsClient } from "./front/Administration/AnalyticsClient";

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
}

const app = new App({
    target: HtmlUtils.getElementByIdOrFail("app"),
});

export default app;
