import type { Page, TestInfo } from "@playwright/test";
import { expect, isPhone, newPlayer, test, wa } from "../lib/game";
import {
    camera,
    drag,
    editRoom,
    entityOnScreen,
    hit,
    newAreaAt,
    openEditor,
    openTools,
    pickObject,
    pickTool,
    placeAt,
    playerPosition,
    rail,
    readWam,
    scene,
    steadyZoom,
    toScreen,
    SPOT_A,
} from "../lib/me";

const lookAround = (page: Page) => page.getByTestId("look-around");

async function openLookAround(page: Page): Promise<void> {
    await page.getByTestId("map-overview-button").click();
    await expect(lookAround(page)).toBeVisible();
}

function overlapArea(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
    return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

/** A room with one named, listed area around the start and one placed object; editor closed again. */
async function roomWithPlaces(page: Page, testInfo: TestInfo): Promise<{ url: string; area: string; object: string }> {
    const url = await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    await pickTool(page, "EntityEditor");
    await pickObject(page, "Basic Wood Table");
    const object = await placeAt(page, testInfo, url, SPOT_A);
    await page.getByTestId("placing-done").click();
    await expect(page.getByTestId("placing-bar")).toBeHidden();
    await hit(page, testInfo, await entityOnScreen(page, url, object));
    await page.getByTestId("object-settings").click();
    await page.getByTestId("object-settings-page").getByTestId("searchable").click();
    await expect
        .poll(async () => (await readWam(url)).entities[object].properties?.find((p) => p.type === "entityDescriptionProperties")?.searchable)
        .toBe(true);
    await page.getByTestId("edit-panel-back").click();
    await pickTool(page, "AreaEditor");
    const area = await newAreaAt(page, testInfo, url, await playerPosition(page), "Lounge");
    await page.locator("#map-editor-right input#searchable").setChecked(true);
    await page.locator("#map-editor-right #objectDescription").fill("Sofas and coffee");
    await page.locator("#map-editor-right #objectDescription").press("Enter");
    await expect.poll(async () => (await readWam(url)).areas[0].properties.find((p) => p.type === "areaDescriptionProperties")?.searchable).toBe(true);
    await page.getByTestId("closeMapEditorButton").click();
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    return { url, area, object };
}

test("ME-072 @local Desktop: the map button opens Look around: pill, hint, You are here box, button pressed", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await editRoom(page, testInfo);
    const button = page.getByTestId("map-overview-button");
    await expect(button).toHaveAttribute("aria-label", "Look around the map");
    const zoom0 = (await camera(page).catch(() => ({ zoom: 0 }))).zoom;
    await button.click();
    const la = lookAround(page);
    await expect(la).toBeVisible();
    await expect(page.getByTestId("look-around-back")).toHaveText(/Back to me/);
    expect(await page.getByTestId("look-around-back").evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("gradient");
    await expect(la.locator(".la-eyebrow")).toHaveText(/Looking around/i);
    await expect(la.locator(".la-room")).toContainText("1 here");
    await expect(page.getByTestId("look-around-places-button")).toBeVisible();
    await expect(page.getByTestId("look-around-you-box")).toContainText("You are here");
    const hint = page.getByTestId("look-around-hint");
    await expect(hint).toContainText("Drag to look around");
    await expect(hint).toContainText("Scroll to zoom · Esc to go back");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    await expect(page.getByTestId("edit-rail")).toBeHidden();
    await expect(page.getByTestId("microphone-button")).toBeVisible();
    await expect(page.getByTestId("map-menu")).toBeVisible();
    if (zoom0) await expect.poll(async () => (await camera(page)).zoom, { message: "the camera glides out" }).toBeLessThan(zoom0);
});

test("ME-073 Phone: the map button opens Look around with the pinch hint; no + and − in the column", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await editRoom(page, testInfo);
    const column = page.getByTestId("actions-explorer");
    await expect(column.getByRole("button", { name: "Zoom In +" })).toHaveCount(0);
    await expect(column.getByRole("button", { name: "Zoom Out -" })).toHaveCount(0);
    await openLookAround(page);
    await expect(page.getByTestId("look-around-hint")).toContainText("Pinch to zoom in and out");
    await expect(page.getByTestId("look-around-back")).toBeVisible();
    const pill = (await lookAround(page).locator(".la-pill").boundingBox())!;
    expect(pill.width).toBeGreaterThan(428 - 60);
    await expect(page.getByTestId("map-overview-button")).toHaveAttribute("aria-pressed", "true");
});

