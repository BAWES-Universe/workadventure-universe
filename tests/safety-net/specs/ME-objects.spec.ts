import { expect, isPhone, newPlayer, test } from "../lib/game";
import {
    drag,
    editRoom,
    entityOnScreen,
    hit,
    openEditor,
    pickObject,
    pickTool,
    placeAt,
    rail,
    readWam,
    scene,
    toScreen,
    entityBox,
    SPOT_A,
    SPOT_B,
    SPOT_C,
} from "../lib/me";
import type { Page, TestInfo } from "@playwright/test";

async function objectsOpen(page: Page, testInfo: TestInfo): Promise<string> {
    const url = await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    await pickTool(page, "EntityEditor");
    return url;
}

/** Places one object beside the WOKA, stops placing, and tucks the panel on a phone. Returns its id. */
async function placedObject(page: Page, testInfo: TestInfo, url: string, name = "Basic Wood Table", spot = SPOT_A): Promise<string> {
    await pickObject(page, name);
    const id = await placeAt(page, testInfo, url, spot);
    await page.getByTestId("placing-done").click();
    await expect(page.getByTestId("placing-bar")).toBeHidden();
    return id;
}

async function selectPlaced(page: Page, testInfo: TestInfo, url: string, id: string): Promise<void> {
    await hit(page, testInfo, await entityOnScreen(page, url, id));
    await expect(page.getByTestId("object-actions")).toBeVisible();
}

test("ME-011 Objects panel: title, line, search, categories, sections, tiles, Add your own", async ({ page }, testInfo) => {
    await objectsOpen(page, testInfo);
    const panel = page.getByTestId("edit-panel");
    await expect(panel.locator(".em-title").first()).toHaveText("Objects");
    await expect(panel).toContainText(isPhone(testInfo) ? "Pick one, then tap the map" : "Pick one, then click the map");
    await expect(page.getByTestId("objects-search")).toHaveAttribute("placeholder", "Search objects");
    const select = panel.locator('select[aria-label="All categories"]');
    await expect(select).toBeAttached();
    await expect(panel.locator(".em-cat-label")).toHaveText("All categories");
    await expect(panel.locator(".em-cat-count")).toHaveText(/^\d+$/);
    const basic = panel.locator(".em-sech", { hasText: /basic/i }).first();
    await expect(basic).toBeVisible();
    await expect(basic.locator("b")).toHaveText(/^\d+$/);
    await expect(basic.getByRole("button", { name: "All" })).toBeVisible();
    await expect(panel.getByTestId("entity-item").filter({ hasText: "Basic Chair" }).first()).toBeVisible();
    await expect(panel).not.toContainText("Recently used");
    await expect(panel).not.toContainText("Your uploads");
    await expect(page.getByTestId("objects-add-your-own")).toHaveText(/Add your own/);
});

test("ME-011 ME-014 @local Desktop placing: hint and bar, every click places a copy, Done stops, Recently used", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const url = await objectsOpen(page, testInfo);
    await pickObject(page, "Basic Wood Table");
    await expect(page.getByTestId("edit-panel")).toBeVisible();
    await expect(page.getByText("Click to place · R to turn · Esc to stop · Ctrl+Z to undo")).toBeVisible();
    const bar = page.getByTestId("placing-bar");
    await expect(bar).toContainText("Basic Wood Table");
    await expect(bar).toContainText("Click the map to place");
    await expect(bar.locator(".em-thumb")).toBeVisible();
    await expect(page.getByTestId("placing-done")).toHaveText("Done");
    await placeAt(page, testInfo, url, SPOT_A);
    await placeAt(page, testInfo, url, SPOT_B);
    expect(Object.keys((await readWam(url)).entities)).toHaveLength(2);
    await expect(bar).toBeVisible();
    await page.getByTestId("placing-done").click();
    await expect(bar).toBeHidden();
    await page.getByTestId("objects-search").fill("");
    await expect(page.getByTestId("edit-panel")).toContainText("Recently used");
    await expect(page.getByTestId("edit-panel").locator(".em-sech").first()).toContainText("Recently used");
});

