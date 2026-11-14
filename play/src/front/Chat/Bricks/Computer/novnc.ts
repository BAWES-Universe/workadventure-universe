// The screen viewer (noVNC) is loaded only when a Brick's screen opens. Its files are copied from node_modules at build time (see
// vite.config.mts) and served by the game itself, never fetched from a CDN. They load as they are, rather than being bundled: the
// package uses a top-level await, which the bundler's legacy pass for older phones cannot read.

/** The part of noVNC's viewer this game uses. */
export interface RfbConnection {
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    background: string;
    addEventListener(type: "connect" | "disconnect" | "securityfailure", listener: (event: Event) => void): void;
    removeEventListener(type: "connect" | "disconnect" | "securityfailure", listener: (event: Event) => void): void;
    disconnect(): void;
}

export type RfbConstructor = new (target: HTMLElement, url: string, options?: { wsProtocols?: string[] }) => RfbConnection;

/** Where the build copies the files noVNC reads at run time. */
export const NOVNC_ASSETS_PATH = "/static/novnc/";

let loading: Promise<RfbConstructor> | undefined;

export function loadNoVnc(): Promise<RfbConstructor> {
    loading ??= (import(/* @vite-ignore */ new URL(NOVNC_ASSETS_PATH + "core/rfb.js", window.location.origin).toString()) as Promise<{ default: RfbConstructor }>)
        .then((module) => module.default)
        .catch((error) => {
            // A failed load (offline for a moment) is tried again the next time a screen opens.
            loading = undefined;
            throw error;
        });
    return loading;
}
