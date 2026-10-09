import { test, expect, wamRoom, join, isPhone, wa } from "../lib/game";
import {
    openBroadcast,
    openTools,
    panel,
    primeAdmin,
    primeCard,
    roomNameOf,
    setWamMegaphone,
    turnOnBroadcast,
} from "../lib/bc";

test("BC-001 Tools has one Broadcast row in a map-storage room", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await page.getByTestId("map-menu").click();
    const menu = page.getByTestId("map-sub-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("broadcast-menu")).toHaveCount(1);
    await expect(menu.getByTestId("broadcast-menu")).toHaveText("Broadcast");
    await expect(menu.getByTestId("broadcast-menu").locator("svg")).toHaveCount(1);
});

test("BC-002 Phone: Broadcast is reachable from Tools and opens the card", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openTools(page);
    await page.getByTestId("broadcast-menu").click();
    await expect(page.getByTestId("map-sub-menu")).toBeHidden();
    await expect(page.getByTestId("profile-menu")).toBeHidden();
    await expect(panel(page)).toBeVisible();
});

test("BC-003 Only one broadcasting entry: no Send global message, no Global Messages page", async ({
    page,
}, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openTools(page);
    await expect(page.getByTestId("broadcast-menu")).toHaveCount(1);
    await expect(page.getByText(/send global message/i)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);

    await page.getByTestId("action-user").getByRole("button").first().click();
    const profile = page.getByTestId("profile-menu");
    await expect(profile).toBeVisible();
    await expect(profile.getByText(/send global message/i)).toHaveCount(0);
    if (!isPhone(testInfo)) await expect(profile.getByTestId("broadcast-menu")).toHaveCount(0);
    expect(await page.getByTestId("broadcast-menu").count()).toBeLessThanOrEqual(1);
    await profile.getByText("All settings").click();
    const settings = page.getByTestId("settings-window");
    await expect(settings).toBeVisible();
    await expect(settings.getByText(/global messages?/i)).toHaveCount(0);
    await expect(settings.getByText(/send global message/i)).toHaveCount(0);
});

test("BC-004 A tiled map without WAM has no Broadcast entry", async ({ player }) => {
    const tools = player.getByTestId("map-menu");
    if (await tools.isVisible()) {
        await tools.click();
        await expect(player.getByTestId("map-sub-menu")).toBeVisible();
        await expect(player.getByTestId("map-sub-menu").getByRole("button")).not.toHaveCount(0);
    }
    await expect(player.getByTestId("broadcast-menu")).toHaveCount(0);
});

test("BC-005 Desktop: Tools > Broadcast toggles the card and shows the pressed state", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await openTools(page);
    await expect(page.getByTestId("broadcast-menu")).toHaveAttribute("data-state", "open");
    await page.getByTestId("broadcast-menu").click();
    await expect(panel(page)).toBeHidden();
});

test("BC-006 Opening Broadcast closes the menu, the chat and edit mode", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only: on a phone the chat sheet and edit mode hide the bar");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await page.getByTestId("chat-btn").click();
    await expect(page.getByTestId("chat")).toBeVisible();
    await openBroadcast(page);
    await expect(page.getByTestId("chat")).toBeHidden();
    await expect(page.getByTestId("map-sub-menu")).toBeHidden();
    await page.getByTestId("broadcast-close").click();

    await openTools(page);
    await page.getByRole("button", { name: "Map editor" }).click();
    await expect(page.getByTestId("edit-mode")).toBeVisible();
    await openBroadcast(page);
    await expect(page.getByTestId("edit-mode")).toBeHidden();
    await expect(panel(page)).toBeVisible();
});