test("ME-074 @local Zooming out past normal opens Look around; zooming in near you leaves it; + and − zoom", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await editRoom(page, testInfo);
    const me = await playerPosition(page);
    const vp = page.viewportSize()!;
    const onScreen = async () => {
        const p = await toScreen(page, me.x, me.y);
        return { x: Math.min(Math.max(p.x, 40), vp.width - 40), y: Math.min(Math.max(p.y, 120), vp.height - 160) };
    };
    await steadyZoom(page, testInfo, await onScreen(), "out", 20_000, "look-around");
    await expect(lookAround(page), "zooming out past normal opens Look around").toBeVisible();
    await page.waitForTimeout(1000);
    const middle = { x: vp.width / 2, y: vp.height / 2 };
    for (let i = 0; i < 6 && (await lookAround(page).isVisible()); i++) {
        const at = await onScreen();
        if (Math.hypot(at.x - middle.x, at.y - middle.y) > 40) await drag(page, testInfo, at, middle, 10);
        await steadyZoom(page, testInfo, middle, "in", 1500);
    }
    await expect(lookAround(page), "zooming back in near you leaves Look around").toBeHidden();
    if (!isPhone(testInfo)) {
        const w0 = (await camera(page)).width;
        await page.getByRole("button", { name: "Zoom Out -" }).click();
        await expect.poll(async () => (await camera(page)).width, { message: "− zooms out" }).toBeGreaterThan(w0);
        const w1 = (await camera(page)).width;
        await page.getByRole("button", { name: "Zoom In +" }).click();
        await expect.poll(async () => (await camera(page)).width, { message: "+ zooms in" }).toBeLessThan(w1);
    }
});

test("ME-075 @local Look around: drag pans and hides the hint, keys pan, a quick tap does not fling the camera", async ({ page }, testInfo) => {
    await editRoom(page, testInfo);
    await openLookAround(page);
    await page.waitForTimeout(800);
    const c0 = await camera(page);
    await drag(page, testInfo, { x: 200, y: 500 }, { x: 320, y: 420 });
    await expect.poll(async () => (await camera(page)).x).not.toBe(c0.x);
    await expect(page.getByTestId("look-around-hint")).toBeHidden();
    const c1 = await camera(page);
    await page.mouse.click(250, 450).catch(() => undefined);
    if (isPhone(testInfo)) await page.touchscreen.tap(250, 450);
    await page.waitForTimeout(600);
    const c2 = await camera(page);
    expect(Math.abs(c2.x - c1.x) + Math.abs(c2.y - c1.y), "a quick tap leaves the camera where it was").toBeLessThan(20);
    if (!isPhone(testInfo)) {
        await page.keyboard.down("ArrowRight");
        await page.waitForTimeout(500);
        await page.keyboard.up("ArrowRight");
        await expect.poll(async () => (await camera(page)).x, { message: "arrow keys pan" }).toBeGreaterThan(c2.x + 5);
    }
});

test("ME-076 @local The You tab points to you when you are off-screen and glides back", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await editRoom(page, testInfo);
    await openLookAround(page);
    await page.waitForTimeout(1000);
    const vp = page.viewportSize()!;
    const tab = page.getByTestId("look-around-you-tab");
    for (let i = 0; i < 2; i++) await drag(page, testInfo, { x: vp.width * 0.8, y: vp.height * 0.5 }, { x: vp.width * 0.1, y: vp.height * 0.3 }, 15);
    for (let i = 0; i < 4 && !(await tab.isVisible()); i++) {
        if (isPhone(testInfo)) await steadyZoom(page, testInfo, { x: vp.width / 2, y: vp.height / 2 }, "in", 800);
        else await page.getByRole("button", { name: "Zoom In +" }).click();
        await page.waitForTimeout(800);
    }
    await expect(lookAround(page)).toBeVisible();
    await expect(tab).toBeVisible();
    await expect(tab).toContainText("You");
    await expect(tab.locator("img.you-tab-woka")).toBeVisible();
    await tab.click();
    await expect(tab).toBeHidden();
    const me = await playerPosition(page);
    await expect
        .poll(async () => {
            const p = await toScreen(page, me.x, me.y);
            return p.x > 0 && p.x < vp.width && p.y > 0 && p.y < vp.height;
        }, { message: "the camera glides back to you" })
        .toBe(true);
});

