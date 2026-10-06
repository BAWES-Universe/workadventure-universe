import type { Page } from "@playwright/test";
import { test, expect, isPhone, join, wa, wamRoom, roomUrl } from "../lib/game";
import {
    INPUT_PAGE,
    MAPS,
    addWamAreas,
    cowebsiteFrame,
    fakeOutside,
    playerAt,
    recordTiles,
    recordedTiles,
    scriptGlobal,
    teleport,
    tiled,
    tileOf,
    walkUntil,
    walkUntilJump,
} from "../lib/or";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const audio = (page: Page) => page.locator("audio.audio-manager-audioplayer");
const visible = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);

async function openSettings(page: Page): Promise<void> {
    await page.getByTestId("action-user").click();
    await expect(page.getByTestId("profile-menu")).toBeVisible();
    await page.getByRole("button", { name: "All settings" }).click();
    await expect(page.getByTestId("settings-window")).toBeVisible();
}

test("OR-001 A guest has no Orbit button in the bar and no Orbit row in the profile menu", async ({ player }) => {
    await expect(player.getByTestId("action-user")).toBeVisible();
    await expect(player.getByRole("button", { name: "Orbit" })).toHaveCount(0);
    await player.getByTestId("action-user").click();
    const menu = player.getByTestId("profile-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Orbit", { exact: true })).toHaveCount(0);
    await expect(player.getByRole("button", { name: "Orbit" })).toHaveCount(0);
});

test("OR-089 Desktop: a play-audio area plays music; the music button toggles the volume slider; pause and stop work", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, tiled(testInfo, "tests/E2E/audio.json"), "Alice");
    await expect(page.getByTestId("music-button")).toHaveCount(0);
    await teleport(page, 240, 144);

    const music = page.getByTestId("music-button");
    await expect(music).toHaveAttribute("data-state", "active");
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
    await expect(page.getByRole("slider")).toBeVisible();
    await music.click();
    await expect(page.getByRole("slider")).toBeHidden();
    await music.click();
    await expect(page.getByRole("slider")).toBeVisible();

    await page.getByTestId("music-pause-button").click();
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
    await page.getByTestId("music-pause-button").click();
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);

    await page.getByTestId("music-stop-button").click();
    await expect(music).toHaveCount(0);
    await expect(audio(page)).toHaveCount(0);

    await teleport(page, 48, 144);
    await teleport(page, 240, 144);
    await expect(music).toHaveAttribute("data-state", "active");
});

test("OR-090 Phone: the music controls of a play-audio area sit in the profile menu", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await join(page, tiled(testInfo, "tests/E2E/audio.json"), "Alice");
    await teleport(page, 240, 144);
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
    await expect(visible(page, "music-button")).toHaveCount(0);

    await page.getByTestId("action-user").click();
    const menu = page.getByTestId("profile-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("music-button")).toBeVisible();
    await expect(menu.getByTestId("music-pause-button")).toBeVisible();
    await menu.getByTestId("music-pause-button").click();
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
});

test("OR-091 Muted map sounds disable the music button; a sound that fails shows the warning and a forbidden button", async ({ page }, testInfo) => {
    await join(page, tiled(testInfo, "tests/E2E/audio.json"), "Alice");
    await openSettings(page);
    await page.locator('[data-testid="settings-tab-sound"]:visible, [data-testid="settings-nav-sound"]:visible').click();
    await page.getByText("Mute map music and sounds").click();
    await page.locator("#closeMenu").click();
    await expect(page.getByTestId("settings-window")).toBeHidden();

    await teleport(page, 240, 144);
    if (isPhone(testInfo)) await page.getByTestId("action-user").click();
    await expect(visible(page, "music-button")).toHaveAttribute("data-state", "disabled");
    await expect(audio(page)).toHaveCount(0);
    if (isPhone(testInfo)) await page.getByTestId("action-user").click();

    await openSettings(page);
    await page.locator('[data-testid="settings-tab-sound"]:visible, [data-testid="settings-nav-sound"]:visible').click();
    await page.getByText("Mute map music and sounds").click();
    await page.locator("#closeMenu").click();

    await teleport(page, 48, 144);
    await wa(page, async () => {
        const WA = (globalThis as Any).WA;
        const area = await WA.room.area.get("audioArea");
        area.setProperty("playAudio", "invalid.mp3");
    });
    await teleport(page, 240, 144);
    await expect(page.getByText("Could not load sound")).toBeVisible();
    if (isPhone(testInfo)) await page.getByTestId("action-user").click();
    await expect(visible(page, "music-button")).toHaveAttribute("data-state", "forbidden");
});

