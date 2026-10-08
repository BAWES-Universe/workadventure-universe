import type { Page, TestInfo } from "@playwright/test";
import { test, expect, wamRoom, join, isPhone, newPlayer, wa, inRoom } from "../lib/game";
import {
    goLive,
    openBroadcast,
    panel,
    primeAdmin,
    roomNameOf,
    saveSettings,
    stageRoom,
    turnOnBroadcast,
} from "../lib/bc";
import { drawArea, pickAreas } from "../lib/me-areas";

const settingsCard = (page: Page) => page.getByRole("dialog", { name: "Broadcast settings" });

async function openSettingsView(page: Page) {
    if (!(await panel(page).isVisible())) await openBroadcast(page);
    await page.getByTestId("broadcast-settings").click();
    await expect(settingsCard(page)).toBeVisible();
}

async function openAreas(page: Page) {
    if (await page.getByTestId("map-menu").isVisible()) await page.getByTestId("map-menu").click();
    else await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Map editor", exact: true }).click();
    await expect(page.getByTestId("edit-pill")).toBeVisible();
    await pickAreas(page);
}

async function newAreaSettings(page: Page, testInfo: TestInfo) {
    await drawArea(page, testInfo);
}

async function backToAreaRows(page: Page) {
    for (let i = 0; i < 3 && !(await page.getByTestId("area-rename").isVisible()); i++) {
        await page.getByTestId("edit-panel-back").click();
    }
    await expect(page.getByTestId("area-rename")).toBeVisible();
}

async function backToAreaList(page: Page) {
    for (let i = 0; i < 3 && !(await page.getByTestId("area-new").isVisible()); i++) {
        await page.getByTestId("edit-panel-back").click();
    }
    await expect(page.getByTestId("area-new")).toBeVisible();
}

const WHO_LABELS = ["Admins only", "Admins and editors", "All members", "Everyone"];
const REACHES = ["ROOM", "WORLD", "UNIVERSE"] as const;

/** The How far rows: which one is picked, and which say "Included". */
async function expectFar(page: Page, picked: (typeof REACHES)[number]) {
    const index = REACHES.indexOf(picked);
    for (const [i, reach] of REACHES.entries()) {
        const row = page.getByTestId(`broadcast-settings-reach-${reach}`);
        await expect(row).toHaveAttribute("aria-checked", String(i === index));
        await expect(row.locator("svg")).toHaveCount(i === index ? 2 : 1);
        if (i < index) {
            await expect(row).toHaveClass(/u-included/);
            await expect(row).toContainText("Included");
        } else {
            await expect(row).not.toHaveClass(/u-included/);
            await expect(row).not.toContainText("Included");
        }
    }
}

test("BC-083 Broadcast settings: Who can go live (roles), How far (one pick), the notes and Save", async ({
    page,
}, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await primeAdmin(page);
    await openSettingsView(page);
    const card = settingsCard(page);
    await expect(card.locator("header p")).toContainText(roomNameOf(url));
    await expect(card.getByText("Who can go live here", { exact: true })).toBeVisible();
    const who = card.getByRole("radiogroup", { name: "Who can go live here" });
    await expect(who.getByRole("radio")).toHaveText(WHO_LABELS);
    // A room nobody has set up: Admins only, Everywhere in this universe.
    await expect(page.getByTestId("broadcast-settings-who-admins")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("broadcast-settings-who-admins").locator("svg")).toHaveCount(1);
    for (const other of ["editors", "members", "everyone"]) {
        await expect(page.getByTestId(`broadcast-settings-who-${other}`)).toHaveAttribute("aria-checked", "false");
        await expect(page.getByTestId(`broadcast-settings-who-${other}`).locator("svg")).toHaveCount(0);
    }
    await expect(card.getByText("You give people a role on the world's Members page in Orbit.")).toBeVisible();
    await expect(card.getByText("How far they can reach", { exact: true })).toBeVisible();
    const far = card.getByRole("radiogroup", { name: "How far they can reach" });
    await expect(far.getByRole("radio")).toHaveCount(3);
    await expect(far.locator(".u-menu-label > span:first-child")).toHaveText([
        "This room",
        "This world",
        "Everywhere in this universe",
    ]);
    await expectFar(page, "UNIVERSE");
    await expect(card.getByText("Each one includes the ones above it.")).toBeVisible();
    await expect(page.getByTestId("broadcast-settings-save")).toHaveText("Save");
    await expect(card.getByRole("switch")).toHaveCount(0);
    await expect(card.locator("input")).toHaveCount(0);
    await expect(card.getByText(/tag/i)).toHaveCount(0);
    await expect(card.getByText("Roles from Orbit will plug in here later.")).toHaveCount(0);
});

