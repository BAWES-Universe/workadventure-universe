import type { Page } from "@playwright/test";
import { expect, isPhone, join, test, wamRoom } from "../lib/game";
import { joinBubble, openProfileMenu, tapOrClick } from "../lib/av";

function tray(page: Page) {
    return page.getByTestId("express-tray");
}

async function openTray(page: Page, testInfo: Parameters<typeof tapOrClick>[1]) {
    await tapOrClick(page, testInfo, page.getByTestId("express-button"));
    await expect(tray(page)).toBeVisible();
}

/** Emojis drawn over a WOKA: spans in Phaser's DOM layer, outside the Express button and tray. */
async function emotesOverWokas(page: Page, emoji: string): Promise<number> {
    return page.evaluate(
        (emoji) =>
            [...document.querySelectorAll("span")].filter(
                (el) => el.textContent?.trim() === emoji && !el.closest("[data-testid=express]") && el.children.length === 0
            ).length,
        emoji
    );
}

test("AV-073 AV-074 Express opens a tray with field, Say/Think, phrases and six emotes", async ({ player }, testInfo) => {
    const button = player.getByTestId("express-button");
    await openTray(player, testInfo);
    const input = player.getByTestId("express-input");
    await expect(input).toHaveAttribute("placeholder", "Say something…");
    if (isPhone(testInfo)) await expect(input).not.toBeFocused();
    else await expect(input).toBeFocused();
    await expect(player.getByTestId("express-say-toggle")).toBeVisible();
    await expect(player.getByTestId("express-think-toggle")).toBeVisible();
    const phrases = player.getByTestId("express-phrases");
    for (const phrase of ["Hi 👋", "Brb", "Thanks", "OK"]) {
        await expect(phrases.getByText(phrase, { exact: true })).toBeVisible();
    }
    await expect(player.getByTestId("express-emotes").getByRole("button")).toHaveCount(6);
    await expect(button).toHaveAttribute("aria-label", "Close");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    if (isPhone(testInfo)) {
        await input.tap();
        await expect(input).toBeFocused();
    }
});

test("AV-075 AV-079 Say bubble and quick phrase show above the WOKA for both players", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await openTray(player, testInfo);
    const input = player.getByTestId("express-input");
    await expect(input).toHaveAttribute("maxlength", "100");
    await input.fill("x".repeat(85));
    await expect(tray(player).getByText("15", { exact: true })).toBeVisible();
    await input.fill("hello");
    await expect(tray(player).getByText("95", { exact: true })).toHaveCount(0);
    await input.press("Enter");
    await expect(tray(player)).toHaveCount(0);
    await expect(player.locator(".say-bubble")).toHaveText("hello");
    await expect(bob.locator(".say-bubble")).toHaveText("hello");
    await expect.poll(() => bob.locator(".say-bubble").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Inter/);
    await expect(bob.locator(".say-bubble")).toHaveCount(0, { timeout: 15_000 });

    await openTray(player, testInfo);
    await tapOrClick(player, testInfo, player.getByTestId("express-phrase-0"));
    await expect(tray(player)).toHaveCount(0);
    await expect(bob.locator(".say-bubble")).toHaveText("Hi 👋");
    await bob.context().close();
});

test("AV-076 Think bubble stays until the WOKA moves", async ({ player }, testInfo) => {
    await openTray(player, testInfo);
    await tapOrClick(player, testInfo, player.getByTestId("express-think-toggle"));
    await player.getByTestId("express-input").fill("hmm");
    await tapOrClick(player, testInfo, player.getByTestId("express-send"));
    const cloud = player.locator(".thinking-cloud");
    await expect(cloud).toHaveText("hmm");
    await player.waitForTimeout(7000);
    await expect(cloud).toHaveText("hmm");
    await player.locator("canvas").first().focus();
    await player.keyboard.down("ArrowRight");
    await player.waitForTimeout(400);
    await player.keyboard.up("ArrowRight");
    await expect(cloud).toHaveCount(0);
});

test("AV-077 Enter opens the tray in Say, Ctrl+Enter in Think", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await player.mouse.click(300, 450, { button: "right" });
    await player.keyboard.press("Enter");
    await expect(tray(player)).toBeVisible();
    await expect(player.getByTestId("express-input")).toBeFocused();
    await expect(player.getByTestId("express-input")).toHaveAttribute("aria-label", "Say");
    await player.keyboard.press("Escape");
    await expect(tray(player)).toHaveCount(0);
    await player.mouse.click(300, 450, { button: "right" });
    await player.keyboard.press("Control+Enter");
    await expect(tray(player)).toBeVisible();
    await expect(player.getByTestId("express-input")).toHaveAttribute("aria-label", "Think");
});

test("AV-078 Emotes from the tray and the number keys show over the WOKA for both players", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    for (let i = 1; i <= 6; i++) {
        await openTray(player, testInfo);
        const emote = player.getByTestId(`express-emote-${i}`);
        const emoji = ((await emote.locator(".emote-glyph").textContent()) ?? "").trim();
        await tapOrClick(player, testInfo, emote);
        await expect(tray(player)).toHaveCount(0);
        await expect.poll(() => emotesOverWokas(bob, emoji), { intervals: [100] }).toBeGreaterThan(0);
        await expect.poll(() => emotesOverWokas(player, emoji), { intervals: [100] }).toBeGreaterThan(0);
    }
    if (!isPhone(testInfo)) {
        await openTray(player, testInfo);
        const emoji = ((await player.getByTestId("express-emote-3").locator(".emote-glyph").textContent()) ?? "").trim();
        await player.keyboard.press("Escape");
        await player.locator("canvas").first().focus();
        await player.keyboard.press("Digit3");
        await expect.poll(() => emotesOverWokas(bob, emoji), { intervals: [100] }).toBeGreaterThan(0);
        await expect(player.getByTestId("express").getByText(emoji)).toBeAttached();
    }
    await bob.context().close();
});

