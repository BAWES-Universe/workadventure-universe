import type { Page } from "@playwright/test";
import { test, expect, isPhone, join, roomUrl, wa, withFrontModule } from "../lib/game";
import { openMenu, playedSounds, profileMenu, recordSounds } from "../lib/jn";

declare const WA: {
    player: { teleport(x: number, y: number): Promise<void> };
    ui: { registerMenuCommand(name: string, callback: () => void): unknown };
};

const settingsWindow = (page: Page) => page.getByTestId("settings-window");

async function openSettings(page: Page): Promise<void> {
    await openMenu(page);
    await profileMenu(page).getByRole("button", { name: "All settings" }).click();
    await expect(settingsWindow(page)).toBeVisible();
}

/** Opens a settings page from the side list (desktop) or the tabs (phone). */
async function goToPage(page: Page, id: string, phone: boolean): Promise<void> {
    await page.getByTestId(phone ? `settings-tab-${id}` : `settings-nav-${id}`).click();
}

const switchOf = (page: Page, id: string) => page.getByTestId(id);

test.describe("Settings window", () => {
    test("JN-077 Desktop Settings window with its side list", async ({ player }, testInfo) => {
        test.skip(isPhone(testInfo), "desktop only");
        await openSettings(player);
        const nav = settingsWindow(player).locator("nav");
        await expect(nav.locator("h2.u-settings-title")).toHaveText("Settings");
        await expect(player.getByTestId("settings-nav-general")).toContainText("General");
        await expect(player.getByTestId("settings-nav-sound")).toContainText("Sound and video");
        await expect(player.getByTestId("settings-nav-shortcuts")).toContainText("Keyboard");
        await expect(player.getByTestId("settings-nav-general")).toHaveClass(/is-active/);
        await expect(player.getByTestId("settings-nav-general")).toHaveAttribute("aria-current", "page");
        await expect(player.locator("#settings-title .u-settings-title-wide")).toHaveText("General");
        await expect(player.getByTestId("closeMenuBtn")).toBeVisible();
        const box = await settingsWindow(player).boundingBox();
        const layer = await player.locator(".u-settings-layer").boundingBox();
        expect(box && layer).toBeTruthy();
        if (box && layer) {
            expect(Math.abs(box.x + box.width / 2 - (layer.x + layer.width / 2))).toBeLessThan(4);
            expect(Math.abs(box.y + box.height / 2 - (layer.y + layer.height / 2))).toBeLessThan(4);
        }
        await goToPage(player, "sound", false);
        await expect(player.getByTestId("settings-nav-sound")).toHaveClass(/is-active/);
        await expect(player.locator("#settings-title .u-settings-title-wide")).toHaveText("Sound and video");
    });

    test("JN-078 Phone Settings window with tabs and a sliding pill", async ({ player }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        await openSettings(player);
        await expect(player.locator("#settings-title .u-settings-title-phone")).toHaveText("Settings");
        await expect(player.locator("#settings-title .u-settings-title-phone")).toBeVisible();
        await expect(player.getByTestId("settings-tab-general")).toHaveText("General");
        await expect(player.getByTestId("settings-tab-sound")).toHaveText("Sound and video");
        await expect(player.getByTestId("settings-tab-shortcuts")).toHaveCount(0);
        await expect(player.getByTestId("closeMenuBtn")).toBeVisible();
        const pillLeft = () =>
            player.locator(".u-settings-pill").evaluate((pill) => Math.round(pill.getBoundingClientRect().left));
        const tabLeft = (id: string) =>
            player.getByTestId(`settings-tab-${id}`).evaluate((tab) => Math.round(tab.getBoundingClientRect().left));
        await expect.poll(pillLeft).toBe(await tabLeft("general"));
        await player.getByTestId("settings-tab-sound").tap();
        await expect(player.getByTestId("settings-tab-sound")).toHaveAttribute("aria-selected", "true");
        await expect(player.getByTestId("settings-sound")).toBeVisible();
        await expect.poll(pillLeft).toBe(await tabLeft("sound"));
    });

    test("JN-079 Escape and X close the Settings window", async ({ player }) => {
        await openSettings(player);
        await player.keyboard.press("Escape");
        await expect(settingsWindow(player)).toBeHidden();
        await openSettings(player);
        await player.getByTestId("closeMenuBtn").click();
        await expect(settingsWindow(player)).toBeHidden();
    });

    test("JN-080 Pages switch inside the window; reopening starts on General", async ({ player }, testInfo) => {
        const phone = isPhone(testInfo);
        await openSettings(player);
        await goToPage(player, "sound", phone);
        await expect(player.getByTestId("settings-sound")).toBeVisible();
        await expect(player.getByTestId("settings-general")).toHaveCount(0);
        await goToPage(player, "general", phone);
        await expect(player.getByTestId("settings-general")).toBeVisible();
        await goToPage(player, "sound", phone);
        await expect(player.getByTestId("settings-sound")).toBeVisible();
        await player.getByTestId("closeMenuBtn").click();
        await expect(settingsWindow(player)).toBeHidden();
        await openSettings(player);
        await expect(player.getByTestId("settings-general")).toBeVisible();
    });
});

