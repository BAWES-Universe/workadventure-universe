import type { InstallEnvironment } from "../Install/InstallPlatform";
import { isInstalledApp } from "../Install/InstallPlatform";

/**
 * Which "camera is blocked" help the player needs.
 *  - ios-app: the iPhone or iPad home screen app. It has no address bar and no site settings of its own, so the
 *    steps are: ask again, close and reopen the app, then Settings > Apps > Safari.
 *  - ios-browser: Safari (or another browser) on an iPhone or iPad: aA > Website Settings.
 *  - other: computers and Android, which keep the pictures. Universe's own native app is here too: its steps would
 *    be different, and nothing has been written for it.
 */
export type CameraHelpKind = "ios-app" | "ios-browser" | "other";

export function cameraHelpKindFor(env: InstallEnvironment): CameraHelpKind {
    if (env.nativeShell === true) return "other";
    // iPadOS 13 and later says it is a Mac, but a Mac has no touch screen.
    const isIos = /iPhone|iPod|iPad/.test(env.userAgent) || (env.platform === "MacIntel" && env.maxTouchPoints > 1);
    if (!isIos) return "other";
    return isInstalledApp(env) ? "ios-app" : "ios-browser";
}

/**
 * What "Try again" asks the browser for. A camera the browser refused is asked for again. A camera the player had off
 * stays off when only the microphone was refused: only the microphone is asked for again.
 */
export function retryPlanFor(state: { cameraRefused: boolean; microphoneRequested: boolean }): {
    camera: boolean;
    microphone: boolean;
} {
    if (state.cameraRefused) return { camera: true, microphone: false };
    return { camera: false, microphone: state.microphoneRequested };
}
