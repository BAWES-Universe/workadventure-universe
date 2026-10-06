import type { Page } from "@playwright/test";
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
    const areas = page.locator("section.side-bar-container .side-bar .tool-button button#AreaEditor").first();
    if (!((await areas.getAttribute("aria-pressed")) === "true" && (await page.getByTestId("edit-panel").isVisible()))) {
        await areas.click();
    }
    await expect(page.getByTestId("edit-panel")).toBeVisible();
}

async function newAreaSettings(page: Page) {
    await page.getByTestId("area-new").click();
    await page.getByTestId("area-draft-next").click();
    await expect(page.getByTestId("area-rename")).toBeVisible();
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

test("BC-083 Broadcast settings: who can go live, reach switches, the Orbit line and Save", async ({ page }, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await openSettingsView(page);
    const card = settingsCard(page);
    await expect(card.locator("header p")).toContainText(roomNameOf(url));
    await expect(card.getByText("Who can go live here")).toBeVisible();
    const who = card.getByRole("radiogroup", { name: "Who can go live here" });
    await expect(who.getByRole("radio")).toHaveText(["Admins only", "Everyone", "People with chosen tags"]);
    await expect(page.getByTestId("broadcast-settings-who-everyone")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("broadcast-settings-who-everyone").locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("broadcast-settings-who-admins")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("broadcast-settings-who-admins").locator("svg")).toHaveCount(0);
    await expect(card.getByText("How far they can reach")).toBeVisible();
    await expect(card.getByRole("switch")).not.toHaveCount(0);
    await expect(card.getByText("Roles from Orbit will plug in here later.")).toBeVisible();
    await expect(page.getByTestId("broadcast-settings-save")).toHaveText("Save");
    await expect(card.locator("input")).toHaveCount(0);
    await expect(card.getByText(/space name/i)).toHaveCount(0);
});

test("BC-084 Chosen tags: typed tags become lower-case chips; Escape cancels, clicking away adds, x removes", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openSettingsView(page);
    await page.getByTestId("broadcast-settings-who-tags").click();
    const input = page.getByTestId("broadcast-settings-tag");
    await expect(input).toBeFocused();
    await input.fill("Staff");
    await input.press("Enter");
    const chips = settingsCard(page).locator(".u-chip");
    await expect(chips).toHaveText(["staff"]);
    await expect(chips.getByRole("button", { name: "Remove staff" })).toBeVisible();

    await page.getByTestId("broadcast-settings-add-tag").click();
    await expect(input).toBeFocused();
    await input.fill("dropped");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(chips).toHaveText(["staff"]);
    await expect(panel(page)).toBeVisible();

    await page.getByTestId("broadcast-settings-add-tag").click();
    await input.fill("Guest");
    await settingsCard(page).getByText("How far they can reach").click();
    await expect(chips).toHaveText(["staff", "guest"]);

    await chips.getByRole("button", { name: "Remove staff" }).click();
    await expect(chips).toHaveText(["guest"]);
});

test("BC-085 Chosen tags with no tag: Save says so and nothing is saved", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openSettingsView(page);
    await page.getByTestId("broadcast-settings-who-tags").click();
    await page.getByTestId("broadcast-settings-save").click();
    await expect(settingsCard(page).getByRole("alert")).toHaveText("Add at least one tag, or pick another option.");
    await expect(settingsCard(page)).toBeVisible();
    await page.getByTestId("broadcast-close").click();
    await expect(panel(page)).toBeHidden();
    await openSettingsView(page);
    await expect(page.getByTestId("broadcast-settings-who-everyone")).toHaveAttribute("aria-checked", "true");
});

test("BC-087 Admins only takes Go live away from everyone at once; Everyone brings it back without reload", async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await openBroadcast(bob);
    await expect(bob.getByTestId("broadcast-kind-live")).toBeEnabled();

    await saveSettings(page, { who: "admins", room: true });
    await expect(panel(page).getByText("Broadcasting is off in this room")).toBeVisible();
    await expect(bob.getByTestId("broadcast-kind-live")).toHaveCount(0);
    await expect(panel(bob).getByText("Broadcasting is off in this room")).toBeVisible();

    await saveSettings(page, { who: "everyone", room: true });
    await expect(bob.getByTestId("broadcast-kind-live")).toBeEnabled();
    await expect(panel(bob).getByText("What do you want to share?")).toBeVisible();
});

