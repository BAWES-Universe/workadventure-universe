import { expect, isPhone, test } from "../lib/game";
import {
    camera,
    drag,
    editRoom,
    hit,
    openEditor,
    openTools,
    pickObject,
    pickTool,
    steadyZoom,
    placeAt,
    entityOnScreen,
    playerPosition,
    rail,
    toScreen,
    settle,
    SPOT_A,
    SPOT_B,
} from "../lib/me";
import { newPlayer } from "../lib/game";
import { module } from "../lib/me";

test("ME-001 Desktop: Tools > Map editor opens the edit pill, rail and Objects panel", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await editRoom(page, testInfo);
    await page.getByTestId("map-menu").click();
    await page.getByRole("button", { name: "Map editor", exact: true }).click();
    await expect(page.getByTestId("map-sub-menu")).toBeHidden();
    const pill = page.getByTestId("edit-pill");
    await expect(pill).toBeVisible();
    await expect(pill.getByTestId("closeMapEditorButton")).toHaveText(/Done/);
    await expect(pill).toContainText(/Editing/i);
    await expect(page.getByTestId("edit-undo")).toBeDisabled();
    await expect(page.getByTestId("edit-redo")).toBeDisabled();
    const r = page.getByTestId("edit-rail");
    await expect(r).toBeVisible();
    await expect(r).toContainText("Objects");
    await expect(r).toContainText("Areas");
    await expect(r).toContainText("Delete");
    await expect(rail(page, "EntityEditor")).toHaveAttribute("aria-pressed", "true");
    await expect(rail(page, "AreaEditor")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("edit-panel")).toBeVisible();
    await expect(page.getByTestId("edit-panel")).toContainText("Objects");
    const pillBox = (await pill.boundingBox())!;
    const railBox = (await r.boundingBox())!;
    expect(Math.abs(pillBox.x + pillBox.width / 2 - 720)).toBeLessThan(40);
    expect(railBox.x + railBox.width).toBeGreaterThan(1440 - 40);
    await expect(page.getByTestId("microphone-button")).toBeVisible();
    await expect(page.getByTestId("map-menu")).toBeVisible();
});

test("ME-002 Phone: menu > Tools > Map editor shows the whole map, pill and rail, play UI hidden", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await editRoom(page, testInfo);
    await openTools(page);
    await page.getByRole("button", { name: "Map editor", exact: true }).click();
    await expect(page.getByTestId("map-sub-menu")).toBeHidden();
    await expect(page.getByTestId("profile-menu")).toBeHidden();
    const pill = page.getByTestId("edit-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("Done");
    await expect(pill).toContainText(/Editing/i);
    await expect(page.getByTestId("edit-undo")).toBeVisible();
    await expect(page.getByTestId("edit-redo")).toBeVisible();
    const pillBox = (await pill.boundingBox())!;
    expect(pillBox.width).toBeGreaterThan(428 - 40);
    await expect(page.getByTestId("edit-rail")).toBeVisible();
    await expect(page.getByTestId("edit-panel")).toBeHidden();
    await expect(page.getByTestId("microphone-button")).toBeHidden();
    await expect(page.getByTestId("map-overview-button")).toBeHidden();
    await expect(page.getByRole("button", { name: "Express yourself" })).toBeHidden();
    await expect(page.getByText("Pick a tool on the right. Drag to move around, pinch to zoom.")).toBeVisible();
});

test("ME-003 @local Done leaves the editor and play is back (a tap, or a right-click on desktop, walks)", async ({ page }, testInfo) => {
    await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    await page.getByTestId("closeMapEditorButton").click();
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    await expect(page.getByTestId("edit-rail")).toBeHidden();
    await expect(page.getByTestId("edit-panel")).toBeHidden();
    await expect(page.getByTestId("microphone-button")).toBeVisible();
    await expect(page.getByTestId("map-overview-button")).toBeVisible();
    await settle(page);
    const start = await playerPosition(page);
    const floor = await toScreen(page, SPOT_A.x, SPOT_A.y);
    if (isPhone(testInfo)) await page.touchscreen.tap(floor.x, floor.y);
    else await page.mouse.click(floor.x, floor.y, { button: "right" });
    await expect.poll(async () => Math.abs((await playerPosition(page)).x - start.x), { message: "the WOKA walks" }).toBeGreaterThan(40);
});

