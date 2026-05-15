import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import log from "electron-log";
import * as isDev from "electron-is-dev";
import * as util from "util";
import { createAndShowNotification } from "./notification";

const sleep = util.promisify(setTimeout);

let isCheckPending = false;
let isManualRequestedUpdate = false;

export async function checkForUpdates() {
    if (isCheckPending || isDev) return;
    isCheckPending = true;
    await autoUpdater.checkForUpdates();
    isCheckPending = false;
}

export async function manualRequestUpdateCheck() {
    isManualRequestedUpdate = true;
    createAndShowNotification({ body: "Checking for updates\u2026" });
    await checkForUpdates();
    isManualRequestedUpdate = false;
}

async function init() {
    autoUpdater.logger = log;

    autoUpdater.on("update-downloaded", ({ releaseNotes, releaseName }) => {
        void (async () => {
            const { response } = await dialog.showMessageBox({
                type: "question",
                buttons: ["Install and Restart", "Install Later"],
                defaultId: 0,
                title: "Universe \u2014 Update Ready",
                message: process.platform === "win32" ? releaseNotes : releaseName,
                detail: "A new version has been downloaded. Restart the app to apply the update.",
            });
            if (response === 0) {
                await sleep(1000);
                autoUpdater.quitAndInstall();
                app.quit();
            }
        })();
    });

    if (process.platform === "linux" && !process.env.APPIMAGE) {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.on("update-available", () => {
            createAndShowNotification({
                title: "Universe \u2014 Update Available",
                body: "Download the latest version from universe.bawes.net",
            });
        });
    }

    autoUpdater.on("update-not-available", () => {
        if (isManualRequestedUpdate) {
            createAndShowNotification({ body: "You\u2019re on the latest version." });
        }
    });

    await checkForUpdates();

    // Check every hour. Fixed: was passing fn ref instead of calling it.
    setInterval(() => void checkForUpdates(), 1000 * 60 * 60);
}

export default { init };
