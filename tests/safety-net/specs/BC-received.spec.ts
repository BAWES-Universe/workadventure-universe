import type { Page } from "@playwright/test";
import { test, expect, wamRoom, join, isPhone } from "../lib/game";
import { primeCard, wavBuffer } from "../lib/bc";

const RICH_HTML =
    "<h1>Big news</h1><p>Read <a href='https://example.com' target='_blank'>this link</a></p>" +
    "<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>" +
    "<blockquote>quoted</blockquote><pre class='ql-syntax'>code();</pre>" +
    "<p>line</p>".repeat(30);

async function openSettings(page: Page) {
    await page.getByTestId("action-user").getByRole("button").first().click();
    await page.getByTestId("profile-menu").getByText("All settings").click();
    await expect(page.getByTestId("settings-window")).toBeVisible();
}

async function topmostIsInside(page: Page, testId: string, inside: string): Promise<boolean> {
    const box = await page.getByTestId(testId).first().boundingBox();
    if (!box) throw new Error(`${testId} has no box`);
    return page.evaluate(
        ({ x, y, inside }) => !!document.elementFromPoint(x, y)?.closest(`[data-testid="${inside}"]`),
        { x: box.x + box.width / 2, y: box.y + box.height / 2, inside }
    );
}

test("BC-075 @local A received text card: sender, reach line, formatting and Got it", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await primeCard(page, { senderName: "Khalid", reach: "world", reachLabel: "BAWES HQ", html: RICH_HTML });
    const card = page.getByTestId("broadcast-received");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-label", "Broadcast from Khalid");
    const header = card.locator("header");
    await expect(header.locator("> span").first().locator("svg")).toBeVisible();
    await expect(header.getByText("Khalid", { exact: true })).toHaveCSS("font-weight", "700");
    await expect(header.getByText("To everyone in BAWES HQ · now")).toBeVisible();
    await expect(header.locator("> span").last()).toHaveCSS("background-image", /linear-gradient/);
    const text = card.locator(".broadcast-text");
    await expect(text.locator("ul")).toHaveCSS("list-style-type", "disc");
    await expect(text.locator("ol")).toHaveCSS("list-style-type", "decimal");
    await expect(text.locator("h1")).toHaveCSS("font-size", "24px");
    await expect(text.locator("blockquote")).toHaveCSS("border-inline-start-width", "3px");
    await expect(text.locator("pre")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.06)");
    const link = text.getByRole("link", { name: "this link" });
    await expect(link).toHaveCSS("color", "rgb(196, 181, 253)");
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    await expect(text).toHaveCSS("max-height", "192px");
    await expect(text).toHaveCSS("overflow-y", "auto");
    expect(await text.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.getByTestId("broadcast-received-dismiss")).toHaveText("Got it");
    await page.getByTestId("broadcast-received-dismiss").click();
    await expect(card).toHaveCount(0);
});

test("BC-077 @local A received voice card: Play/Pause, wave, duration and caption", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    const audioUrl = "data:audio/wav;base64," + wavBuffer(20).toString("base64");
    await primeCard(page, { senderName: "Khalid", reach: "room", reachLabel: "Main Hall", audioUrl, html: "<p>Listen to this</p>" });
    const card = page.getByTestId("broadcast-received");
    await expect(card.getByText("Listen to this")).toBeVisible();
    const play = page.getByTestId("broadcast-received-play");
    await expect(play).toBeEnabled();
    await expect(card.locator(".tabular-nums")).toHaveText("0:20");
    await expect(card.locator("span.rounded-full[style*='background']")).not.toHaveCount(0);
    const first = await play.getAttribute("aria-label");
    expect(["Play", "Pause"]).toContain(first);
    await play.click();
    await expect(play).toHaveAttribute("aria-label", first === "Play" ? "Pause" : "Play");
    await play.click();
    await expect(play).toHaveAttribute("aria-label", first ?? "");
});