test.describe("Settings: General", () => {
    test("JN-081 Language choice opens a list and switches the UI at once", async ({ player }) => {
        await openSettings(player);
        const language = player.getByTestId("language");
        await expect(language.locator(".u-set-value")).toHaveText("English (United States)");
        await language.locator("button.u-set-choice-head").click();
        const options = language.getByRole("option");
        await expect(options.first()).toBeVisible();
        const current = language.getByRole("option", { name: "English (United States)" });
        await expect(current).toHaveAttribute("aria-selected", "true");
        await expect(current.locator("svg")).toBeVisible();
        await expect(language.getByRole("option", { selected: true })).toHaveCount(1);
        await language.getByRole("option", { name: "Français (France)" }).click();
        await expect(language.getByRole("listbox")).toHaveCount(0);
        await expect(language.locator(".u-set-value")).toHaveText("Français (France)");
        await expect(settingsWindow(player).getByText("Général", { exact: true }).filter({ visible: true }).first()).toBeVisible();
        await language.locator("button.u-set-choice-head").click();
        await language.getByRole("option", { name: "English (United States)" }).click();
        await expect(settingsWindow(player).getByText("General", { exact: true }).filter({ visible: true }).first()).toBeVisible();
        await expect(language.locator(".u-set-value")).toHaveText("English (United States)");
    });

    test("JN-082 Notifications switch flips back when refused; Ignore follow requests saves", async ({ page }, testInfo) => {
        await page.addInitScript(() => {
            Object.defineProperty(Notification, "permission", { get: () => "default" });
            Notification.requestPermission = () => Promise.resolve("denied");
        });
        await join(page, roomUrl(testInfo), "Alice");
        await openSettings(page);
        const notifications = switchOf(page, "notification-toggle");
        await expect(notifications).not.toBeChecked();
        await page.locator("label[for=notification-toggle]").click();
        await expect(notifications).not.toBeChecked();
        expect(await page.evaluate(() => localStorage.getItem("notificationPermission"))).not.toBe("true");
        const ignore = switchOf(page, "ignoreFollowRequests-toggle");
        await expect(ignore).not.toBeChecked();
        await page.locator("label[for=ignoreFollowRequests-toggle]").click();
        await expect(ignore).toBeChecked();
        expect(await page.evaluate(() => localStorage.getItem("ignoreFollowRequests"))).toBe("true");
    });

    test("JN-082 Notifications switch turns on when the browser allows", async ({ player }) => {
        await player.context().grantPermissions(["camera", "microphone", "notifications"]);
        await openSettings(player);
        await player.locator("label[for=notification-toggle]").click();
        await expect(switchOf(player, "notification-toggle")).toBeChecked();
        await expect.poll(() => player.evaluate(() => localStorage.getItem("notificationPermission"))).toBe("true");
    });

    test("JN-084 When you leave the app: defaults and hints", async ({ player }, testInfo) => {
        await openSettings(player);
        const cam = switchOf(player, "cam-toggle");
        const mic = switchOf(player, "mic-toggle");
        const hint = (id: string) => player.locator(`label[for=${id}] .u-set-hint`);
        await expect(settingsWindow(player).getByText("When you leave the app")).toBeVisible();
        await expect(player.locator("label[for=cam-toggle] .u-set-label")).toHaveText("Keep my camera on");
        await expect(player.locator("label[for=mic-toggle] .u-set-label")).toHaveText("Keep my mic on");
        await expect(cam).not.toBeChecked();
        await expect(hint("cam-toggle")).toHaveText("Turns off when you switch to another tab or app");
        if (isPhone(testInfo)) {
            await expect(mic).not.toBeChecked();
            await expect(hint("mic-toggle")).toHaveText("Turns off when you switch to another tab or app");
        } else {
            await expect(mic).toBeChecked();
            await expect(hint("mic-toggle")).toHaveText("Stays on when you switch to another tab or app");
        }
        const micWas = await mic.isChecked();
        await player.locator("label[for=cam-toggle]").click();
        await player.locator("label[for=mic-toggle]").click();
        await expect(cam).toBeChecked();
        await expect(hint("cam-toggle")).toHaveText("Stays on when you switch to another tab or app");
        if (micWas) await expect(mic).not.toBeChecked();
        else await expect(mic).toBeChecked();
    });

    test("JN-085 Screen switches save at once; calm map pauses animations; full screen @local", async ({ player }, testInfo) => {
        await openSettings(player);
        const flip = async (id: string) => {
            const before = await switchOf(player, id).isChecked();
            await player.locator(`label[for=${id}]`).click();
            await expect(switchOf(player, id)).toBeChecked({ checked: !before });
            return !before;
        };
        expect(await flip("cowebsiteTrigger-toggle")).toBe(true);
        expect(await player.evaluate(() => localStorage.getItem("forceCowebsiteTrigger"))).toBe("true");
        expect(await flip("picture-in-picture-toggle")).toBe(false);
        expect(await player.evaluate(() => localStorage.getItem("allowPictureInPicture"))).toBe("false");

        const animationsActive = () =>
            withFrontModule<boolean>(player, "src/front/Phaser/Game/GameManager.ts", "m => m.gameManager.getCurrentGameScene().animatedTiles.active");
        expect(await flip("changeDisableAnimations")).toBe(true);
        expect(await player.evaluate(() => localStorage.getItem("disableAnimations"))).toBe("true");
        await expect.poll(animationsActive).toBe(false);
        expect(await flip("changeDisableAnimations")).toBe(false);
        await expect.poll(animationsActive).toBe(true);

        if (isPhone(testInfo)) {
            await expect(switchOf(player, "fullscreen-toggle")).toBeAttached();
            return;
        }
        expect(await flip("fullscreen-toggle")).toBe(true);
        await expect.poll(() => player.evaluate(() => document.fullscreenElement !== null)).toBe(true);
        await player.evaluate(() => document.exitFullscreen());
        await expect(switchOf(player, "fullscreen-toggle")).not.toBeChecked();
        expect(await player.evaluate(() => localStorage.getItem("fullscreen"))).toBe("false");
    });

    test("JN-086 Map credits page with a back arrow", async ({ player }) => {
        await openSettings(player);
        await player.getByTestId("settings-page-credit").click();
        const credits = player.getByTestId("settings-map-credits");
        await expect(credits).toBeVisible();
        await expect(player.locator("#settings-title")).toHaveText("Map credits");
        await expect(player.getByTestId("settings-back")).toBeVisible();
        const map = player.getByTestId("map-credit-map");
        const tileset = player.getByTestId("map-credit-tileset");
        const audio = player.getByTestId("map-credit-audio");
        await expect(map).toHaveText("Copyrights of the map");
        await expect(tileset).toHaveText("Copyrights of the tilesets");
        await expect(audio).toHaveText("Copyrights of audio files");
        await map.click();
        await expect(credits.locator(".u-set-credit")).toHaveCount(1);
        await expect(credits.locator(".u-set-credit")).toContainText("did not declare a copyright for the map");
        await tileset.click();
        await expect(map).toHaveAttribute("aria-expanded", "false");
        await expect(credits.locator(".u-set-credit")).toHaveCount(1);
        await expect(credits.locator(".u-set-credit")).toContainText("tilesets");
        await audio.click();
        await expect(credits.locator(".u-set-credit")).toHaveCount(1);
        await expect(credits.locator(".u-set-credit")).toContainText("audio files");
        await player.getByTestId("settings-back").click();
        await expect(player.getByTestId("settings-general")).toBeVisible();
    });

    test("JN-088 No Contact row or page in Settings", async ({ player }, testInfo) => {
        await openSettings(player);
        await expect(settingsWindow(player).getByText("Contact")).toHaveCount(0);
        await goToPage(player, "sound", isPhone(testInfo));
        await expect(player.getByTestId("settings-sound")).toBeVisible();
        await expect(settingsWindow(player).getByText("Contact")).toHaveCount(0);
    });
});