test("AV-080 Right-click or long-press opens Edit Express; a changed phrase is kept after reload", async ({ player, url }, testInfo) => {
    const button = player.getByTestId("express-button");
    if (isPhone(testInfo)) {
        const box = (await button.boundingBox())!;
        const cdp = await player.context().newCDPSession(player);
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await player.waitForTimeout(900);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
        await button.click({ button: "right" });
    }
    await expect(player.getByTestId("express-edit-title")).toHaveText("Edit Express");
    await expect(tray(player).getByText("Tap an emote or a phrase to change it")).toBeVisible();

    await tapOrClick(player, testInfo, player.getByTestId("express-phrase-1"));
    const field = player.getByTestId("express-phrase-input-1");
    await field.fill("Back soon");
    await field.press("Enter");
    await tapOrClick(player, testInfo, player.getByTestId("express-edit"));
    await expect(player.getByTestId("express-edit-title")).toHaveCount(0);
    await expect(player.getByTestId("express-phrase-1")).toContainText("Back soon");

    await player.reload();
    if (await player.getByTestId("loginSceneNameInput").isVisible({ timeout: 10_000 }).catch(() => false)) {
        await join(player, url, "Alice");
    }
    await openTray(player, testInfo);
    await expect(player.getByTestId("express-phrase-1")).toContainText("Back soon");

    if (!isPhone(testInfo)) {
        await player.getByTestId("express-button").click();
        await player.getByTestId("express-button").click({ button: "right" });
        await player.getByTestId("express-emote-2").click();
        await expect(player.locator("emoji-picker")).toBeVisible();
        await player.keyboard.press("Escape");
        await expect(player.locator("emoji-picker")).toHaveCount(0);
        await expect(player.getByTestId("express-edit-title")).toBeVisible();
        await player.keyboard.press("Escape");
        await expect(player.getByTestId("express-edit-title")).toHaveCount(0);
    }
});

test("AV-081 Hovering Express shows the shortcut card on desktop only", async ({ player }, testInfo) => {
    const card = player.getByTestId("express-shortcuts");
    if (isPhone(testInfo)) {
        await player.getByTestId("express-button").hover().catch(() => undefined);
        await player.waitForTimeout(1000);
        await expect(card).toHaveCount(0);
        return;
    }
    await player.getByTestId("express-button").hover();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Say something");
    await expect(card).toContainText("Enter");
    await expect(card).toContainText("Think something");
    await expect(card).toContainText("Ctrl");
    await expect(card).toContainText("Play an emote");
    await expect(card.locator("kbd.express-hint-digit")).toHaveCount(6);
    await expect(card).toContainText("Right-click");
});

test("AV-082 Busy forces Think in the tray", async ({ player }, testInfo) => {
    const menu = await openProfileMenu(player, testInfo);
    await tapOrClick(player, testInfo, menu.locator(".status-button", { hasText: "Busy" }).last());
    const notNow = player.getByRole("button", { name: "Not now" });
    if (await notNow.isVisible({ timeout: 2000 }).catch(() => false)) await notNow.click();
    if (await menu.isVisible()) await tapOrClick(player, testInfo, player.locator("[data-testid=action-user] button.profile-button"));
    await openTray(player, testInfo);
    await expect(player.getByTestId("express-forced-hint")).toHaveText("While you're away or busy, bubbles are thoughts");
    await expect(player.getByTestId("express-input")).toHaveAttribute("aria-label", "Think");
});

test("AV-083 Express stays in Look around, hides in the map editor and never comes back stuck open", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (map editor)");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await page.getByTestId("map-overview-button").click();
    await expect(page.getByTestId("map-overview-button")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("express-button")).toBeVisible();
    await page.getByTestId("map-overview-button").click();
    await expect(page.getByTestId("map-overview-button")).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("express-button").click();
    await expect(tray(page)).toBeVisible();
    await page.getByTestId("map-menu").click();
    await page.getByRole("button", { name: "Map editor" }).click();
    await expect(page.getByTestId("express-button")).toHaveCount(0);
    await expect(tray(page)).toHaveCount(0);
    await page.getByTestId("closeMapEditorButton").click();
    await expect(page.getByTestId("express-button")).toBeVisible();
    await expect(tray(page)).toHaveCount(0);
    await page.getByTestId("express-button").click();
    await expect(tray(page)).toBeVisible();
    await page.getByTestId("express-button").click();
    await expect(tray(page)).toHaveCount(0);
});

test("AV-084 Escape and a click on the map close the tray; Escape returns focus to Express", async ({ player }, testInfo) => {
    await openTray(player, testInfo);
    if (!isPhone(testInfo)) {
        await player.keyboard.press("Escape");
        await expect(tray(player)).toHaveCount(0);
        await expect(player.getByTestId("express-button")).toBeFocused();
        await openTray(player, testInfo);
    }
    const vp = player.viewportSize()!;
    if (isPhone(testInfo)) await player.touchscreen.tap(vp.width / 2, vp.height / 3);
    else await player.mouse.click(vp.width / 2, vp.height / 2);
    await expect(tray(player)).toHaveCount(0);
});