test("ME-077 @local Back to me, Esc and the grey map button leave Look around at the previous zoom", async ({ page }, testInfo) => {
    await editRoom(page, testInfo);
    await page.waitForTimeout(500);
    const z0 = (await camera(page)).zoom;
    const exits: (() => Promise<void>)[] = [
        () => page.getByTestId("look-around-back").click(),
        () => page.getByTestId("map-overview-button").click(),
    ];
    if (!isPhone(testInfo)) exits.push(() => page.keyboard.press("Escape"));
    for (const leave of exits) {
        await openLookAround(page);
        await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(z0);
        await leave();
        await expect(lookAround(page)).toBeHidden();
        await expect.poll(async () => Math.abs((await camera(page)).zoom - z0), { message: "back at the previous zoom" }).toBeLessThan(0.01);
    }
});

test("ME-078 @local Look around: a place with people has a label with its name and count; tapping it opens its card", async ({ page }, testInfo) => {
    await roomWithPlaces(page, testInfo);
    await openLookAround(page);
    const label = lookAround(page).locator(".area-label", { hasText: "Lounge" });
    await expect(label).toBeVisible();
    await expect(label).toContainText("1 person");
    await label.click({ force: true });
    await expect(page.getByTestId("look-around-place-card")).toContainText("Lounge");
});

test("ME-079 @local Places: search, All / Areas / Objects chips, filters, rows, no People list, X closes", async ({ page }, testInfo) => {
    await roomWithPlaces(page, testInfo);
    await openLookAround(page);
    await page.getByTestId("look-around-places-button").click();
    const places = page.getByTestId("look-around-places");
    await expect(places).toBeVisible();
    await expect(places.locator(".places-ttl")).toHaveText("Places");
    await expect(places.locator(".places-sub")).toHaveText("Tap one to fly there");
    await expect(page.getByTestId("look-around-search")).toHaveAttribute("placeholder", "Places and objects");
    const chips = places.locator(".places-chips .chip");
    await expect(chips.nth(0)).toHaveText("All");
    await expect(chips.nth(1)).toHaveText(/Areas\s*1/);
    await expect(chips.nth(2)).toHaveText(/Objects\s*1/);
    await expect(places.locator(".area-items .place-row")).toHaveCount(1);
    await expect(places.locator(".area-items")).toContainText("Lounge");
    await expect(places.locator(".entity-items .place-row")).toHaveCount(1);
    await expect(places).not.toContainText("People");
    await chips.nth(1).click();
    await expect(places.locator(".entity-items")).toHaveCount(0);
    await chips.nth(2).click();
    await expect(places.locator(".area-items")).toHaveCount(0);
    await chips.nth(0).click();
    await page.getByTestId("look-around-search").fill("loun");
    await expect(places.locator(".area-items .place-row")).toHaveCount(1);
    await expect(places.locator(".entity-items .place-row")).toHaveCount(0);
    await page.getByTestId("look-around-search").fill("");
    await places.getByRole("button", { name: "Filters" }).click();
    const filters = places.locator(".places-filters .chip");
    await expect(filters.first()).toBeVisible();
    expect(await filters.count()).toBeGreaterThanOrEqual(13);
    await filters.first().click();
    await expect(filters.first()).toHaveClass(/on/);
    await page.getByTestId("closeVisitCardButton").click();
    await expect(places).toBeHidden();
});