test("BC-098 Picking: one role at a time; the reaches above the picked one are tinted and say Included", async ({
    page,
}, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await primeAdmin(page);
    await openSettingsView(page);
    const whoIds = ["admins", "editors", "members", "everyone"];
    for (const picked of whoIds) {
        await page.getByTestId(`broadcast-settings-who-${picked}`).click();
        for (const id of whoIds) {
            const row = page.getByTestId(`broadcast-settings-who-${id}`);
            await expect(row).toHaveAttribute("aria-checked", String(id === picked));
            await expect(row.locator("svg")).toHaveCount(id === picked ? 1 : 0);
        }
    }
    for (const picked of REACHES) {
        await page.getByTestId(`broadcast-settings-reach-${picked}`).click();
        await expectFar(page, picked);
    }
    // This world picked: This room is tinted (Included), the universe row is not.
    await page.getByTestId("broadcast-settings-reach-WORLD").click();
    await page.mouse.move(1, 1);
    const background = (reach: string) =>
        page.getByTestId(`broadcast-settings-reach-${reach}`).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await background("ROOM")).not.toBe(await background("UNIVERSE"));
    expect(await background("ROOM")).not.toBe(await background("WORLD"));
});

test("BC-087 Admins only takes Go live away from everyone else at once; Everyone brings it back without reload", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await openBroadcast(bob);
    await expect(bob.getByTestId("broadcast-kind-live")).toBeEnabled();

    await saveSettings(page, { who: "admins" });
    await expect(bob.getByTestId("broadcast-kind-live")).toHaveCount(0);
    await expect(panel(bob).getByText("Broadcasting is off in this room")).toBeVisible();

    await saveSettings(page, { who: "everyone" });
    await expect(bob.getByTestId("broadcast-kind-live")).toBeEnabled();
    await expect(panel(bob).getByText("What do you want to share?")).toBeVisible();
});

test("BC-088 How far This world: Go live offers This room and This world", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { far: "WORLD" });
    await page.getByTestId("broadcast-kind-live").click();
    const group = panel(page).getByRole("radiogroup", { name: "Who should hear it?" });
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(page.getByTestId("broadcast-reach-ROOM")).toBeVisible();
    await expect(page.getByTestId("broadcast-reach-WORLD")).toBeVisible();
    await expect(page.getByTestId("broadcast-reach-UNIVERSE")).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();
    await primeAdmin(page);
    await page.getByTestId("broadcast-kind-message").click();
    await expect(page.getByTestId("broadcast-reach-ROOM")).toBeVisible();
    await expect(page.getByTestId("broadcast-reach-WORLD")).toBeVisible();
});

test("BC-090 Saved settings come back after a reload", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await saveSettings(page, { who: "editors", far: "WORLD" });
    await page.reload();
    await inRoom(page);
    await primeAdmin(page);
    await openSettingsView(page);
    await expect(page.getByTestId("broadcast-settings-who-editors")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("broadcast-settings-who-admins")).toHaveAttribute("aria-checked", "false");
    await expectFar(page, "WORLD");
});