test("BC-007 Desktop: a centred 420px dialog with no backdrop; bar and arrow keys still work", async ({
    page,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await expect(page.getByRole("dialog", { name: "Broadcast" })).toBeVisible();
    const box = await panel(page).boundingBox();
    if (!box) throw new Error("no panel box");
    expect(Math.round(box.width)).toBe(420);
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThanOrEqual(2);
    const onMap = await page.evaluate(() => document.elementFromPoint(200, 300)?.tagName);
    expect(onMap).toBe("CANVAS");

    const camera = page.getByTestId("camera-button");
    const before = await camera.getAttribute("data-state");
    await camera.click();
    await expect(camera).not.toHaveAttribute("data-state", before ?? "");
    await expect(panel(page)).toBeVisible();

    const start = await wa(page, () => WA.player.getPosition());
    await page.keyboard.down("ArrowRight");
    await expect
        .poll(async () => (await wa(page, () => WA.player.getPosition())).x, { timeout: 5_000 })
        .toBeGreaterThan(start.x);
    await page.keyboard.up("ArrowRight");
});

test("BC-008 Phone: the card sits at the top with 12px gutters and scrolls inside; the bar stays usable", async ({
    page,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    // The card slides in; measure it once it has stopped.
    let last = "";
    await expect
        .poll(async () => {
            const now = JSON.stringify(await panel(page).boundingBox());
            const same = now === last;
            last = now;
            return same;
        })
        .toBe(true);
    const box = await panel(page).boundingBox();
    if (!box) throw new Error("no panel box");
    expect(Math.round(box.x)).toBe(12);
    expect(Math.round(box.y)).toBe(32);
    expect(Math.round(box.width)).toBe(428 - 24);
    const dialog = page.getByRole("dialog", { name: "Broadcast" });
    await expect(dialog).toHaveCSS("overflow-y", "auto");
    await expect(dialog).toHaveCSS("max-height", `${926 - 64}px`);
    const mic = page.getByTestId("microphone-button");
    await expect(mic).toBeVisible();
    const micBox = await mic.boundingBox();
    if (!micBox) throw new Error("no mic box");
    const hit = await page.evaluate(
        ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="microphone-button"]'),
        { x: micBox.x + micBox.width / 2, y: micBox.y + micBox.height / 2 }
    );
    expect(hit).toBe(true);
    const before = await mic.getAttribute("data-state");
    await mic.click();
    await expect(mic).not.toHaveAttribute("data-state", before ?? "");
});

test("BC-009 X and Escape close the card; Escape leaves a received card", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await expect(page.getByTestId("broadcast-close")).toHaveAttribute("aria-label", "Close");
    await page.getByTestId("broadcast-close").click();
    await expect(panel(page)).toBeHidden();

    await primeCard(page, { senderName: "Khalid", reach: "room", reachLabel: "Main Hall", html: "<p>Hello</p>" });
    await expect(page.getByTestId("broadcast-received")).toHaveCount(1);
    await openBroadcast(page);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(page.getByTestId("broadcast-received")).toHaveCount(1);
});

test("BC-010 Back goes compose > Who > What and clears the choice", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await page.getByTestId("broadcast-kind-live").click();
    await expect(page.getByTestId("broadcast-go-live")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(panel(page).getByText("What do you want to share?")).toBeVisible();

    await primeAdmin(page);
    await page.getByTestId("broadcast-kind-message").click();
    await expect(panel(page).getByText("Who should hear it?")).toBeVisible();
    await page.getByTestId("broadcast-reach-ROOM").click();
    await page.getByTestId("broadcast-next").click();
    await expect(page.getByTestId("broadcast-send")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(panel(page).getByText("Who should hear it?")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(panel(page).getByText("What do you want to share?")).toBeVisible();
    await page.getByTestId("broadcast-kind-message").click();
    await expect(page.getByTestId("broadcast-reach-ROOM")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("broadcast-reach-WORLD")).toHaveAttribute("aria-checked", "true");
});

test("BC-011 Opening Settings or the room list closes the Broadcast card", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await page.getByTestId("action-user").getByRole("button").first().click();
    await page.getByTestId("profile-menu").getByText("All settings").click();
    await expect(page.getByTestId("settings-window")).toBeVisible();
    await expect(panel(page)).toBeHidden();
    await page.getByTestId("closeMenuBtn").click();
    await expect(page.getByTestId("settings-window")).toBeHidden();

    await openBroadcast(page);
    const explore = isPhone(testInfo)
        ? page.getByTestId("explore-tile")
        : page.getByRole("button", { name: /^Explore/ });
    await expect(explore, "room list entry").toBeVisible();
    await explore.click();
    await expect(panel(page)).toBeHidden();
});

test('BC-012 WA.ui.getMenuCommand("globalMessages").open() opens the Broadcast card', async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await wa(page, async () => (await WA.ui.getMenuCommand("globalMessages")).open());
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Broadcast" })).toBeVisible();
    await expect(page.getByTestId("settings-window")).toBeHidden();
});