test.describe("Settings: Sound and video", () => {
    test("JN-089 Camera and screen share quality choices", async ({ player }, testInfo) => {
        await openSettings(player);
        await goToPage(player, "sound", isPhone(testInfo));
        const camera = player.getByTestId("video-quality");
        await expect(camera.locator(".u-set-label")).toHaveText("Camera quality");
        await expect(camera.locator(".u-set-value")).toHaveText("Normal");
        await camera.locator("button.u-set-choice-head").click();
        await expect(camera.getByRole("option")).toHaveCount(3);
        await expect(camera.getByRole("option").nth(0)).toContainText("Save data");
        await expect(camera.getByRole("option").nth(0)).toContainText("Uses less internet");
        await expect(camera.getByRole("option").nth(1)).toContainText("Normal");
        await expect(camera.getByRole("option").nth(2)).toContainText("Sharpest picture");
        await camera.getByRole("option", { name: /Save data/ }).click();
        await expect(camera.getByRole("listbox")).toHaveCount(0);
        await expect(camera.locator(".u-set-value")).toHaveText("Save data");
        await expect.poll(() => player.evaluate(() => localStorage.getItem("videoBandwidth"))).not.toBeNull();
        const share = player.getByTestId("screen-share-quality");
        await share.locator("button.u-set-choice-head").click();
        await share.getByRole("option", { name: /Best/ }).click();
        await expect(share.locator(".u-set-value")).toHaveText("Best");
        await expect.poll(() => player.evaluate(() => localStorage.getItem("screenShareBandwidth"))).toBe("unlimited");
    });

    test("JN-090 Voices slider, join sound, lower music, mute map music", async ({ page }, testInfo) => {
        const phone = isPhone(testInfo);
        await recordSounds(page);
        await join(page, roomUrl(testInfo, "tests/E2E/audio.json"), "Alice");
        await wa(page, () => WA.player.teleport(256, 128));
        const mapAudioPlaying = () =>
            page.evaluate(() => [...document.querySelectorAll("audio")].some((a) => !a.paused && a.src.includes("Audience")));
        await expect.poll(mapAudioPlaying, { timeout: 20_000, message: "the map's music plays in its area" }).toBe(true);
        await openSettings(page);
        await goToPage(page, "sound", phone);

        const slider = page.locator("#voices-nearby");
        await expect(page.locator("label[for=voices-nearby]")).toHaveText("Voices nearby");
        await slider.fill("0.4");
        await slider.dispatchEvent("change");
        await expect(slider).toHaveAttribute("aria-valuetext", "40%");
        await expect.poll(() => page.evaluate(() => localStorage.getItem("volumeProximityDiscussion"))).toBe("0.4");

        const joinSound = page.getByTestId("bubble-sound");
        await expect(joinSound.locator(".u-set-label:visible")).toHaveText(phone ? "Sound when someone joins" : "Join sound");
        await joinSound.locator("button.u-set-choice-head").click();
        await joinSound.getByRole("option", { name: "Wobble" }).click();
        await expect(joinSound.locator(".u-set-value")).toHaveText("Wobble");
        const wobbles = async () => (await playedSounds(page)).filter((src) => src.includes("webrtc-in-wobble.mp3")).length;
        await expect.poll(wobbles).toBe(1);
        await joinSound.getByRole("button", { name: "Play the sound" }).click();
        await expect.poll(wobbles).toBe(2);

        await page.locator("label[for=decreaseAudioPlayerVolumeWhileTalking-toggle]").click();
        await expect.poll(() => page.evaluate(() => localStorage.getItem("decreaseAudioPlayerVolumeWhileTalking"))).not.toBeNull();

        await page.locator("label[for=changeBlockAudio]").click();
        await expect(page.getByTestId("changeBlockAudio")).toBeChecked();
        await expect.poll(mapAudioPlaying, { message: "map music stops at once" }).toBe(false);
        expect(await page.evaluate(() => localStorage.getItem("blockAudio"))).toBe("true");
    });
});