test("OR-091 Blocked autoplay: the WOKA shows the 'Audio is not allowed' bubble", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
        HTMLMediaElement.prototype.play = function () {
            return Promise.reject(new DOMException("blocked", "NotAllowedError"));
        };
    });
    await join(page, tiled(testInfo, "tests/E2E/audio.json"), "Alice");
    await teleport(page, 240, 144);
    await expect(page.locator("span.characterTriggerAction")).toContainText("Audio is not allowed. Press");
    await expect(page.locator("span.characterTriggerAction")).toContainText("or click here to play it!");
});

test("OR-092 @local Exits: exit1's exit loads exit2, whose exit brings you back to exit1 at from_exit2", async ({ page }, testInfo) => {
    await join(page, tiled(testInfo, "tests/exit1.json"), "Alice");
    await walkUntil(page, "ArrowRight", () => expect(page).toHaveURL(/tests\/exit2\.json/, { timeout: 30_000 }));
    await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => tileOf(page), { timeout: 30_000 }).toBe("1,4");

    await walkUntil(page, "ArrowLeft", () => expect(page).toHaveURL(/tests\/exit1\.json#from_exit2/, { timeout: 30_000 }));
    await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => tileOf(page), { timeout: 30_000 }).toBe("8,4");
    await expect(page.getByText(/error/i)).toHaveCount(0);
});

test("OR-093 @local Exits to start layers of the same map jump to S2 and back to S1", async ({ page }, testInfo) => {
    await join(page, tiled(testInfo, "tests/start-tile-teleport.json"), "Alice");
    await expect.poll(() => tileOf(page)).toBe("0,2");
    await recordTiles(page);
    await walkUntilJump(page, "ArrowDown", "ArrowUp", /^0,[3-4]$/, "4,3");
    await walkUntil(page, "ArrowUp", () => expect.poll(() => tileOf(page), { timeout: 15_000 }).toMatch(/^4,[0-2]$/));
    await walkUntilJump(page, "ArrowDown", "ArrowUp", /^4,4$/, "0,2");
    expect(page.url()).toContain("start-tile-teleport.json");
});

test("OR-094 WAM exit area takes you to the other room and closes open cowebsites", async ({ page }, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    const target = roomUrl(testInfo, "tests/E2E/empty.json").replace("/_/", "/_/exit-");
    await addWamAreas(url, [{ id: "exit", name: "exitArea", x: 160, y: 0, width: 128, height: 96, properties: [{ id: "p1", type: "exit", url: target, areaName: "" }] }]);
    await join(page, url, "Alice");
    await wa(page, async (u: string) => {
        await (globalThis as Any).WA.nav.openCoWebSite(u);
    }, INPUT_PAGE);
    await expect(cowebsiteFrame(page)).toBeVisible();

    await teleport(page, 208, 48).catch(() => undefined);
    await expect(page).toHaveURL(new RegExp(target.replace(/[.?*+^$()[\]{}|\\/]/g, "\\$&")), { timeout: 30_000 });
    await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);
});