test("ME-012 Search filters tiles by name or tag, 'Nothing matches', clearing restores", async ({ page }, testInfo) => {
    await objectsOpen(page, testInfo);
    const panel = page.getByTestId("edit-panel");
    const search = page.getByTestId("objects-search");
    await search.fill("chair");
    await expect(panel.locator(".em-sech")).toHaveCount(0);
    const tiles = panel.getByTestId("entity-item");
    await expect(tiles.first()).toBeVisible();
    const names = await tiles.allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => /chair/i.test(n))).toBe(true);
    await search.fill("zzzz");
    await expect(panel.getByText("Nothing matches")).toBeVisible();
    await expect(tiles).toHaveCount(0);
    await search.fill("");
    await expect(panel.locator(".em-sech").first()).toBeVisible();
    await expect(panel.getByText("Nothing matches")).toBeHidden();
});

test("ME-013 Category dropdown and a section's All show one category; the back circle returns", async ({ page }, testInfo) => {
    await objectsOpen(page, testInfo);
    const panel = page.getByTestId("edit-panel");
    const sectionCount = Number(await panel.locator(".em-sech", { hasText: /bathroom/i }).locator("b").innerText());
    await panel.locator('select[aria-label="All categories"]').selectOption({ index: 2 });
    await expect(panel.locator(".em-sech")).toHaveCount(0);
    await expect(page.getByTestId("edit-panel-back")).toBeVisible();
    const label = await panel.locator(".em-cat-label").innerText();
    const count = Number(await panel.locator(".em-cat-count").innerText());
    expect(label).not.toBe("All categories");
    await expect(panel.getByTestId("entity-item")).toHaveCount(count);
    await page.getByTestId("edit-panel-back").click();
    await expect(panel.locator(".em-cat-label")).toHaveText("All categories");
    await expect(panel.locator(".em-sech").first()).toBeVisible();
    await expect(page.getByTestId("edit-panel-back")).toBeHidden();
    await panel.locator(".em-sech", { hasText: /basic/i }).first().getByRole("button", { name: "All" }).click();
    await expect(panel.locator(".em-cat-label")).toHaveText(/basic/i);
    await expect(panel.getByTestId("entity-item").filter({ hasText: "Armchair" }).first()).toBeVisible();
    expect(sectionCount).toBeGreaterThan(0);
});

test("ME-015 @local Desktop placing: Shift snaps to the grid, blocked spots place nothing, right-click and Esc stop", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const url = await objectsOpen(page, testInfo);
    await pickObject(page, "Basic Chair");
    const spot = await toScreen(page, SPOT_A.x + 3, SPOT_A.y + 5);
    await page.mouse.move(spot.x - 4, spot.y);
    await page.keyboard.down("Shift");
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.click(spot.x, spot.y);
    await page.keyboard.up("Shift");
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length).toBe(1);
    const placed = Object.values((await readWam(url)).entities)[0];
    expect(placed.x % 32, "Shift snaps x to the 32 px grid").toBe(0);
    expect(placed.y % 32, "Shift snaps y to the 32 px grid").toBe(0);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(page.getByTestId("placing-bar"), "right-click stops placing").toBeHidden();
    await pickObject(page, "Basic Wood Table");
    const wall = await toScreen(page, 5 * 32 + 16, 2 * 32 + 16);
    await page.mouse.move(wall.x - 3, wall.y);
    await page.mouse.move(wall.x, wall.y);
    const tint = await scene(page, (s) => {
        const tool = s.getMapEditorModeManager().currentlyActiveTool;
        return tool.entityPrefabPreview?.tintTopLeft as number;
    });
    expect(tint, "preview is red where it can't go").toBe(0xff0000);
    await page.mouse.click(wall.x, wall.y);
    await page.waitForTimeout(1000);
    expect(Object.keys((await readWam(url)).entities)).toHaveLength(1);
    await pickObject(page, "Basic Chair");
    await page.mouse.move(spot.x + 40, spot.y + 40);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("placing-bar"), "Esc stops placing").toBeHidden();
});