test.describe("Settings: Keyboard, persistence, map pages", () => {
    test("JN-091 Keyboard page lists the shortcuts (computers only)", async ({ player }, testInfo) => {
        if (isPhone(testInfo)) {
            await openSettings(player);
            await expect(player.getByTestId("settings-tab-shortcuts")).toHaveCount(0);
            await expect(player.getByTestId("settings-nav-shortcuts")).toBeHidden();
            return;
        }
        await openSettings(player);
        await player.getByTestId("settings-nav-shortcuts").click();
        const keyboard = player.getByTestId("settings-keyboard");
        await expect(keyboard).toBeVisible();
        for (const action of ["Move Up", "Move Down", "Move Left", "Move Right", "Run", "Interact", "Follow", "Open Chat", "Open User List", "Show/Hide Map Editor", "Emote 1", "Emote 6", "Walk to My Desk"]) {
            await expect(keyboard.getByText(action, { exact: true })).toBeVisible();
        }
        await expect(keyboard.locator("kbd").first()).toBeVisible();
    });

    test("JN-092 Settings survive a reload", async ({ player }, testInfo) => {
        const phone = isPhone(testInfo);
        await openSettings(player);
        await player.locator("label[for=changeDisableAnimations]").click();
        await player.locator("label[for=ignoreFollowRequests-toggle]").click();
        await player.locator("label[for=cam-toggle]").click();
        await goToPage(player, "sound", phone);
        await player.getByTestId("video-quality").locator("button.u-set-choice-head").click();
        await player.getByTestId("video-quality").getByRole("option", { name: /Best/ }).click();
        await player.getByTestId("bubble-sound").locator("button.u-set-choice-head").click();
        await player.getByTestId("bubble-sound").getByRole("option", { name: "Wobble" }).click();
        await player.reload();
        await expect(player.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
        await openSettings(player);
        await expect(switchOf(player, "changeDisableAnimations")).toBeChecked();
        await expect(switchOf(player, "ignoreFollowRequests-toggle")).toBeChecked();
        await expect(switchOf(player, "cam-toggle")).toBeChecked();
        await goToPage(player, "sound", phone);
        await expect(player.getByTestId("video-quality").locator(".u-set-value")).toHaveText("Best");
        await expect(player.getByTestId("bubble-sound").locator(".u-set-value")).toHaveText("Wobble");
    });

    test("JN-093 A map's own menus are extra Settings pages", async ({ page }, testInfo) => {
        const phone = isPhone(testInfo);
        await join(page, roomUrl(testInfo, "tests/Metadata/customMenu.json"), "Alice");
        await wa(page, () => {
            WA.ui.registerMenuCommand("jn check menu", () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (globalThis as any).__jnMenuRan = true;
            });
        });
        await openSettings(page);
        const entry = (label: string) =>
            phone
                ? settingsWindow(page).getByRole("tab", { name: label })
                : settingsWindow(page).locator("nav button.u-settings-navrow", { hasText: label });
        await expect(entry("custom iframe menu")).toBeVisible();
        await expect(entry("custom callback menu")).toBeVisible();
        if (!phone) {
            await expect(settingsWindow(page).locator("nav [role=separator]")).toHaveCount(1);
            const divider = await settingsWindow(page).locator("nav [role=separator]").boundingBox();
            const custom = await entry("custom iframe menu").boundingBox();
            const general = await page.getByTestId("settings-nav-general").boundingBox();
            expect(divider && custom && general).toBeTruthy();
            if (divider && custom && general) {
                expect(divider.y).toBeGreaterThan(general.y);
                expect(custom.y).toBeGreaterThan(divider.y);
            }
        }
        await entry("custom iframe menu").click();
        await expect(settingsWindow(page).locator("iframe[src*='customIframeMenu.html']")).toBeVisible();
        await entry("custom callback menu").click();
        await expect(settingsWindow(page)).toBeHidden();
        await expect(page.getByText("Custom menu clicked").first(), "the map's command ran (it posts in the chat)").toBeAttached();
        const closeChat = page.getByRole("button", { name: "Close chat" });
        if (await closeChat.isVisible()) await closeChat.click();
        await openSettings(page);
        await entry("jn check menu").click();
        await expect(settingsWindow(page)).toBeHidden();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect.poll(() => wa(page, () => (globalThis as any).__jnMenuRan === true)).toBe(true);
    });
});