test("BC-091 @local Desktop edit mode: key 4 opens Configure my room with Room settings only, no Megaphone", async ({
    page,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await primeAdmin(page);
    await page.getByTestId("map-menu").click();
    await page.getByRole("button", { name: "Map editor", exact: true }).click();
    await expect(page.getByTestId("edit-pill")).toBeVisible();
    await page.mouse.click(400, 300);
    await page.keyboard.press("4");
    const window = page.locator(".configure-my-room");
    await expect(window).toBeVisible();
    await expect(window.locator("li", { hasText: "Room settings" })).toBeVisible();
    await expect(window.locator("li")).toHaveCount(1);
    await expect(window.getByText("Megaphone")).toHaveCount(0);
    await expect(window.locator("#megaphone-switch")).toHaveCount(0);
});

test("BC-092 A video-call area still offers Stage and Audience (KNOWN GAP)", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openAreas(page);
    await newAreaSettings(page, testInfo);
    await page.getByTestId("livekitRoomProperty").click();
    await expect(page.getByTestId("area-property-page")).toBeVisible();
    await backToAreaRows(page);
    await expect(page.getByTestId("edit-panel").getByTestId("speakerMegaphone")).toBeVisible();
    await expect(page.getByTestId("edit-panel").getByTestId("listenerMegaphone")).toBeVisible();
});

test("BC-093 A Stage and an Audience linked to it can both be added", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openAreas(page);
    await newAreaSettings(page, testInfo);
    const editPanel = page.getByTestId("edit-panel");
    await expect(editPanel.getByTestId("speakerMegaphone")).toContainText("Stage");
    await expect(editPanel.getByTestId("speakerMegaphone")).toContainText("Speak to the audience");
    await editPanel.getByTestId("speakerMegaphone").click();
    const stageName = page.getByTestId("area-property-page").locator("#tabLink");
    await expect(stageName).toHaveValue(/\S/);
    const name = await stageName.inputValue();
    await backToAreaList(page);

    await newAreaSettings(page, testInfo);
    await expect(editPanel.getByTestId("listenerMegaphone")).toContainText("Audience");
    await expect(editPanel.getByTestId("listenerMegaphone")).toContainText("Hear the stage");
    await editPanel.getByTestId("listenerMegaphone").click();
    const picker = page.getByTestId("area-property-page").locator("#speakerZoneSelector");
    await expect(picker).toBeVisible();
    await expect(picker.locator("option")).toContainText([name]);
});

test("BC-094 Walking onto a Stage goes live to the Audience; leaving stops it", async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    const url = await stageRoom(testInfo);
    await join(page, url, "Alice");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await wa(page, () => WA.player.teleport(160, 160));
    await wa(bob, () => WA.player.teleport(272, 272));
    const aliceTile = bob.getByText("Alice", { exact: true });
    await expect(aliceTile).toHaveCount(0);
    await wa(page, () => WA.player.teleport(48, 48));
    await expect(aliceTile.first()).toBeVisible({ timeout: 30_000 });
    await expect(bob.locator("video").first()).toBeVisible();
    await wa(page, () => WA.player.teleport(160, 160));
    await expect(aliceTile).toHaveCount(0, { timeout: 30_000 });
});

test("BC-095 Live from Broadcast, walking across a Stage or an Audience keeps the broadcast", async ({
    page,
}, testInfo) => {
    const url = await stageRoom(testInfo);
    await join(page, url, "Alice");
    await wa(page, () => WA.player.teleport(160, 160));
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await goLive(page);
    await wa(page, () => WA.player.teleport(48, 48));
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("broadcast-live-pill")).toBeVisible();
    await wa(page, () => WA.player.teleport(272, 272));
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("broadcast-live-pill")).toBeVisible();
    await wa(page, () => WA.player.teleport(160, 160));
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("broadcast-live-pill")).toBeVisible();
});