test("OR-095 goToPage map: the Open Links popup's four buttons each act; javascript: links are refused", async ({ page }, testInfo) => {
    await fakeOutside(page.context());
    await join(page, tiled(testInfo, "tests/goToPage.json"), "Alice");
    const popup = page.locator("div.popUpElement");
    const button = (label: string) => popup.getByRole("button", { name: label, exact: true });
    const enter = async () => {
        await teleport(page, 64, 112);
        await teleport(page, 304, 144);
        await expect(popup).toContainText("Open Links");
        await expect(popup.getByRole("button")).toHaveCount(4);
    };

    await enter();
    const [tab] = await Promise.all([page.context().waitForEvent("page"), button("Open Tab").click()]);
    expect(tab.url()).toBe("https://workadventu.re/pricing");
    await tab.close();
    await expect(popup).toHaveCount(0);

    await enter();
    await button("openCoWebSite").click();
    await expect(cowebsiteFrame(page)).toHaveAttribute("src", "https://workadventu.re/pricing");
    await expect(popup).toHaveCount(0);

    const warnings: string[] = [];
    page.on("console", (m) => {
        if (m.type() === "warning") warnings.push(m.text());
    });
    let dialogs = 0;
    page.on("dialog", (d) => {
        dialogs++;
        void d.dismiss();
    });
    const before = page.url();
    await wa(page, () => {
        (globalThis as Any).WA.nav.goToPage("javascript:alert(1)");
    });
    await expect.poll(() => warnings.some((w) => w.includes("Refusing to go to a link that is not a page"))).toBe(true);
    expect(dialogs).toBe(0);
    expect(page.url()).toBe(before);

    await enter();
    await Promise.all([page.waitForURL("https://workadventu.re/pricing", { timeout: 30_000 }), button("Go To Page").click()]);
});

test("OR-095 goToPage map: the popup's 'load grouped map' button changes room", async ({ page }, testInfo) => {
    await join(page, tiled(testInfo, "tests/goToPage.json"), "Alice");
    const popup = page.locator("div.popUpElement");
    await teleport(page, 304, 144);
    await expect(popup).toContainText("Open Links");
    await popup.getByRole("button", { name: "load grouped map", exact: true }).click();
    await expect(page).toHaveURL(/tests\/script_api\.json/, { timeout: 30_000 });
    await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
});

