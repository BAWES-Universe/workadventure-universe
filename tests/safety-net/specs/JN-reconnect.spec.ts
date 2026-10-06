import type { Page, WebSocketRoute } from "@playwright/test";
import { test, expect, inRoom, join, roomUrl, withFrontModule } from "../lib/game";
import { cameraHeading, openCameraScreen } from "../lib/jn";

const reconnectHeading = (page: Page) => page.getByRole("heading", { name: /Reconnecting|You're offline/ });

/**
 * The game's connection to the server through a switch: cut() drops the open connection and takes the browser
 * offline, refuse() turns away new connections, restore() brings both back. (Going offline alone leaves an open
 * WebSocket untouched in Chromium.)
 */
async function cuttableNetwork(page: Page) {
    let down = false;
    const open: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/ws\/room/, (ws) => {
        if (down) {
            ws.close({ code: 1006, reason: "network down" });
            return;
        }
        ws.connectToServer();
        open.push(ws);
    });
    return {
        refuse() {
            down = true;
        },
        async cut() {
            down = true;
            await page.context().setOffline(true);
            for (const ws of open.splice(0)) await ws.close({ code: 1006, reason: "network down" });
        },
        async restore() {
            down = false;
            await page.context().setOffline(false);
        },
    };
}

test.describe("Reconnect", () => {
    test("JN-042 Network cut: Reconnecting, then You're offline, then back in the room", async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const network = await cuttableNetwork(page);
        await join(page, roomUrl(testInfo), "Alice");
        await network.cut();
        const details = page.getByTestId("reconnectingDetails");
        await expect(page.getByRole("heading", { name: "Reconnecting" })).toBeVisible({ timeout: 14_000 });
        await expect(details).toContainText("Getting you back in");
        const butterfly = details.locator("img.butterfly");
        await expect(butterfly).toBeVisible();
        // A build puts the 2.7 KB butterfly inside the script, so it shows offline; vite's dev server serves it as a file.
        if ((await butterfly.getAttribute("src"))?.startsWith("data:")) {
            expect(await butterfly.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        } else {
            test.info().annotations.push({ type: "dev build", description: "butterfly served as a file: offline check skipped" });
        }
        await expect(page.getByText("Unable to connect to the Universe")).toBeHidden();
        await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible({ timeout: 30_000 });
        await expect(details).toContainText("We'll reconnect as soon as you're back online");
        await network.restore();
        await expect(reconnectHeading(page)).toBeHidden({ timeout: 90_000 });
        await inRoom(page);
    });

    test("JN-043 Game started while the game server is unreachable connects once it is back", async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const network = await cuttableNetwork(page);
        await openCameraScreen(page, roomUrl(testInfo));
        network.refuse();
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(cameraHeading(page)).toBeHidden();
        await expect(page.getByRole("heading", { name: /Connecting|Reconnecting|You're offline/ })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText("Unable to connect to the Universe")).toBeHidden();
        await network.restore();
        await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 150_000 });
        await expect(page.getByText("Unable to connect to the Universe")).toBeHidden();
    });

    test("JN-044 New version screen counts down, Refresh now reloads @local", async ({ player }) => {
        const showNewVersion = () =>
            withFrontModule(
                player,
                "src/front/Stores/ErrorScreenStore.ts",
                `m => m.errorScreenStore.setErrorFromApi({
                    status: "error", type: "retry", title: "Please refresh", subtitle: "New version available",
                    code: "NEW_VERSION", details: "A new version is available.", canRetryManual: true,
                    buttonTitle: "Refresh", timeToRetry: 999999,
                })`
            );
        await showNewVersion();
        const screen = player.getByTestId("newVersionScreen");
        await expect(screen).toBeVisible();
        await expect(screen.getByRole("heading", { name: "Universe just got an update" })).toBeVisible();
        await expect(player.getByTestId("newVersionDetails")).toHaveText(/Refreshing in (10|9|8)s to load the latest version/);
        await expect(screen.locator("svg.ring")).toBeVisible();
        await expect(player.getByTestId("newVersionDetails")).toHaveText(/Refreshing in [1-7]s/, { timeout: 8_000 });
        const reloaded = player.waitForEvent("load", { timeout: 60_000 });
        await screen.getByRole("button", { name: "Refresh now" }).click();
        await reloaded;
        await inRoom(player);
    });

    test("JN-044 New version screen reloads on its own, and stops after two reloads @local", async ({ player }) => {
        test.setTimeout(120_000);
        const showNewVersion = () =>
            withFrontModule(
                player,
                "src/front/Stores/ErrorScreenStore.ts",
                `m => m.errorScreenStore.setErrorFromApi({
                    status: "error", type: "retry", title: "Please refresh", subtitle: "New version available",
                    code: "NEW_VERSION", details: "A new version is available.", canRetryManual: true,
                    buttonTitle: "Refresh", timeToRetry: 999999,
                })`
            );
        await showNewVersion();
        await expect(player.getByTestId("newVersionScreen")).toBeVisible();
        await player.waitForEvent("load", { timeout: 60_000 });
        await inRoom(player);
        const recent = Date.now();
        await player.evaluate((at) => sessionStorage.setItem("universe.newVersionAutoReloads", JSON.stringify([at - 1000, at])), recent);
        await showNewVersion();
        await expect(player.getByTestId("newVersionDetails")).toHaveText("Refresh to load the latest version");
        await expect(player.getByTestId("newVersionScreen").locator("svg.ring")).toHaveCount(0);
        let reloadedAgain = false;
        player.once("load", () => (reloadedAgain = true));
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await player.waitForTimeout(12_000);
        expect(reloadedAgain, "waits for the button after two automatic reloads").toBe(false);
        await expect(player.getByRole("button", { name: "Refresh now" })).toBeVisible();
    });
});
