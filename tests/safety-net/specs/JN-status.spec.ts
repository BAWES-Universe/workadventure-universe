import type { Page } from "@playwright/test";
import { test, expect, isPhone, join, newPlayer, roomUrl, wa } from "../lib/game";
import {
    dismissNotificationAsk,
    expectCurrentStatus,
    inBubble,
    openMenu,
    pickStatus,
    profileMenu,
    watchBubble,
} from "../lib/jn";

declare const WA: {
    player: {
        teleport(x: number, y: number): Promise<void>;
        proximityMeeting: { onJoin(): { subscribe(cb: () => void): void } };
    };
    players: {
        configureTracking(o: object): Promise<void>;
        list(): Iterable<{ name: string; state: unknown }>;
    };
};

const statusDot = (page: Page) => page.locator(".profile-pill div.rounded-full.h-2");

test.describe("Status", () => {
    test("JN-067 Busy: menu closes, dot yellow, Busy checked, mic and camera disabled", async ({
        player,
    }, testInfo) => {
        await player.context().grantPermissions(["notifications"]);
        await pickStatus(player, "Busy");
        await dismissNotificationAsk(player);
        if (!isPhone(testInfo)) {
            await expect(statusDot(player)).toHaveCSS("background-color", "rgb(233, 200, 78)");
            await expect(player.locator(".profile-pill").getByText("Busy", { exact: true })).toBeVisible();
        }
        await expectCurrentStatus(player, "Busy");
        await expect(player.getByTestId("microphone-button")).toHaveAttribute("data-state", "disabled");
        await expect(player.getByTestId("camera-button")).toHaveAttribute("data-state", "disabled");
    });

    test("JN-068 Busy asks to turn on notifications, held 4 h after Not now; Turn on with a grant closes it", async ({
        page,
    }, testInfo) => {
        await page.addInitScript(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            w.__jnNotification = "default";
            Object.defineProperty(Notification, "permission", { get: () => w.__jnNotification });
            Notification.requestPermission = () => {
                w.__jnNotification = "granted";
                return Promise.resolve("granted");
            };
        });
        await join(page, roomUrl(testInfo), "Alice");
        await pickStatus(page, "Busy");
        const card = page.getByText("Turn on notifications?");
        await expect(card).toBeVisible();
        await expect(
            page.getByText(
                "Get a notification when someone wants to talk to you, even when this tab is in the background."
            )
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Turn on" })).toBeVisible();
        await page.getByRole("button", { name: "Not now" }).click();
        await expect(card).toBeHidden();

        await pickStatus(page, "Online");
        await pickStatus(page, "Busy");
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(2_000);
        await expect(card, "not asked again within 4 h").toBeHidden();

        await page.evaluate(() =>
            localStorage.setItem("lastNotificationPermissionRequest", new Date(Date.now() - 5 * 3600_000).toString())
        );
        await pickStatus(page, "Online");
        await pickStatus(page, "Busy");
        await expect(card, "asked again after 4 h").toBeVisible();
        await page.getByRole("button", { name: "Turn on" }).click();
        await expect(card).toBeHidden();
        await expect(page.locator("form.helpNotificationSettings")).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem("notificationPermission"))).toBe("true");

        await pickStatus(page, "Online");
        await page.evaluate(() => localStorage.removeItem("lastNotificationPermissionRequest"));
        await pickStatus(page, "Busy");
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(2_000);
        await expect(card, "never asked once granted").toBeHidden();
    });

    test("JN-068 Browser blocked notifications: asked again only after 14 days", async ({ page }, testInfo) => {
        await page.addInitScript(() => {
            Object.defineProperty(Notification, "permission", { get: () => "denied" });
        });
        await join(page, roomUrl(testInfo), "Alice");
        const card = page.getByText("Turn on notifications?");
        await page.evaluate(() =>
            localStorage.setItem(
                "lastNotificationPermissionRequest",
                new Date(Date.now() - 5 * 24 * 3600_000).toString()
            )
        );
        await pickStatus(page, "Busy");
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(2_000);
        await expect(card, "held for 14 days when blocked").toBeHidden();
        await page.evaluate(() =>
            localStorage.setItem(
                "lastNotificationPermissionRequest",
                new Date(Date.now() - 15 * 24 * 3600_000).toString()
            )
        );
        await pickStatus(page, "Online");
        await pickStatus(page, "Busy");
        await expect(card).toBeVisible();
    });

    test("JN-069 Browser refuses notifications: the access denied popup", async ({ page }, testInfo) => {
        await page.addInitScript(() => {
            Object.defineProperty(Notification, "permission", { get: () => "default" });
            Notification.requestPermission = () => Promise.resolve("denied");
        });
        await join(page, roomUrl(testInfo), "Alice");
        await pickStatus(page, "Busy");
        await expect(page.getByText("Turn on notifications?")).toBeVisible();
        await page.getByRole("button", { name: "Turn on" }).click();
        const popup = page.locator("form.helpNotificationSettings");
        await expect(popup).toBeVisible();
        await expect(popup.getByText("Notifications access denied")).toBeVisible();
        await expect(popup.getByText("Permission denied")).toBeVisible();
        if (!isPhone(testInfo)) await expect(popup.locator("img")).toBeVisible();
        await expect(popup.getByRole("button", { name: "Refresh" })).toBeVisible();
        await popup.getByRole("button", { name: "Continue without notification" }).click();
        await expect(popup).toHaveCount(0);
    });

    test("JN-070 Busy: Bob arrives, Alice can Accept (back Online, bubble) or Close (stays Busy)", async ({
        browser,
        player,
        url,
    }, testInfo) => {
        await player.context().grantPermissions(["notifications"]);
        await watchBubble(player);
        await pickStatus(player, "Busy");
        await dismissNotificationAsk(player);
        const bob = await newPlayer(browser, testInfo, url, "Bob");
        const ask = player.getByText("Bob wants to discuss with you");
        await expect(ask).toBeVisible({ timeout: 30_000 });
        await expect(player.getByRole("button", { name: "Close", exact: true })).toBeVisible();
        await player.getByRole("button", { name: "Accept", exact: true }).click();
        await expect(ask).toBeHidden();
        await expectCurrentStatus(player, "Online");
        await expect.poll(() => inBubble(player), { timeout: 20_000 }).toBe(true);
        await bob.context().close();
    });

    test("JN-070 Busy: Close and Esc keep Busy", async ({ browser, player, url }, testInfo) => {
        await player.context().grantPermissions(["notifications"]);
        await pickStatus(player, "Busy");
        await dismissNotificationAsk(player);
        const bob = await newPlayer(browser, testInfo, url, "Bob");
        const ask = player.getByText("Bob wants to discuss with you");
        await expect(ask).toBeVisible({ timeout: 30_000 });
        await player.getByRole("button", { name: "Close", exact: true }).click();
        await expect(ask).toBeHidden();
        await expectCurrentStatus(player, "Busy");
        await wa(bob, () => WA.player.teleport(32 * 8, 32 * 8));
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await bob.waitForTimeout(1_500);
        await wa(bob, () => WA.player.teleport(96, 128));
        const position = await wa(player, async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = await (WA.player as any).getPosition();
            return p as { x: number; y: number };
        });
        await wa(bob, (p) => WA.player.teleport(p.x, p.y), position);
        await expect(ask).toBeVisible({ timeout: 30_000 });
        await player.keyboard.press("Escape");
        await expect(ask).toBeHidden();
        await expectCurrentStatus(player, "Busy");
        await bob.context().close();
    });

    for (const [id, status] of [
        ["JN-071", "Back in a moment"],
        ["JN-072", "Do not disturb"],
    ] as const) {
        test(`${id} ${status}: mic and camera disabled, no bubble with Bob`, async ({
            browser,
            player,
            url,
        }, testInfo) => {
            await pickStatus(player, status);
            await expect(player.getByTestId("microphone-button")).toHaveAttribute("data-state", "disabled");
            await expect(player.getByTestId("camera-button")).toHaveAttribute("data-state", "disabled");
            await watchBubble(player);
            const bob = await newPlayer(browser, testInfo, url, "Bob");
            await watchBubble(bob);
            // eslint-disable-next-line playwright/no-wait-for-timeout
            await bob.waitForTimeout(6_000);
            expect(await inBubble(player)).toBe(false);
            expect(await inBubble(bob)).toBe(false);
            await expect(player.getByText("Bob wants to discuss with you")).toBeHidden();
            await expectCurrentStatus(player, status);
            await bob.context().close();
        });
    }

    test("JN-073 Moving brings any status back to Online with mic and camera as before", async ({
        player,
    }, testInfo) => {
        await player.context().grantPermissions(["notifications"]);
        await player.getByTestId("camera-button").click();
        await expect(player.getByTestId("camera-button")).toHaveAttribute("data-state", "forbidden");
        for (const [turn, status] of ["Busy", "Back in a moment", "Do not disturb"].entries()) {
            await pickStatus(player, status);
            await dismissNotificationAsk(player);
            await expect(player.getByTestId("microphone-button")).toHaveAttribute("data-state", "disabled");
            if (isPhone(testInfo)) {
                const canvas = await player.locator("#game canvas").first().boundingBox();
                expect(canvas).not.toBeNull();
                if (canvas)
                    await player.touchscreen.tap(
                        canvas.x + canvas.width / 2 + (turn % 2 === 0 ? 120 : -120),
                        canvas.y + canvas.height / 2
                    );
            } else {
                await player
                    .locator("#game canvas")
                    .first()
                    .focus()
                    .catch(() => undefined);
                await player.keyboard.down("ArrowRight");
                // eslint-disable-next-line playwright/no-wait-for-timeout
                await player.waitForTimeout(300);
                await player.keyboard.up("ArrowRight");
            }
            await expectCurrentStatus(player, "Online");
            await expect(player.getByTestId("microphone-button")).toHaveAttribute("data-state", "normal");
            await expect(player.getByTestId("camera-button")).toHaveAttribute("data-state", "forbidden");
            if (!isPhone(testInfo)) await expect(statusDot(player)).toHaveCSS("background-color", "rgb(104, 233, 122)");
            if (!isPhone(testInfo)) {
                await wa(player, () => WA.player.teleport(96, 128));
            } else {
                // The tap walks the WOKA: let it arrive, or the next status is cancelled by the walk still going.
                let last = "";
                await expect
                    .poll(async () => {
                        const now = JSON.stringify(
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            await wa(player, () => (globalThis as any).WA.player.getPosition())
                        );
                        const same = now === last;
                        last = now;
                        return same;
                    })
                    .toBe(true);
            }
        }
    });

    test("JN-074 After 1 h Busy: back online? Confirm goes Online, Close stays", async ({ page }, testInfo) => {
        await page.clock.install();
        await join(page, roomUrl(testInfo), "Alice");
        await page.context().grantPermissions(["notifications"]);
        await pickStatus(page, "Busy");
        await dismissNotificationAsk(page);
        const ask = page.getByText("Do you want to go back online?");
        await page.clock.fastForward("01:00:05");
        await expect(ask).toBeVisible();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await expect(ask).toBeHidden();
        await expectCurrentStatus(page, "Busy");
        await page.clock.fastForward("01:00:05");
        await expect(ask, "asks again after the same time").toBeVisible();
        await page.keyboard.press("Escape");
        await expect(ask).toBeHidden();
        await page.clock.fastForward("01:00:05");
        await expect(ask).toBeVisible();
        await page.getByRole("button", { name: "Confirm", exact: true }).click();
        await expect(ask).toBeHidden();
        await expectCurrentStatus(page, "Online");
    });

    test("JN-074 Do not disturb asks after 4 h, not after 1 h", async ({ page }, testInfo) => {
        await page.clock.install();
        await join(page, roomUrl(testInfo), "Alice");
        await pickStatus(page, "Do not disturb");
        const ask = page.getByText("Do you want to go back online?");
        await page.clock.fastForward("01:00:05");
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1_000);
        await expect(ask).toBeHidden();
        await page.clock.fastForward("03:00:00");
        await expect(ask).toBeVisible();
    });

    test("JN-075 Silent zone locks the status list to Silent", async ({ page }, testInfo) => {
        await join(page, roomUrl(testInfo, "tests/E2E/silent_zone.json"), "Alice");
        await wa(page, () => WA.player.teleport(64, 256));
        await openMenu(page);
        const rows = profileMenu(page).locator("button.status-button");
        await expect(rows).toHaveCount(1);
        await expect(rows).toHaveText("Silent");
        await expect(rows).toHaveClass(/u-selected/);
        await expect(profileMenu(page).getByRole("button", { name: "Busy", exact: true })).toHaveCount(0);
    });

    test("JN-076 Bob's game knows Alice's status (the dot itself is canvas only)", async ({
        browser,
        player,
        url,
    }, testInfo) => {
        test.setTimeout(180_000);
        await player.context().grantPermissions(["notifications"]);
        const bob = await newPlayer(browser, testInfo, url, "Bob");
        const aliceStatus = () =>
            wa(bob, async () => {
                await WA.players.configureTracking({ players: true, movement: false });
                const alice = [...WA.players.list()].find((p) => p.name === "Alice");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return alice ? String((alice as any)._availabilityStatus) : "absent";
            });
        await expect.poll(aliceStatus, { timeout: 20_000 }).not.toBe("absent");
        const online = await aliceStatus();
        await wa(bob, () => WA.player.teleport(32 * 8, 32 * 8));
        await pickStatus(player, "Busy");
        await dismissNotificationAsk(player);
        await bob.reload();
        await expect(bob.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
        await expect.poll(aliceStatus, { timeout: 20_000 }).not.toBe("absent");
        expect(await aliceStatus()).not.toBe(online);
        await bob.context().close();
    });
});