test("ME-016 @local Phone placing: tap shows the preview and 'Tap again to place', drag moves it, tap places, Done", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const url = await objectsOpen(page, testInfo);
    await pickObject(page, "Basic Wood Table");
    await expect(page.getByTestId("edit-panel")).toBeHidden();
    const bar = page.getByTestId("placing-bar");
    const name = bar.locator(".em-t");
    const line = bar.locator(".em-m");
    for (const el of [name, line]) {
        const clipped = await el.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
        expect(clipped, `placing bar text "${await el.innerText()}" is cut off`).toBe(false);
    }
    const first = await toScreen(page, SPOT_A.x, SPOT_A.y);
    await page.touchscreen.tap(first.x, first.y);
    await expect(page.getByText("Tap again to place")).toBeVisible();
    expect(Object.keys((await readWam(url)).entities)).toHaveLength(0);
    const preview = async () =>
        scene(page, (s) => {
            const p = s.getMapEditorModeManager().currentlyActiveTool.entityPrefabPreview;
            return { x: p.x as number, y: p.y as number, w: p.displayWidth as number, h: p.displayHeight as number };
        });
    const p0 = await preview();
    const cam0 = await scene(page, (s) => s.cameras.main.worldView.x as number);
    const centre = await toScreen(page, p0.x, p0.y);
    await drag(page, testInfo, centre, { x: centre.x + 48, y: centre.y });
    await expect.poll(async () => Math.round((await preview()).x)).toBeGreaterThan(Math.round(p0.x) + 20);
    expect(await scene(page, (s) => s.cameras.main.worldView.x as number), "the map does not pan while dragging the preview").toBe(cam0);
    const p1 = await preview();
    const onPreview = await toScreen(page, p1.x, p1.y);
    await page.touchscreen.tap(onPreview.x, onPreview.y);
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length).toBe(1);
    await expect(bar).toBeVisible();
    const second = await toScreen(page, SPOT_C.x, SPOT_C.y);
    await page.touchscreen.tap(second.x, second.y);
    await expect(page.getByText("Tap again to place")).toBeVisible();
    await page.getByTestId("placing-done").click();
    await expect(bar).toBeHidden();
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length, { message: "Done places the waiting preview" }).toBe(2);
});

test("ME-017 @local Turn and colour: R / Turn change the side, dots recolour, placed copies keep them", async ({ page }, testInfo) => {
    const url = await objectsOpen(page, testInfo);
    await pickObject(page, "Basic Chair");
    const bar = page.getByTestId("placing-bar");
    const dots = bar.locator(".em-colors button.em-dot");
    await expect(dots).toHaveCount(5);
    await page.getByTestId("placing-turn").click();
    const blue = bar.locator('.em-colors button.em-dot[aria-label="blue"]');
    await blue.click();
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    const id1 = await placeAt(page, testInfo, url, SPOT_A);
    const ref1 = (await readWam(url)).entities[id1].prefabRef.id;
    expect(ref1).toContain(":blue:");
    expect(ref1.endsWith(":Down"), `Turn changed the side (${ref1})`).toBe(false);
    if (!isPhone(testInfo)) {
        await page.keyboard.press("r");
        const id2 = await placeAt(page, testInfo, url, SPOT_B);
        const ref2 = (await readWam(url)).entities[id2].prefabRef.id;
        expect(ref2).toContain(":blue:");
        expect(ref2.split(":").pop(), `R turned the side again (${ref1} -> ${ref2})`).not.toBe(ref1.split(":").pop());
    }
});

