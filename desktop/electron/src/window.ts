import { BrowserView, BrowserWindow } from "electron";
import electronIsDev from "electron-is-dev";
import windowStateKeeper from "electron-window-state";
import path from "path";

/** The canonical Universe deployment. Never changes at runtime. */
const UNIVERSE_URL = "https://universe.bawes.net";

let mainWindow: BrowserWindow | undefined;
let appView: BrowserView | undefined;

export function getWindow() {
    return mainWindow;
}

export function getAppView() {
    return appView;
}

function resizeAppView() {
    setTimeout(() => {
        if (!mainWindow || !appView) return;
        const { width, height } = mainWindow.getBounds();
        appView.setBounds({ x: 0, y: 0, width, height });
    });
}

/** Inline HTML shown when Universe is unreachable. Auto-retries every 10s. */
function offlinePageHtml(): string {
    return `<!DOCTYPE html>
<html style="margin:0;background:#0a0a0a;color:#fff;font-family:sans-serif">
<body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px">
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#4f98a3" stroke-width="1.5">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 8v4M12 16h.01"/>
  </svg>
  <h2 style="margin:0">Unable to reach Universe</h2>
  <p style="margin:0;color:#888">Check your connection. Retrying automatically&hellip;</p>
  <button onclick="location.reload()" style="padding:10px 24px;background:#4f98a3;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">Reload Now</button>
  <script>
    setTimeout(() => location.reload(), 10000);
  <\/script>
</body></html>`;
}

export async function createWindow() {
    if (mainWindow) return;

    const windowState = windowStateKeeper({
        defaultWidth: 1280,
        defaultHeight: 800,
        maximize: true,
    });

    mainWindow = new BrowserWindow({
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        autoHideMenuBar: true,
        show: false,
        webPreferences: { contextIsolation: true },
    });
    mainWindow.setMenu(null);
    windowState.manage(mainWindow);

    mainWindow.on("closed", () => {
        mainWindow = undefined;
        appView = undefined;
    });

    // BrowserView fills the entire window (no sidebar)
    appView = new BrowserView({
        webPreferences: {
            preload: path.resolve(__dirname, "..", "dist", "preload-app", "preload.js"),
            contextIsolation: true,
            allowRunningInsecureContent: false,
        },
    });

    mainWindow.addBrowserView(appView);
    resizeAppView();
    appView.setAutoResize({ width: true, height: true });
    mainWindow.on("resize", resizeAppView);

    mainWindow.once("ready-to-show", () => mainWindow?.show());

    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow?.setTitle("Universe");
    });

    // Handle offline / failed load gracefully
    appView.webContents.on("did-fail-load", (_event, errorCode) => {
        // -3 = ERR_ABORTED (navigation cancels, not a real failure)
        if (errorCode === -3) return;
        void appView?.webContents.loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(offlinePageHtml())}`
        );
    });

    const targetUrl = electronIsDev && process.env.LOCAL_APP_URL
        ? process.env.LOCAL_APP_URL
        : UNIVERSE_URL;

    await appView.webContents.loadURL(targetUrl);
}

/** Load a specific URL in the BrowserView (used by deep-link IPC). */
export async function showAppView(url?: string) {
    if (!appView || !mainWindow) throw new Error("Window not initialised");
    if (url) await appView.webContents.loadURL(url);
    appView.webContents.focus();
}

export function hideAppView() {
    // No-op in Universe shell — no local app UI to toggle back to.
    // Kept to avoid breaking any existing IPC callers during transition.
}