test("ME-080 @local Place card: a row flies there and opens its card; Walk there walks you there", async ({ page }, testInfo) => {
    const { url, object } = await roomWithPlaces(page, testInfo);
    await openLookAround(page);
    await page.getByTestId("look-around-places-button").click();
    const places = page.getByTestId("look-around-places");
    await places.locator(".entity-items .place-row").first().click();
    const card = page.getByTestId("look-around-place-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".place-card-name")).toHaveText("Basic Wood Table");
    if (isPhone(testInfo)) await expect(places).toBeHidden();
    await expect(card.locator(".place-card-walk")).toHaveText(/Walk there/);
    await expect(card.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(card.getByRole("button", { name: /back/i })).toHaveCount(0);
    const start = await playerPosition(page).catch(() => undefined);
    await card.locator(".place-card-walk").click();
    const e = (await readWam(url)).entities[object];
    if (start) {
        await expect
            .poll(async () => Math.hypot((await playerPosition(page)).x - (e.x + 32), (await playerPosition(page)).y - (e.y + 32)), { message: "you walk to the object", timeout: 20_000 })
            .toBeLessThan(80);
    }
    if (!isPhone(testInfo)) {
        await openLookAround(page);
        await page.getByTestId("look-around-places-button").click();
        await places.locator(".area-items .place-row").first().click();
        await expect(card.locator(".place-card-name")).toHaveText("Lounge");
        await expect(card).toContainText("Sofas and coffee");
        await card.getByRole("button", { name: "Close" }).click();
        await expect(card).toBeHidden();
    }
});

test("ME-081 Places: Edit this room leaves Look around and opens the editor on Objects", async ({ page }, testInfo) => {
    await editRoom(page, testInfo);
    await openLookAround(page);
    await page.getByTestId("look-around-places-button").click();
    await page.getByTestId("look-around-edit").click();
    await expect(lookAround(page)).toBeHidden();
    await expect(page.getByTestId("edit-pill")).toBeVisible();
    await expect(rail(page, "EntityEditor")).toHaveAttribute("aria-pressed", "true");
});

test("ME-082 @local Look around: tapping another player's WOKA opens their card", async ({ page, browser }, testInfo) => {
    test.setTimeout(240_000);
    const url = await editRoom(page, testInfo, "empty");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await wa(bob, () => WA.player.teleport(240, 240));
    await expect.poll(async () => (await scenePlayers(page)).find((p) => p.name === "Bob")?.x ?? 0).toBeGreaterThan(200);
    await openLookAround(page);
    await page.waitForTimeout(800);
    const bobOnScreen = await toScreen(page, 240, 232);
    await hit(page, testInfo, bobOnScreen);
    const card = page.getByTestId("actions-menu");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Bob");
    await bob.context().close();
});

async function scenePlayers(page: Page): Promise<{ name: string; x: number; y: number }[]> {
    return scene(page, (s) =>
        [...s.MapPlayersByKey.values()].map((p: { playerName: string; x: number; y: number }) => ({ name: p.playerName, x: p.x, y: p.y }))
    );
}

test("ME-083 Look around in a call: the pill and hint never cover the video tiles", async ({ page, browser }, testInfo) => {
    test.setTimeout(240_000);
    const url = await editRoom(page, testInfo, "empty");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    const tiles = page.locator("#cameras-container .camera-box:visible");
    await expect.poll(async () => tiles.count(), { message: "Alice sees the bubble's video tiles", timeout: 30_000 }).toBeGreaterThan(1);
    await openLookAround(page);
    const covers = [(await lookAround(page).locator(".la-pill").boundingBox())!];
    const hint = await page.getByTestId("look-around-hint").boundingBox();
    if (hint) covers.push(hint);
    for (let i = 0; i < (await tiles.count()); i++) {
        const t = (await tiles.nth(i).boundingBox())!;
        for (const c of covers) expect(overlapArea(c, t), `Look around covers video tile ${i}`).toBe(0);
    }
    await bob.context().close();
});

test("ME-084 A fresh browser shows no Look around note beside the map button on load", async ({ page }, testInfo) => {
    await editRoom(page, testInfo);
    expect(await page.evaluate(() => localStorage.getItem("lookAroundNoteSeen")), "a fresh browser").toBeNull();
    await expect(page.getByTestId("map-overview-button")).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("look-around-note")).toBeHidden();
});

test("ME-085 Tools menu > Look around the map opens Look around and closes the menu", async ({ page }, testInfo) => {
    await editRoom(page, testInfo);
    await openTools(page);
    await page.getByRole("button", { name: "Look around the map", exact: true }).last().click();
    await expect(lookAround(page)).toBeVisible();
    await expect(page.getByTestId("map-sub-menu")).toBeHidden();
    await expect(page.getByTestId("profile-menu")).toBeHidden();
    await expect(page.getByTestId("edit-pill")).toBeHidden();
});