test("BC-013 Three progress dots fill one per step; settings has none", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page, { far: "WORLD" });
    const dots = panel(page).locator(".u-step");
    const filled = () => dots.evaluateAll((all) => all.map((dot) => dot.getAttribute("data-done")));
    await expect.poll(filled).toEqual(["true", "false", "false"]);
    await page.getByTestId("broadcast-kind-live").click();
    await expect(page.getByTestId("broadcast-next")).toBeVisible();
    await expect.poll(filled).toEqual(["true", "true", "false"]);
    await page.getByTestId("broadcast-next").click();
    await expect(page.getByTestId("broadcast-go-live")).toBeVisible();
    await expect.poll(filled).toEqual(["true", "true", "true"]);
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await primeAdmin(page);
    await page.getByTestId("broadcast-settings").click();
    await expect(page.getByRole("dialog", { name: "Broadcast settings" })).toBeVisible();
    await expect(dots).toHaveCount(0);
});

test("BC-014 Non-admin who may go live sees only Go live on the What step", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    const card = page.getByRole("dialog", { name: "Broadcast" });
    await expect(card.getByRole("heading", { name: "Broadcast" })).toBeVisible();
    await expect(card.getByText("Reach everyone at once")).toBeVisible();
    await expect(card.getByText("What do you want to share?")).toBeVisible();
    await expect(page.getByTestId("broadcast-kind-live")).toContainText("Go live");
    await expect(page.getByTestId("broadcast-kind-live")).toContainText("Talk live with your camera, mic or screen");
    await expect(page.getByTestId("broadcast-kind-message")).toHaveCount(0);
    await expect(page.getByTestId("broadcast-kind-voice")).toHaveCount(0);
    await expect(card.getByText("Next you choose who gets it")).toBeVisible();
});

test("BC-015 @local Admin sees Write a message, Voice note and Go live, each with a chevron", async ({
    page,
}, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await primeAdmin(page);
    const rows = [
        ["broadcast-kind-message", "Write a message", "A card everyone sees and can read when they like"],
        ["broadcast-kind-voice", "Voice note", "Record yourself now, or use a sound you have"],
        ["broadcast-kind-live", "Go live", "Talk live with your camera, mic or screen"],
    ];
    for (const [id, title, desc] of rows) {
        const row = page.getByTestId(id);
        await expect(row).toContainText(title);
        await expect(row).toContainText(desc);
        await expect(row).toBeEnabled();
        await expect(row.locator("svg.u-option-go")).toHaveCount(1);
    }
    await expect(panel(page).locator(".u-option")).toHaveCount(3);
});

test("BC-018 @local Admin left out by tags saved by the old settings: Go live greyed, Write and Voice work", async ({
    page,
}, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await setWamMegaphone(url, {
        enabled: true,
        title: "MyMegaphone",
        scope: "ROOM",
        rights: ["nobody-has-this"],
        scopes: ["ROOM"],
    });
    await join(page, url, "Alice");
    await primeAdmin(page);
    await openBroadcast(page);
    const live = page.getByTestId("broadcast-kind-live");
    await expect(live).toBeDisabled();
    await expect(live).toContainText("You can't go live here. Ask a room admin.");
    await expect(page.getByTestId("broadcast-kind-message")).toBeEnabled();
    await expect(page.getByTestId("broadcast-kind-voice")).toBeEnabled();
    await page.getByTestId("broadcast-kind-message").click();
    await expect(page.getByTestId("broadcast-reach-ROOM").or(page.getByTestId("broadcast-send")).first()).toBeVisible();
});

test("BC-019 Only admins see the sliders button; it opens Broadcast settings with the room name", async ({
    page,
}, testInfo) => {
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await openBroadcast(page);
    await expect(panel(page).getByRole("heading", { name: "Broadcast" })).toBeVisible();
    await expect(page.getByTestId("broadcast-settings")).toHaveCount(0);
    await page.getByTestId("broadcast-close").click();
    await primeAdmin(page);
    await openBroadcast(page);
    await expect(page.getByTestId("broadcast-settings")).toHaveAttribute("aria-label", "Broadcast settings");
    await page.getByTestId("broadcast-settings").click();
    const card = page.getByRole("dialog", { name: "Broadcast settings" });
    await expect(card.getByRole("heading", { name: "Broadcast settings" })).toBeVisible();
    await expect(card.locator("header p")).toContainText(roomNameOf(url));
});