test("OR-096 Starter map: the clock zone opens a script popup 'It's HH:MM' that closes when you leave", async ({ page }, testInfo) => {
    await join(page, tiled(testInfo, "starter/map.json"), "Alice");
    const popup = page.locator("div.popUpElement");
    await teleport(page, 14 * 32 + 16, 3 * 32 + 16);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(/It's \d{1,2}:\d{1,2}/);
    await teleport(page, 6 * 32, 9 * 32);
    await expect(popup).toHaveCount(0);
});

test("OR-097 Banner: script banner with colours, link and Got it!; closeBanner removes it", async ({ page }, testInfo) => {
    await fakeOutside(page.context());
    await join(page, tiled(testInfo, "tests/Banner/banner.json"), "Alice");
    const banner = page.locator("#banner-test");
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText("Hello, this is a banner test for documentation example!");
    const box = (await banner.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height * 0.6);
    const text = banner.locator("div.relative.z-10").first();
    await expect(text).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(banner.locator("div.absolute.z-0")).toHaveCSS("background-color", "rgb(0, 0, 0)");

    const link = banner.getByRole("link", { name: "WorkAdventure" });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    const [opened] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
    expect(opened.url()).toBe("https://workadventu.re/");
    await opened.close();

    await banner.getByRole("button", { name: "Got it!" }).click();
    await expect(banner).toHaveCount(0);

    await wa(page, () => {
        (globalThis as Any).WA.ui.banner.openBanner({ id: "banner-two", text: "Second banner", closable: false, timeToClose: 0 });
    });
    const second = page.locator("#banner-two");
    await expect(second).toContainText("Second banner");
    await expect(second.getByRole("button", { name: "Got it!" })).toHaveCount(0);
    await wa(page, () => {
        (globalThis as Any).WA.ui.banner.closeBanner();
    });
    await expect(second).toHaveCount(0);
});

async function registerTopButtons(page: Page): Promise<void> {
    await wa(page, () => {
        const WA = (globalThis as Any).WA;
        (globalThis as Any).clicked = [];
        for (const label of ["Register", "Inventory"]) {
            WA.ui.actionBar.addButton({
                id: label,
                label,
                callback: () => {
                    (globalThis as Any).clicked.push(label);
                    WA.ui.actionBar.removeButton(label);
                },
            });
        }
    });
}

test("OR-098 Desktop: script bar buttons sit on the right before Tools, run their callback, and move into the profile menu when the bar is narrow", async ({ page: player }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(player, await wamRoom(testInfo, "empty"), "Alice");
    await expect(player.getByTestId("map-menu")).toBeVisible();
    await registerTopButtons(player);
    const register = player.getByRole("button", { name: "Register" });
    await expect(register).toBeVisible();
    const tools = (await player.getByTestId("map-menu").boundingBox())!;
    const reg = (await register.boundingBox())!;
    expect(reg.x).toBeGreaterThan(player.viewportSize()!.width / 2);
    expect(reg.x + reg.width).toBeLessThanOrEqual(tools.x + 1);

    await register.click();
    await expect.poll(() => scriptGlobal<string[]>(player, "clicked")).toEqual(["Register"]);
    await expect(register).toHaveCount(0);

    await player.setViewportSize({ width: 700, height: 900 });
    const inventory = player.getByRole("button", { name: "Inventory" });
    await expect(player.locator("[data-testid=profile-menu]")).toHaveCount(0);
    await player.getByTestId("action-user").click();
    await expect(player.getByTestId("profile-menu").getByRole("button", { name: "Inventory" })).toBeVisible();
    await player.getByTestId("profile-menu").getByRole("button", { name: "Inventory" }).click();
    await expect.poll(() => scriptGlobal<string[]>(player, "clicked")).toEqual(["Register", "Inventory"]);
    await expect(inventory).toHaveCount(0);
});

test("OR-099 Phone: script bar buttons sit in the profile menu and run their callback", async ({ page: player, url }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await join(player, url, "Alice");
    await registerTopButtons(player);
    await expect(player.locator("button:visible", { hasText: "Register" })).toHaveCount(0);
    await player.getByTestId("action-user").click();
    const menu = player.getByTestId("profile-menu");
    await expect(menu.getByRole("button", { name: "Register" })).toBeVisible();
    await menu.getByRole("button", { name: "Register" }).tap();
    await expect.poll(() => scriptGlobal<string[]>(player, "clicked")).toEqual(["Register"]);
    await expect(player.getByRole("button", { name: "Register" })).toHaveCount(0);
});

test("OR-100 Script buttons for appsMenu, buildMenu and profileMenu appear in their menus (Apps in the profile menu on phones) and run their callbacks", async ({ player }, testInfo) => {
    await wa(player, () => {
        const WA = (globalThis as Any).WA;
        (globalThis as Any).clicked = [];
        for (const location of ["appsMenu", "buildMenu", "profileMenu"]) {
            WA.ui.actionBar.addButton({
                id: location,
                label: "Custom " + location,
                location,
                callback: () => {
                    (globalThis as Any).clicked.push(location);
                    WA.ui.actionBar.removeButton(location);
                },
            });
        }
    });
    const phone = isPhone(testInfo);

    if (phone) {
        await player.getByTestId("action-user").click();
        await expect(player.getByTestId("profile-menu").getByRole("button", { name: "Custom appsMenu" })).toBeVisible();
    } else {
        await player.getByTestId("apps-button").click();
    }
    await player.getByRole("button", { name: "Custom appsMenu" }).click();
    await expect.poll(() => scriptGlobal<string[]>(player, "clicked")).toEqual(["appsMenu"]);

    if (phone) {
        if (!(await player.getByTestId("profile-menu").isVisible())) await player.getByTestId("action-user").click();
        await expect(player.getByTestId("profile-menu").getByRole("button", { name: "Custom profileMenu" })).toBeVisible();
    } else {
        await player.getByTestId("action-user").click();
    }
    await player.getByRole("button", { name: "Custom profileMenu" }).click();
    await expect.poll(() => scriptGlobal<string[]>(player, "clicked")).toEqual(["appsMenu", "profileMenu"]);

    if (await player.getByTestId("profile-menu").isVisible()) await player.getByTestId("action-user").click();
    await player.getByTestId("map-menu").click();
    await expect(player.getByTestId("map-sub-menu")).toBeVisible();
    await player.getByRole("button", { name: "Custom buildMenu" }).click();
    await expect.poll(() => scriptGlobal<string[]>(player, "clicked")).toEqual(["appsMenu", "profileMenu", "buildMenu"]);
});

test("OR-101 An action-type script button shows its image with the tooltip name and runs its callback", async ({ player }, testInfo) => {
    await wa(player, () => {
        const WA = (globalThis as Any).WA;
        WA.ui.actionBar.addButton({
            id: "register-img",
            type: "action",
            toolTip: "Register",
            imageSrc: "/src/front/Components/images/icon-workadventure-white.png",
            callback: () => {
                (globalThis as Any).clicked = "image";
                WA.ui.actionBar.removeButton("register-img");
            },
        });
    });
    if (isPhone(testInfo)) await player.getByTestId("action-user").click();
    const button = player.getByRole("button", { name: "Register" });
    await expect(button).toBeVisible();
    await expect(button.locator("img")).toHaveAttribute("alt", "Register");
    await button.click();
    await expect.poll(() => scriptGlobal<string>(player, "clicked")).toBe("image");
    await expect(player.getByRole("button", { name: "Register" })).toHaveCount(0);
});

async function openModal(page: Page, options: Record<string, unknown>): Promise<void> {
    await wa(
        page,
        (o: Record<string, unknown>) => {
            const g = globalThis as Any;
            g.modalCloses = g.modalCloses ?? 0;
            g.modalEvents = g.modalEvents ?? 0;
            if (!g.modalListener) {
                g.modalListener = true;
                window.addEventListener("message", (e) => {
                    if (e.data?.type === "modalCloseTrigger") g.modalEvents++;
                });
            }
            g.WA.ui.modal.openModal(o, () => g.modalCloses++);
        },
        options
    );
    await expect(page.locator("#modalIframe")).toBeVisible();
}

const modalSrc = `${MAPS}/tests/index.html`;

test("OR-102 Desktop: script modal right/left float without dimming, centre dims; X, Escape and closeModal close it and the script hears it", async ({ page: player, url }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(player, url, "Alice");
    const panel = player.locator(".menu-container");
    const dim = player.locator("#main-layout > .bg-black\\/60");
    const viewport = player.viewportSize()!;

    await openModal(player, { src: modalSrc, position: "right" });
    await expect(panel).toHaveClass(/\bright\b/);
    let box = (await panel.boundingBox())!;
    expect(Math.round(viewport.width - (box.x + box.width))).toBe(16);
    expect(box.y).toBeGreaterThanOrEqual(16);
    expect(box.width).toBeGreaterThan(viewport.width * 0.3);
    expect(box.width).toBeLessThan(viewport.width * 0.36);
    await expect(dim).toHaveCount(0);
    const close = player.getByTestId("close-modal-button");
    await expect(close).toHaveAttribute("aria-label", "Close WorkAdventure modal iframe");
    await close.click();
    await expect(player.locator("#modalIframe")).toHaveCount(0);
    await expect.poll(() => scriptGlobal<number>(player, "modalCloses")).toBe(1);

    await openModal(player, { src: modalSrc, position: "center", title: "Centre box" });
    await expect(panel).toHaveClass(/\bcenter\b/);
    box = (await panel.boundingBox())!;
    expect(Math.abs(box.width - viewport.width * 0.75)).toBeLessThan(4);
    await expect(dim).toHaveCount(1);
    await expect(player.getByTestId("close-modal-button")).toHaveAttribute("aria-label", "Close Centre box");
    await player.keyboard.press("Escape");
    await expect(player.locator("#modalIframe")).toHaveCount(0);
    await expect.poll(() => scriptGlobal<number>(player, "modalCloses")).toBe(2);

    await openModal(player, { src: modalSrc, position: "left" });
    await expect(panel).toHaveClass(/\bleft\b/);
    box = (await panel.boundingBox())!;
    expect(Math.round(box.x)).toBe(16);
    await expect(dim).toHaveCount(0);
    await wa(player, () => (globalThis as Any).WA.ui.modal.closeModal());
    await expect(player.locator("#modalIframe")).toHaveCount(0);
    await expect.poll(() => scriptGlobal<number>(player, "modalEvents")).toBe(3);
});

test("OR-103 Phone: a centre modal is forced full screen with X top right; a right modal is the 80%/400px side window", async ({ page: player, url }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await join(player, url, "Alice");
    const panel = player.locator(".menu-container");
    const viewport = player.viewportSize()!;

    await openModal(player, { src: modalSrc, position: "center" });
    await expect(panel).toHaveClass(/\bmobile\b/);
    let box = (await panel.boundingBox())!;
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.height)).toBe(viewport.height);
    const close = (await player.getByTestId("close-modal-button").boundingBox())!;
    expect(close.x).toBeGreaterThan(viewport.width - 100);
    expect(close.y).toBeLessThan(100);
    await player.getByTestId("close-modal-button").tap();
    await expect(player.locator("#modalIframe")).toHaveCount(0);

    await openModal(player, { src: modalSrc, position: "right" });
    await expect(panel).toHaveClass(/\bright\b/);
    box = (await panel.boundingBox())!;
    expect(Math.abs(box.width - Math.min(viewport.width * 0.8, 400))).toBeLessThan(2);
    expect(Math.round(box.x + box.width)).toBe(viewport.width);
});

