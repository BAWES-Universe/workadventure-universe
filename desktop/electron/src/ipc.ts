import { ipcMain, app, desktopCapturer } from "electron";
import electronIsDev from "electron-is-dev";
import { createAndShowNotification } from "./notification";
import { Server } from "./preload-local-app/types";
import settings, { SettingsData } from "./settings";
import { loadShortcuts, setShortcutsEnabled } from "./shortcuts";
import { getAppView, showAppView } from "./window";

export function emitMuteToggle() {
    const appView = getAppView();
    if (!appView) throw new Error("App view not found");
    appView.webContents.send("app:on-mute-toggle");
}

export function emitCameraToggle() {
    const appView = getAppView();
    if (!appView) throw new Error("App view not found");
    appView.webContents.send("app:on-camera-toggle");
}

export default () => {
    ipcMain.handle("is-development", () => electronIsDev);
    ipcMain.handle("get-version", () => (electronIsDev ? "dev" : app.getVersion()));

    // Notifications
    ipcMain.on("app:notify", (_event, txt: string) => {
        createAndShowNotification({ body: txt });
    });

    // Screen share sources (used by LiveKit screen sharing)
    ipcMain.handle("app:getDesktopCapturerSources", async (_event, options: Electron.SourcesOptions) => {
        return (await desktopCapturer.getSources(options)).map((source) => ({
            id: source.id,
            name: source.name,
            thumbnailURL: source.thumbnail.toDataURL(),
        }));
    });

    // Navigate to a URL in the Universe BrowserView (used by deep links)
    ipcMain.handle("app:navigate", async (_event, url: string) => {
        await showAppView(url);
        return true;
    });

    // Server list — kept for schema compat, returns the Universe default
    ipcMain.handle("local-app:getServers", () => settings.get("servers"));

    // Shortcuts
    ipcMain.handle("local-app:reloadShortcuts", () => loadShortcuts());
    ipcMain.handle("local-app:getSettings", () => settings.get() || {});
    ipcMain.handle(
        "local-app:saveSetting",
        <T extends keyof SettingsData>(_event: Electron.IpcMainInvokeEvent, key: T, value: SettingsData[T]) =>
            settings.set(key, value)
    );
    ipcMain.handle("local-app:setShortcutsEnabled", (_event, enabled: boolean) => setShortcutsEnabled(enabled));

    // Server management — kept for compat, not used by Universe shell UI
    ipcMain.handle("local-app:addServer", (_event, server: Omit<Server, "_id">) => {
        const servers = settings.get("servers") || [];
        const newServer = { ...server, _id: `${Date.now()}-${servers.length + 1}` };
        servers.push(newServer);
        settings.set("servers", servers);
        return newServer;
    });
    ipcMain.handle("local-app:removeServer", (_event, server: Server) => {
        const servers = settings.get("servers") || [];
        settings.set("servers", servers.filter((s) => s._id !== server._id));
        return true;
    });
};