test("ME-018 @local Selecting a placed object shows Move, Copy, Settings, Delete right next to it", async ({ page }, testInfo) => {
    const url = await objectsOpen(page, testInfo);
    const id = await placedObject(page, testInfo, url, "Basic Wood Table", SPOT_B);
    if (isPhone(testInfo)) {
        await expect(page.getByTestId("edit-panel")).toBeHidden();
    }
    const centre = await entityOnScreen(page, url, id);
    if (!isPhone(testInfo)) {
        await page.mouse.move(centre.x - 5, centre.y);
        await page.mouse.move(centre.x, centre.y);
        await expect.poll(async () => scene(page, (s, eid: string) => {
            const e = s.getGameMapFrontWrapper().getEntitiesManager().getEntities().get(eid);
            let colour: unknown = null;
            e.outlineColorStore.subscribe((c: unknown) => (colour = c))();
            return colour ?? null;
        }, id), { message: "hover outlines it green" }).toBe(0x00ff00);
    }
    await selectPlaced(page, testInfo, url, id);
    const chip = page.getByTestId("object-actions");
    for (const name of ["Move", "Copy", "Settings", "Delete"]) await expect(chip.getByRole("button", { name })).toBeVisible();
    const box = (await chip.boundingBox())!;
    const obj = await entityBox(page, id);
    const gap = Math.min(Math.abs(box.y - (obj.y + obj.height)), Math.abs(box.y + box.height - obj.y));
    const sideBySide = Math.min(box.x + box.width, obj.x + obj.width) - Math.max(box.x, obj.x);
    expect(gap, `the chip sits right under or over the object (chip ${JSON.stringify(box)}, object ${JSON.stringify(obj)})`).toBeLessThan(30);
    expect(sideBySide, `the chip lines up with the object (chip ${JSON.stringify(box)}, object ${JSON.stringify(obj)})`).toBeGreaterThan(0);
    if (!isPhone(testInfo)) await page.mouse.move(5, 450);
    await expect
        .poll(async () => scene(page, (s, eid: string) => {
            const e = s.getGameMapFrontWrapper().getEntitiesManager().getEntities().get(eid);
            let colour: unknown = null;
            e.outlineColorStore.subscribe((c: unknown) => (colour = c))();
            return colour ?? null;
        }, id), { message: "the picked object stays highlighted" })
        .not.toBeNull();
});

test("ME-019 @local Dragging a placed object moves it and saves; Move shows its hint", async ({ page }, testInfo) => {
    const url = await objectsOpen(page, testInfo);
    const id = await placedObject(page, testInfo, url);
    const before = (await readWam(url)).entities[id];
    await selectPlaced(page, testInfo, url, id);
    await page.getByTestId("object-actions").getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("Move: Drag inside the box to move it")).toBeVisible();
    await expect(page.getByText("Move: Drag inside the box to move it")).toBeHidden({ timeout: 5000 });
    const from = await entityOnScreen(page, url, id);
    const tile = (await toScreen(page, 32, 0)).x - (await toScreen(page, 0, 0)).x;
    await drag(page, testInfo, from, { x: from.x + 3 * tile, y: from.y }, 15);
    await expect.poll(async () => (await readWam(url)).entities[id]?.x, { message: "moved object saved" }).toBeGreaterThanOrEqual(before.x + 64);
    expect(Object.keys((await readWam(url)).entities)).toHaveLength(1);
});