test("OR-104 Desktop: a script modal with allowFullScreen expands to full screen and back", async ({ page: player, url }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(player, url, "Alice");
    const panel = player.locator(".menu-container");
    const viewport = player.viewportSize()!;
    await openModal(player, { src: modalSrc, allowFullScreen: true });
    await player.getByRole("button", { name: "Open full-screen view" }).click();
    await expect(panel).toHaveClass(/fullscreened/);
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(viewport.width);
    await player.getByRole("button", { name: "Return to compact view" }).click();
    await expect(panel).not.toHaveClass(/fullscreened/);
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(viewport.width * 0.4);
});

test("OR-105 UI website: entering first_website opens a centred overlay over the game; leaving closes it", async ({ page }, testInfo) => {
    await join(page, tiled(testInfo, "tests/UIWebsite/uiwebsite.json"), "Alice");
    const container = page.locator("#ui-website-container");
    await expect(container.locator('iframe[title="https://www.wikipedia.org/"]')).toHaveCount(1);
    const first = container.locator('iframe[title="http://maps.workadventure.localhost/tests/UIWebsite/index.php"]');
    await expect(first).toHaveCount(0);

    await teleport(page, 6 * 32 + 16, 32 + 16);
    await expect(first).toBeVisible();
    const viewport = page.viewportSize()!;
    const box = (await first.boundingBox())!;
    expect(Math.abs(box.width - viewport.width / 2)).toBeLessThan(4);
    expect(Math.abs(box.height - viewport.height / 2)).toBeLessThan(4);
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(4);

    await teleport(page, 32 + 16, 4 * 32 + 16);
    await expect(first).toHaveCount(0);
});