test("ME-004 Desktop: E turns edit mode on (Objects) and off", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await editRoom(page, testInfo);
    await page.keyboard.press("e");
    await expect(page.getByTestId("edit-pill")).toBeVisible();
    await expect(rail(page, "EntityEditor")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("e");
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    await expect(page.getByTestId("look-around")).toBeHidden();
});

test("ME-005 Desktop: backtick closes; 2 Areas, 3 Objects, 5 Delete, 6 closes, 1 Look around", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    await page.keyboard.press("Backquote");
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    await openEditor(page, testInfo);
    await page.keyboard.press("2");
    await expect(rail(page, "AreaEditor")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-panel")).toContainText("Areas");
    await page.keyboard.press("3");
    await expect(rail(page, "EntityEditor")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-panel")).toContainText("Objects");
    await page.keyboard.press("5");
    await expect(rail(page, "TrashEditor")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-panel")).toBeHidden();
    await page.keyboard.press("6");
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    await openEditor(page, testInfo);
    await page.keyboard.press("1");
    await expect(page.getByTestId("look-around")).toBeVisible();
    await expect(page.getByTestId("edit-pill")).toBeHidden();
});

test("ME-006 @local Desktop: 4 opens Configure my room; Room settings save; Megaphone tab is there", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await editRoom(page, testInfo);
    await module(page, "/src/front/Stores/GameStore.ts", (m) => m.userIsAdminStore.set(true));
    await openEditor(page, testInfo);
    await page.keyboard.press("4");
    const win = page.locator(".configure-my-room");
    await expect(win).toBeVisible();
    await expect(page.getByTestId("edit-rail")).not.toContainText(/settings/i);
    await expect(win.locator("li", { hasText: "Megaphone" })).toBeVisible();
    await win.locator("li", { hasText: "Room settings" }).click();
    const description = win.getByRole("textbox", { name: "Room description" });
    await expect(description).toBeVisible();
    await expect(win.getByRole("textbox", { name: "Room name" })).toBeVisible();
    await expect(win.getByText("Tags", { exact: true })).toBeVisible();
    await expect(win.getByRole("textbox", { name: "Room license" })).toBeVisible();
    await description.fill("Safety net room");
    await win.getByText(/^Confirm that you want to save the changes/).click();
    await expect(win.getByRole("checkbox", { name: /Confirm that you want to save the changes/ })).toBeChecked();
    await win.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Room settings saved")).toBeVisible();
});

test("ME-007 @local Rail: tapping lit Objects tucks the panel, but placed objects can still be picked", async ({ page }, testInfo) => {
    const url = await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    await pickTool(page, "EntityEditor");
    await pickObject(page, "Basic Wood Table");
    const id = await placeAt(page, testInfo, url, SPOT_A);
    await page.getByTestId("placing-done").click();
    await expect(page.getByTestId("placing-bar")).toBeHidden();
    if (!(await page.getByTestId("edit-panel").isVisible())) await rail(page, "EntityEditor").click();
    await expect(page.getByTestId("edit-panel")).toBeVisible();
    await rail(page, "EntityEditor").click();
    await expect(page.getByTestId("edit-panel")).toBeHidden();
    await expect(rail(page, "EntityEditor")).toHaveAttribute("aria-pressed", "false");
    await hit(page, testInfo, await entityOnScreen(page, url, id));
    await expect(page.getByTestId("object-actions")).toBeVisible();
});

test("ME-008 Desktop: the panel's drag edge resizes it and the width is remembered", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const url = await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    const panel = page.getByTestId("edit-panel");
    const before = (await panel.boundingBox())!;
    const handle = (await page.locator(".em-resize").boundingBox())!;
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await drag(page, testInfo, from, { x: from.x - 150, y: from.y });
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBeGreaterThan(before.width + 100);
    const wide = (await panel.boundingBox())!.width;
    await drag(page, testInfo, { x: from.x - 150, y: from.y }, { x: 50, y: from.y });
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBeLessThanOrEqual(1440 - 140);
    await drag(page, testInfo, { x: (await panel.boundingBox())!.x + 2, y: from.y }, { x: 1400, y: from.y });
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBeGreaterThanOrEqual(300);
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBeLessThan(310);
    const handle2 = (await page.locator(".em-resize").boundingBox())!;
    const from2 = { x: handle2.x + handle2.width / 2, y: handle2.y + handle2.height / 2 };
    await drag(page, testInfo, from2, { x: from2.x - (wide - 300), y: from2.y });
    const saved = Math.round((await panel.boundingBox())!.width);
    await page.goto(url);
    await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
    await openEditor(page, testInfo);
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBeGreaterThan(saved - 3);
    expect(Math.round((await panel.boundingBox())!.width)).toBeLessThan(saved + 3);
});

