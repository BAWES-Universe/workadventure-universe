import "phaser";
import "./front/style/index.scss";

import App from "./front/Components/App.svelte";
import { HtmlUtils } from "./front/WebRtc/HtmlUtils";
import { e2eHooks } from "./front/Utils/E2EHooks";
import { installViewportGuard } from "./front/Utils/ViewportGuard";

// Initialize E2E hooks
declare global {
    interface Window {
        e2eHooks: typeof e2eHooks;
    }
}
window.e2eHooks = e2eHooks;

// Keeps the app pinned to the screen when the iOS keyboard opens and closes.
installViewportGuard();

const app = new App({
    target: HtmlUtils.getElementByIdOrFail("app"),
});

export default app;