test("ME-020 @local Copy puts the same object one step right; Ctrl+drag leaves a copy", async ({ page }, testInfo) => {
    const url = await objectsOpen(page, testInfo);
    const id = await placedObject(page, testInfo, url);
    const orig = (await readWam(url)).entities[id];
    await selectPlaced(page, testInfo, url, id);
    await page.getByTestId("object-copy").click();
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length).toBe(2);
    const wam = await readWam(url);
    const copy = Object.entries(wam.entities).find(([k]) => k !== id)![1];
    expect(copy.prefabRef.id).toBe(orig.prefabRef.id);
    expect(copy.y).toBe(orig.y);
    expect(copy.x).toBeGreaterThan(orig.x);
    expect(copy.x - orig.x).toBeLessThanOrEqual(96);
    if (!isPhone(testInfo)) {
        const from = await entityOnScreen(page, url, id);
        const to = await toScreen(page, orig.x + 16, orig.y + 16 + 96);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.keyboard.down("Control");
        for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
        await page.mouse.up();
        await page.keyboard.up("Control");
        await expect.poll(async () => Object.keys((await readWam(url)).entities).length, { message: "Ctrl+drag leaves a copy" }).toBe(3);
        const after = (await readWam(url)).entities[id];
        expect({ x: after.x, y: after.y }).toEqual({ x: orig.x, y: orig.y });
    }
});

test("ME-021 @local Object settings: name, description, searchable, property buttons, Open a website; back deselects", async ({ page }, testInfo) => {
    const url = await objectsOpen(page, testInfo);
    const id = await placedObject(page, testInfo, url);
    await selectPlaced(page, testInfo, url, id);
    await page.getByTestId("object-settings").click();
    const settings = page.getByTestId("object-settings-page");
    await expect(settings).toBeVisible();
    const panel = page.getByTestId("edit-panel");
    await expect(panel.locator(".em-title").first()).toHaveText("Basic Wood Table");
    await expect(panel).toContainText("What happens when someone uses it");
    await expect(settings.locator("#objectName")).toBeVisible();
    for (const testId of [
        "playAudio",
        "openWebsite",
        "openFile",
        "openWebsiteKlaxoon",
        "openWebsiteYoutube",
        "openWebsiteGoogleDrive",
        "openWebsiteGoogleDocs",
        "openWebsiteGoogleSheets",
        "openWebsiteGoogleSlides",
        "openWebsiteEraser",
        "openWebsiteExcalidraw",
        "openWebsiteTldraw",
    ]) {
        await expect(settings.getByTestId(testId).first(), testId).toBeVisible();
    }
    await expect(settings.locator("#searchable")).toBeAttached();
    await settings.locator("#objectName").fill("Front desk");
    await settings.locator("#objectName").press("Enter");
    const addDescription = settings.getByText("+ Add description field");
    if (await addDescription.isVisible()) await addDescription.click();
    await settings.locator("#objectDescription").fill("Ask here");
    // A text area (prod and dev): Enter adds a line, leaving the field saves it.
    await settings.locator("#objectDescription").blur();
    await settings.getByTestId("searchable").click();
    await settings.getByTestId("openWebsite").first().click();
    await settings.locator("input#tabLink").fill("https://example.org/");
    await settings.locator("input#tabLink").press("Enter");
    await expect
        .poll(async () => {
            const e = (await readWam(url)).entities[id];
            const about = e.properties?.find((p) => p.type === "entityDescriptionProperties");
            return { name: e.name, description: about?.description, searchable: about?.searchable, website: e.properties?.find((p) => p.type === "openWebsite")?.link };
        })
        .toEqual({ name: "Front desk", description: "Ask here", searchable: true, website: "https://example.org/" });
    await page.getByTestId("edit-panel-back").click();
    await expect(settings).toBeHidden();
    await expect(page.getByTestId("objects-search")).toBeVisible();
    await expect(page.getByTestId("object-actions")).toBeHidden();
});

test("ME-022 @local Delete from the chip or the Delete key, toast with Undo brings it back", async ({ page }, testInfo) => {
    const url = await objectsOpen(page, testInfo);
    const id = await placedObject(page, testInfo, url);
    await selectPlaced(page, testInfo, url, id);
    await page.getByTestId("object-delete").click();
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length).toBe(0);
    const toast = page.getByTestId("edit-undo-toast");
    await expect(toast).toContainText("Basic Wood Table removed");
    await page.getByTestId("edit-undo-toast-undo").click();
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length, { message: "Undo in the toast brings it back" }).toBe(1);
    if (!isPhone(testInfo)) {
        const back = Object.keys((await readWam(url)).entities)[0];
        await selectPlaced(page, testInfo, url, back);
        await page.keyboard.press("Delete");
        await expect.poll(async () => Object.keys((await readWam(url)).entities).length).toBe(0);
        await expect(toast).toContainText("removed");
        await expect(toast).toBeHidden({ timeout: 10_000 });
    }
});