test("OR-106 @local Embedded website: the map's website object is an iframe on the map that moves with it", async ({ page }, testInfo) => {
    await join(page, tiled(testInfo, "tests/EmbeddedWebsite/website_in_map.json"), "Alice");
    const frame = page.locator('iframe[src*="integrated_website_1.html"]');
    await expect(frame).toBeVisible();
    const before = (await frame.boundingBox())!;
    const start = await playerAt(page);
    await walkUntil(page, "ArrowDown", () => expect.poll(async () => (await playerAt(page)).y, { timeout: 15_000 }).toBeGreaterThan(start.y + 8 * 32));
    await walkUntil(page, "ArrowRight", () => expect.poll(async () => (await playerAt(page)).x, { timeout: 15_000 }).toBeGreaterThan(start.x + 8 * 32));
    await expect.poll(async () => {
        const now = (await frame.boundingBox())!;
        return Math.abs(now.x - before.x) + Math.abs(now.y - before.y);
    }).toBeGreaterThan(20);
});

test("OR-107 Script menu commands show as Settings pages: the iframe one shows inside Settings, the command one runs and closes Settings", async ({ player }, testInfo) => {
    await wa(
        player,
        (src: string) => {
            const WA = (globalThis as Any).WA;
            WA.ui.registerMenuCommand("Script page", { iframe: src });
            WA.ui.registerMenuCommand("Script action", () => {
                (globalThis as Any).menuRan = true;
            });
        },
        INPUT_PAGE
    );
    await openSettings(player);
    const window = player.getByTestId("settings-window");
    const entry = (label: string) =>
        isPhone(testInfo) ? window.getByRole("tab", { name: label }) : window.locator(".u-settings-nav").getByRole("button", { name: label });

    await expect(entry("Script page")).toBeVisible();
    await expect(entry("Script action")).toBeVisible();
    await entry("Script page").click();
    await expect(window.locator(`iframe[src="${INPUT_PAGE}"]`)).toBeVisible();

    await entry("Script action").click();
    await expect.poll(() => scriptGlobal<boolean>(player, "menuRan")).toBe(true);
    await expect(window).toBeHidden();
});

