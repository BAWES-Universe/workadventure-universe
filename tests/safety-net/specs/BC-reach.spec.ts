import type { Page } from "@playwright/test";
import { test, expect, wamRoom, join, isPhone, newPlayer, wa } from "../lib/game";
import { goLive, openBroadcast, openGoLive, panel, primeAdmin, roomNameOf, turnOnBroadcast } from "../lib/bc";

const PEOPLE = /\b\d+ (person|people)\b/;
const ROOMS = /\b\d+ rooms?\b/;
const WORLDS = /\b\d+ worlds?\b/;

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function reachLine(page: Page, reach: string): Promise<string> {
    return (await page.getByTestId(`broadcast-reach-${reach}`).locator(".u-option-desc").innerText()).trim();
}

async function settingsLine(page: Page, reach: string): Promise<string> {
    const row = page.getByTestId(`broadcast-settings-reach-${reach}`).locator("xpath=..");
    return (await row.locator(".u-menu-label span").nth(1).innerText()).trim();
}

test("BC-020 Who should hear it? lists the switched-on reaches, This world preselected", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { room: true, world: true });
    await page.getByTestId("broadcast-kind-live").click();
    const group = panel(page).getByRole("radiogroup", { name: "Who should hear it?" });
    await expect(group).toBeVisible();
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(page.getByTestId("broadcast-reach-ROOM")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("broadcast-reach-WORLD")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("broadcast-reach-UNIVERSE")).toHaveCount(0);
    await expect(panel(page).getByText("You only see the reach you're allowed to use.")).toBeVisible();
    await expect(page.getByTestId("broadcast-next")).toBeEnabled();
});

test("BC-021 This room is named with the people here now (2 people, then 1 person)", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await openBroadcast(page);
    await turnOnBroadcast(page, { room: true, world: true });
    await page.getByTestId("broadcast-kind-live").click();
    const room = page.getByTestId("broadcast-reach-ROOM");
    await expect(room.locator(".u-option-title")).toHaveText("This room");
    await expect(room.locator(".u-option-desc")).toHaveText(
        new RegExp(`${escape(roomNameOf(url))} · 2 people here now$`)
    );
    await bob.context().close();
    await expect(room.locator(".u-option-desc")).toHaveText(
        new RegExp(`${escape(roomNameOf(url))} · 1 person here now$`),
        { timeout: 30_000 }
    );
});

test("BC-022 This world shows its people and room counts (KNOWN GAP: people)", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { room: true, world: true });
    await page.getByTestId("broadcast-kind-live").click();
    await expect(page.getByTestId("broadcast-reach-WORLD").locator(".u-option-title")).toHaveText("This world");
    await expect(page.getByTestId("broadcast-reach-WORLD").locator(".u-option-desc")).toHaveText(ROOMS);
    expect(await reachLine(page, "WORLD")).toMatch(PEOPLE);
});

test("BC-026 Only This room on: Go live skips Who and the header names the reach", async ({ page }, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { room: true, world: false });
    await page.getByTestId("broadcast-kind-live").click();
    await expect(page.getByTestId("broadcast-go-live")).toBeVisible();
    await expect(page.getByTestId("broadcast-next")).toHaveCount(0);
    await expect(panel(page).locator("header p")).toHaveText(
        new RegExp(`^To This room · .*${escape(roomNameOf(url))}, 1 person here now$`)
    );
});

test("BC-027 Desktop: the selected reach stays purple while hovered (KNOWN GAP)", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover)");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { room: true, world: true });
    await page.getByTestId("broadcast-kind-live").click();
    const row = page.getByTestId("broadcast-reach-ROOM");
    await row.click();
    await expect(row).toHaveAttribute("aria-checked", "true");
    await expect(row).toHaveClass(/u-selected/);
    await page.mouse.move(5, 5);
    const look = () =>
        row.evaluate((el) => {
            const style = getComputedStyle(el);
            return `${style.backgroundColor} | ${style.borderColor}`;
        });
    await expect.poll(look).toBe("rgba(134, 41, 252, 0.14) | rgba(167, 139, 250, 0.7)");
    await row.hover();
    await page.waitForTimeout(400);
    expect(await look()).toBe("rgba(134, 41, 252, 0.14) | rgba(167, 139, 250, 0.7)");
});