test("BC-088 This world only: Go live skips Who; Write a message still offers This room", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { room: false, world: true });
    await page.getByTestId("broadcast-kind-live").click();
    await expect(page.getByTestId("broadcast-go-live")).toBeVisible();
    await expect(page.getByTestId("broadcast-next")).toHaveCount(0);
    await expect(panel(page).locator("header p")).toHaveText(/^To This world/);
    await page.getByRole("button", { name: "Back" }).click();
    await primeAdmin(page);
    await page.getByTestId("broadcast-kind-message").click();
    await expect(page.getByTestId("broadcast-reach-ROOM")).toBeVisible();
    await expect(page.getByTestId("broadcast-reach-WORLD")).toBeVisible();
});

test("BC-089 Every reach off: broadcasting is off in the room", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await saveSettings(page, { room: false, world: false });
    await expect(panel(page).getByText("Broadcasting is off in this room")).toBeVisible();
    await expect(page.getByTestId("broadcast-kind-live")).toHaveCount(0);
});

test("BC-090 Saved settings come back after a reload", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await saveSettings(page, { who: "tags", tags: ["staff"], room: false, world: true });
    await page.reload();
    await inRoom(page);
    await openSettingsView(page);
    await expect(page.getByTestId("broadcast-settings-who-tags")).toHaveAttribute("aria-checked", "true");
    await expect(settingsCard(page).locator(".u-chip, [data-testid='broadcast-settings-tag-staff']").first()).toContainText("staff");
    await expect(page.getByTestId("broadcast-settings-reach-ROOM")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("broadcast-settings-reach-WORLD")).toHaveAttribute("aria-checked", "true");
});

test("BC-091 Desktop edit mode: key 4 opens Configure my room on Megaphone", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await page.getByTestId("map-menu").click();
    await page.getByRole("button", { name: "Map editor", exact: true }).click();
    await expect(page.getByTestId("edit-pill")).toBeVisible();
    await page.mouse.click(400, 300);
    await page.keyboard.press("4");
    const window = page.locator(".configure-my-room");
    await expect(window).toBeVisible();
    await expect(window.locator("li", { hasText: "Megaphone" })).toBeVisible();
    const toggle = window.locator("#megaphone-switch");
    await expect(toggle).toBeAttached();
    if (!(await toggle.isChecked())) await window.getByTestId("megaphone-switch").click();
    await expect(toggle).toBeChecked();
    await expect(window.locator("input[type='text']").first()).toBeVisible();
    await expect(window.getByRole("button", { name: /save/i }).first()).toBeVisible();
});

test("BC-092 A video-call area still offers Stage and Audience (KNOWN GAP)", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openAreas(page);
    await newAreaSettings(page);
    await page.getByTestId("livekitRoomProperty").click();
    await expect(page.getByTestId("area-property-page")).toBeVisible();
    await backToAreaRows(page);
    await expect(page.getByTestId("edit-panel").getByTestId("speakerMegaphone")).toBeVisible();
    await expect(page.getByTestId("edit-panel").getByTestId("listenerMegaphone")).toBeVisible();
});

test("BC-093 A Stage and an Audience linked to it can both be added", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openAreas(page);
    await newAreaSettings(page);
    const editPanel = page.getByTestId("edit-panel");
    await expect(editPanel.getByTestId("speakerMegaphone")).toContainText("Stage");
    await expect(editPanel.getByTestId("speakerMegaphone")).toContainText("Speak to the audience");
    await editPanel.getByTestId("speakerMegaphone").click();
    const stageName = page.getByTestId("area-property-page").locator("#tabLink");
    await expect(stageName).toHaveValue(/\S/);
    const name = await stageName.inputValue();
    await backToAreaList(page);

    await newAreaSettings(page);
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

test("BC-095 Live from Broadcast, walking across a Stage or an Audience keeps the broadcast", async ({ page }, testInfo) => {
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
