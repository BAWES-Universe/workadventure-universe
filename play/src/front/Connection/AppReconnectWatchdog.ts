import { get } from "svelte/store";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { errorScreenStore } from "../Stores/ErrorScreenStore";
import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
import { browserWatchdogStorage, createReconnectWatchdog } from "./ReconnectWatchdog";

/** The app's reconnect safety net (see ReconnectWatchdog). */
export const reconnectWatchdog = createReconnectWatchdog({
    state: () => {
        const screen = get(errorScreenStore);
        return {
            sceneLoaded: get(gameSceneIsLoadedStore),
            screen:
                screen === undefined || screen === null
                    ? "none"
                    : screen.type === "reconnecting"
                    ? "reconnecting"
                    : "other",
        };
    },
    isVisible: () => document.visibilityState === "visible",
    isOnline: () => navigator.onLine,
    now: () => Date.now(),
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    lastReloadAt: browserWatchdogStorage.readLastReload,
    rememberReloadAt: browserWatchdogStorage.writeLastReload,
    reload: () => window.location.reload(),
    report: (properties) => analyticsClient.reconnectStuck(properties),
});