test("BC-028 The compose header names the reach with its counts (KNOWN GAP: world people)", async ({
    page,
}, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { room: true, world: true });
    await openGoLive(page, "ROOM");
    await expect(panel(page).locator("header p")).toHaveText(
        new RegExp(`^To This room · .*${escape(roomNameOf(url))}, 1 person here now$`)
    );
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByTestId("broadcast-reach-WORLD").click();
    await page.getByTestId("broadcast-next").click();
    const header = panel(page).locator("header p");
    await expect(header).toHaveText(/^To This world · /);
    await expect(header).toHaveText(ROOMS);
    expect(await header.innerText()).toMatch(PEOPLE);
});

test("BC-030 @local The send button names the chosen reach", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await primeAdmin(page);
    await page.getByTestId("broadcast-kind-message").click();
    await page.getByTestId("broadcast-reach-ROOM").click();
    await page.getByTestId("broadcast-next").click();
    await expect(page.getByTestId("broadcast-send")).toHaveText("Send to This room");
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByTestId("broadcast-reach-WORLD").click();
    await page.getByTestId("broadcast-next").click();
    await expect(page.getByTestId("broadcast-send")).toHaveText("Send to This world");
});

test("BC-031 The Go live notice names the room; local World has no name", async ({ page }, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { room: true, world: true });
    await openGoLive(page, "ROOM");
    const notice = panel(page).locator("p.text-center");
    await expect(notice).toHaveText(
        new RegExp(`^Everyone in .*${escape(roomNameOf(url))} sees and hears you until you press End\\.$`)
    );
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByTestId("broadcast-reach-WORLD").click();
    await page.getByTestId("broadcast-next").click();
    await expect(notice).toHaveText("Everyone sees and hears you until you press End.");
});

test("BC-032 The Live pill's second line is This room · <room name>", async ({ page }, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await goLive(page);
    await expect(page.getByTestId("broadcast-live-pill").locator(".truncate").last()).toHaveText(
        new RegExp(`^This room · .*${escape(roomNameOf(url))}$`)
    );
});

test("BC-034 Broadcast settings: each reach row is named with its counts (KNOWN GAP: counts)", async ({
    page,
}, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await openBroadcast(page);
    await page.getByTestId("broadcast-settings").click();
    const titles = page.getByRole("dialog", { name: "Broadcast settings" }).locator(".u-menu-label span:first-child");
    await expect(titles).toContainText(["This room", "This world", "Everywhere in this universe"]);
    const room = await settingsLine(page, "ROOM");
    const world = await settingsLine(page, "WORLD");
    const universe = await settingsLine(page, "UNIVERSE");
    expect(room).toContain(roomNameOf(url));
    expect(world).toMatch(ROOMS);
    expect(universe).toMatch(WORLDS);
    expect.soft(room, "room row: people count").toMatch(PEOPLE);
    expect.soft(world, "world row: people count").toMatch(PEOPLE);
    expect.soft(universe, "universe row: people count").toMatch(PEOPLE);
    expect.soft(universe, "universe row: room count").toMatch(ROOMS);
});

test("BC-036 The listener's live tile shows the speaker and the reach (KNOWN GAP)", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await wa(page, () => WA.player.teleport(16, 16));
    await wa(bob, () => WA.player.teleport(300, 300));
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await goLive(page);
    const tag = bob.getByTestId("live-tag");
    await expect(tag).toBeVisible({ timeout: 30_000 });
    const tile = bob.locator("div").filter({ has: tag }).filter({ hasText: "Alice" }).last();
    await expect(tile).toBeVisible();
    await expect(tile).toContainText(roomNameOf(url));
});