test("ME-009 Editing while in a call: the edit pill never covers the video tiles", async ({ page, browser }, testInfo) => {
    test.setTimeout(240_000);
    const url = await editRoom(page, testInfo, "empty");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    const tiles = page.locator("#cameras-container .camera-box:visible");
    await expect.poll(async () => tiles.count(), { message: "Alice sees the bubble's video tiles", timeout: 30_000 }).toBeGreaterThan(1);
    await openEditor(page, testInfo);
    const pill = (await page.getByTestId("edit-pill").boundingBox())!;
    for (let i = 0; i < (await tiles.count()); i++) {
        const t = (await tiles.nth(i).boundingBox())!;
        const overlap =
            Math.max(0, Math.min(pill.x + pill.width, t.x + t.width) - Math.max(pill.x, t.x)) *
            Math.max(0, Math.min(pill.y + pill.height, t.y + t.height) - Math.max(pill.y, t.y));
        expect(overlap, `edit pill overlaps video tile ${i}`).toBe(0);
    }
    await bob.context().close();
});

test("ME-010 @local Editing: dragging pans, zooming works, the WOKA never walks, no Look around", async ({ page }, testInfo) => {
    await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    await expect(rail(page, "EntityEditor")).toHaveAttribute("aria-pressed", "true");
    const me = await playerPosition(page);
    const cam0 = await camera(page);
    const empty = await toScreen(page, SPOT_A.x, SPOT_A.y);
    await drag(page, testInfo, empty, { x: empty.x + 120, y: empty.y - 80 });
    await expect.poll(async () => Math.abs((await camera(page)).x - cam0.x), { message: "the map pans" }).toBeGreaterThan(30);
    expect(await playerPosition(page)).toEqual(me);
    const spot = await toScreen(page, SPOT_B.x, SPOT_B.y);
    await hit(page, testInfo, spot);
    await page.waitForTimeout(800);
    expect(await playerPosition(page), "a tap on the floor never walks while editing").toEqual(me);
    const view0 = (await camera(page)).width;
    const centre = { x: isPhone(testInfo) ? 214 : 500, y: isPhone(testInfo) ? 500 : 500 };
    await steadyZoom(page, testInfo, centre, "out", 3000);
    await expect.poll(async () => (await camera(page)).width, { message: "zoomed out" }).toBeGreaterThan(view0);
    await page.waitForTimeout(800);
    await expect(page.getByTestId("look-around")).toBeHidden();
    await expect(page.getByTestId("edit-pill")).toBeVisible();
    expect(await playerPosition(page)).toEqual(me);
});