test("BC-078 @local Received cards stack newest first, each until its own Got it", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    for (const name of ["One", "Two", "Three"]) {
        await primeCard(page, { senderName: name, reach: "room", reachLabel: "Main Hall", html: `<p>${name}</p>` });
    }
    const cards = page.getByTestId("broadcast-received");
    await expect(cards).toHaveCount(3);
    await expect(cards.locator("header .font-bold")).toHaveText(["Three", "Two", "One"]);
    const inbox = await page.getByTestId("broadcast-inbox").boundingBox();
    if (!inbox) throw new Error("no inbox box");
    if (isPhone(testInfo)) {
        expect(Math.round(inbox.x)).toBe(12);
        expect(Math.round(inbox.y)).toBe(12);
        expect(Math.round(inbox.width)).toBe(428 - 24);
    } else {
        expect(Math.round(inbox.x)).toBe(1440 - 16 - 380);
        expect(Math.round(inbox.y)).toBe(80);
        expect(Math.round(inbox.width)).toBe(380);
    }
    await cards.nth(1).getByTestId("broadcast-received-dismiss").click();
    await expect(cards.locator("header .font-bold")).toHaveText(["Three", "One"]);
});

test("BC-079 @local Desktop: each Escape dismisses only the newest card", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await primeCard(page, { senderName: "Older", reach: "room", html: "<p>a</p>" });
    await primeCard(page, { senderName: "Newer", reach: "room", html: "<p>b</p>" });
    const names = page.getByTestId("broadcast-received").locator("header .font-bold");
    await expect(names).toHaveText(["Newer", "Older"]);
    await page.keyboard.press("Escape");
    await expect(names).toHaveText(["Older"]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("broadcast-received")).toHaveCount(0);
});

test("BC-080 @local Desktop: Escape closes the open menu or window, not the card", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await primeCard(page, { senderName: "Khalid", reach: "room", html: "<p>stay</p>" });
    const card = page.getByTestId("broadcast-received");
    await expect(card).toHaveCount(1);

    await page.getByTestId("action-user").getByRole("button").first().click();
    await expect(page.getByTestId("profile-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("profile-menu")).toBeHidden();
    await expect(card).toHaveCount(1);

    await openSettings(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-window")).toBeHidden();
    await expect(card).toHaveCount(1);

    await page.getByTestId("chat-btn").click();
    const field = page.getByTestId("chat").locator("input, textarea, [contenteditable='true']").first();
    if (await field.isVisible()) {
        await field.focus();
        await page.keyboard.press("Escape");
        await expect(card).toHaveCount(1);
    }
});

test("BC-081 @local Settings opens over existing cards; a new card comes over Settings; after closing cards are on top", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await primeCard(page, { senderName: "Before", reach: "room", html: "<p>before</p>" });
    await expect(page.getByTestId("broadcast-received")).toHaveCount(1);
    await openSettings(page);
    expect(await topmostIsInside(page, "closeMenuBtn", "closeMenuBtn")).toBe(true);
    await expect(page.getByTestId("broadcast-inbox")).toHaveCSS("z-index", "890");
    const cardBox = await page.getByTestId("broadcast-received").boundingBox();
    const settingsBox = await page.getByTestId("settings-window").boundingBox();
    if (!cardBox || !settingsBox) throw new Error("missing boxes");
    const overlap =
        cardBox.x < settingsBox.x + settingsBox.width &&
        settingsBox.x < cardBox.x + cardBox.width &&
        cardBox.y < settingsBox.y + settingsBox.height &&
        settingsBox.y < cardBox.y + cardBox.height;
    if (overlap) {
        const left = Math.max(cardBox.x, settingsBox.x);
        const right = Math.min(cardBox.x + cardBox.width, settingsBox.x + settingsBox.width);
        const top = Math.max(cardBox.y, settingsBox.y);
        const bottom = Math.min(cardBox.y + cardBox.height, settingsBox.y + settingsBox.height);
        const onTop = await page.evaluate(
            ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="settings-window"]'),
            { x: (left + right) / 2, y: (top + bottom) / 2 }
        );
        expect(onTop, "Settings covers the card where they overlap").toBe(true);
    }

    await primeCard(page, { senderName: "During", reach: "room", html: "<p>during</p>" });
    await expect(page.getByTestId("broadcast-received")).toHaveCount(2);
    await expect(page.getByTestId("broadcast-inbox")).toHaveCSS("z-index", "1090");
    expect(await topmostIsInside(page, "broadcast-received", "broadcast-received")).toBe(true);

    await page.getByTestId("broadcast-received").first().getByTestId("broadcast-received-dismiss").click();
    await expect(page.getByTestId("broadcast-received")).toHaveCount(1);
    await page.getByTestId("closeMenuBtn").click();
    await expect(page.getByTestId("settings-window")).toBeHidden();
    await expect(page.getByTestId("broadcast-inbox")).toHaveCSS("z-index", "1090");
    expect(await topmostIsInside(page, "broadcast-received", "broadcast-received")).toBe(true);
});