test("ME-023 @local A tap on empty floor or Esc deselects; an open settings page returns to the picker", async ({ page }, testInfo) => {
    const url = await objectsOpen(page, testInfo);
    const id = await placedObject(page, testInfo, url);
    await selectPlaced(page, testInfo, url, id);
    // Empty floor beside the object (SPOT_C can sit under the phone's rail, depending on where the camera rests).
    const floor = await toScreen(page, SPOT_B.x, SPOT_B.y);
    expect(await page.evaluate((q) => document.elementFromPoint(q.x, q.y)?.tagName, floor), "the floor spot is on the map, not under a panel").toBe("CANVAS");
    await hit(page, testInfo, floor);
    await expect(page.getByTestId("object-actions")).toBeHidden();
    await selectPlaced(page, testInfo, url, id);
    await page.getByTestId("object-settings").click();
    await expect(page.getByTestId("object-settings-page")).toBeVisible();
    if (!isPhone(testInfo)) {
        await page.locator("body").press("Escape");
        await expect(page.getByTestId("object-settings-page")).toBeHidden();
        await expect(page.getByTestId("objects-search")).toBeVisible();
    }
});

test("ME-024 @local Each tool keeps to its own things: Areas ignores objects, Objects ignores areas", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "phone: the panel covers the map and tucking it drops the tool (ME-007), so the open tool can't stay lit");
    const url = await objectsOpen(page, testInfo);
    const id = await placedObject(page, testInfo, url);
    await pickTool(page, "AreaEditor");
    await page.getByTestId("area-new").click();
    await page.getByTestId("area-draft-next").click();
    await expect.poll(async () => (await readWam(url)).areas.length).toBe(1);
    await page.getByTestId("edit-panel-back").click();
    await expect(page.getByTestId("area-new")).toBeVisible();
    await hit(page, testInfo, await entityOnScreen(page, url, id));
    await page.waitForTimeout(500);
    await expect(rail(page, "AreaEditor")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("object-actions")).toBeHidden();
    await pickTool(page, "EntityEditor");
    const area = (await readWam(url)).areas[0];
    const inside = await toScreen(page, area.x + 8, area.y + area.height - 8);
    await hit(page, testInfo, inside);
    await page.waitForTimeout(500);
    await expect(rail(page, "EntityEditor")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("area-rename")).toBeHidden();
});

test("ME-025 @local Another player sees objects placed, moved and deleted without reload", async ({ page, browser }, testInfo) => {
    test.setTimeout(240_000);
    const url = await objectsOpen(page, testInfo);
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    const bobSees = async (eid: string) =>
        scene(bob, (s, i: string) => {
            const e = s.getGameMapFrontWrapper().getEntitiesManager().getEntities().get(i);
            return e ? { x: e.x as number, y: e.y as number } : null;
        }, eid);
    const id = await placedObject(page, testInfo, url);
    await expect.poll(() => bobSees(id), { timeout: 5000 }).not.toBeNull();
    const before = (await readWam(url)).entities[id];
    await selectPlaced(page, testInfo, url, id);
    const from = await entityOnScreen(page, url, id);
    const to = await toScreen(page, before.x + 16 + 96, before.y + 16);
    await drag(page, testInfo, from, to, 15);
    await expect.poll(async () => (await bobSees(id))?.x ?? 0, { timeout: 5000 }).toBeGreaterThan(before.x + 32);
    await page.getByTestId("object-delete").click();
    await expect.poll(() => bobSees(id), { timeout: 5000 }).toBeNull();
    await bob.context().close();
});