test("OR-108 getMenuCommand('settings').open() opens Settings; 'globalMessages' opens the Broadcast card instead of an old page", async ({ player }) => {
    await wa(player, async () => {
        await (await (globalThis as Any).WA.ui.getMenuCommand("settings")).open();
    });
    await expect(player.getByTestId("settings-window")).toBeVisible();
    await player.locator("#closeMenu").click();
    await expect(player.getByTestId("settings-window")).toBeHidden();

    await wa(player, async () => {
        await (await (globalThis as Any).WA.ui.getMenuCommand("globalMessages")).open();
    });
    await expect(player.getByTestId("broadcast-panel")).toBeVisible();
    await expect(player.getByTestId("settings-window")).toHaveCount(0);
});

test("OR-109 displayActionMessage: popup with the message and Close; SPACE or Close runs the callback and removes it", async ({ player }) => {
    const show = (id: string) =>
        wa(player, (i: string) => {
            const g = globalThis as Any;
            g.actions = g.actions ?? [];
            g.WA.ui.displayActionMessage({ message: "Press SPACE " + i, callback: () => g.actions.push(i) });
        }, id);
    const popupText = (id: string) => player.locator(".popups").getByText("Press SPACE " + id);

    await show("one");
    await expect(popupText("one")).toBeVisible();
    await expect(player.locator(".popups").getByRole("button", { name: "Close" })).toBeVisible();
    await player.keyboard.press("Space");
    await expect.poll(() => scriptGlobal<string[]>(player, "actions")).toEqual(["one"]);
    await expect(popupText("one")).toHaveCount(0);

    await show("two");
    await player.locator(".popups").getByRole("button", { name: "Close" }).click();
    await expect.poll(() => scriptGlobal<string[]>(player, "actions")).toEqual(["one", "two"]);
    await expect(popupText("two")).toHaveCount(0);
});

test("OR-110 displayPlayerMessage: a bubble over your WOKA; SPACE or a click runs the callback and removes it", async ({ player }) => {
    const show = (id: string) =>
        wa(player, (i: string) => {
            const g = globalThis as Any;
            g.messages = g.messages ?? [];
            g.WA.ui.displayPlayerMessage({ message: "Hello " + i, type: "message", callback: () => g.messages.push(i) });
        }, id);
    const bubble = player.locator("span.characterTriggerAction");

    await show("one");
    await expect(bubble).toContainText("Hello one");
    await player.keyboard.press("Space");
    await expect.poll(() => scriptGlobal<string[]>(player, "messages")).toEqual(["one"]);
    await expect(bubble).toHaveCount(0);

    await show("two");
    await expect(bubble).toContainText("Hello two");
    await bubble.click();
    await expect.poll(() => scriptGlobal<string[]>(player, "messages")).toEqual(["one", "two"]);
    await expect(bubble).toHaveCount(0);
});

test("OR-111 WAM tooltip areas: the text shows over your WOKA while inside (or for its duration) and goes when you leave", async ({ page }, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await addWamAreas(url, [
        { id: "tip-forever", name: "tipForever", x: 160, y: 0, width: 128, height: 96, properties: [{ id: "t1", type: "tooltipPropertyData", content: "Stays while inside", duration: 0 }] },
        { id: "tip-short", name: "tipShort", x: 160, y: 224, width: 128, height: 96, properties: [{ id: "t2", type: "tooltipPropertyData", content: "Gone after three seconds", duration: 3 }] },
    ]);
    await join(page, url, "Alice");
    const bubble = page.locator("span.characterTriggerAction");

    await teleport(page, 208, 48);
    await expect(bubble).toContainText("Stays while inside");
    await page.waitForTimeout(5_000);
    await expect(bubble).toContainText("Stays while inside");
    await teleport(page, 48, 144);
    await expect(bubble).toHaveCount(0);

    await teleport(page, 208, 272);
    await expect(bubble).toContainText("Gone after three seconds");
    await expect(bubble).toHaveCount(0, { timeout: 8_000 });
    const inside = await wa(page, async () => (globalThis as Any).WA.player.getPosition());
    expect(inside.y).toBeGreaterThan(224);
});
