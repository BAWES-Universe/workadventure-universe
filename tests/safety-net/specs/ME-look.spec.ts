import type { Page } from "@playwright/test";
import { expect, isPhone, newPlayer, test, wa } from "../lib/game";
import {
    camera,
    drag,
    editRoom,
    hit,
    openTools,
    playerPosition,
    rail,
    readWam,
    scene,
    settle,
    steadyZoom,
    toScreen,
} from "../lib/me";
import {
    freeMapSpot,
    lookAround,
    lookAroundClose,
    openLookAround,
    panBy,
    places,
    roomWithPlaces,
    youPin,
} from "../lib/me-panels";

function overlapArea(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
): number {
    return (
        Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
    );
}

test("ME-072 @local Desktop: the map button opens Look around: Places panel with the X, hint, You are here pin, button pressed", async ({
    page,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await editRoom(page, testInfo);
    const button = page.getByTestId("map-overview-button");
    await expect(button).toHaveAttribute("aria-label", "Look around the map");
    const zoom0 = (await camera(page).catch(() => ({ zoom: 0 }))).zoom;
    await button.click();
    const la = lookAround(page);
    await expect(la).toBeVisible();
    // The panel on the right edge: title, "<room> · Just you here", and the X that goes back to you.
    await expect(places(page)).toBeVisible();
    await expect(places(page).locator(".places-ttl")).toHaveText("Look around");
    await expect(page.getByTestId("look-around-room-line")).toContainText("Just you here");
    await expect(lookAroundClose(page)).toHaveAttribute("aria-label", "Close and go back to you");
    await expect(page.getByTestId("look-around-search")).toBeVisible();
    await expect(youPin(page)).toContainText("You are here");
    const hint = page.getByTestId("look-around-hint");
    await expect(hint).toContainText("Drag to look around");
    await expect(hint).toContainText("Scroll to zoom · Esc to go back");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    await expect(page.getByTestId("edit-rail")).toBeHidden();
    await expect(page.getByTestId("microphone-button")).toBeVisible();
    await expect(page.getByTestId("map-menu")).toBeVisible();
    if (zoom0)
        await expect
            .poll(async () => (await camera(page)).zoom, { message: "the camera glides out" })
            .toBeLessThan(zoom0);
});

test("ME-073 Phone: the map button opens Look around with the pinch hint and the bottom sheet; no + and − in the column", async ({
    page,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await editRoom(page, testInfo);
    const column = page.getByTestId("actions-explorer");
    await expect(column.getByRole("button", { name: "Zoom In +" })).toHaveCount(0);
    await expect(column.getByRole("button", { name: "Zoom Out -" })).toHaveCount(0);
    await openLookAround(page);
    await expect(page.getByTestId("look-around-hint")).toContainText("Pinch to zoom in and out");
    await expect(lookAroundClose(page)).toBeVisible();
    await expect(page.getByTestId("look-around-grip")).toBeVisible();
    const sheet = (await places(page).boundingBox())!;
    expect(sheet.width, "the sheet spans the full width").toBeGreaterThan(428 - 4);
    expect(sheet.y + sheet.height, "the sheet sits on the bottom edge").toBeGreaterThan(926 - 4);
    await expect(page.getByTestId("map-overview-button")).toHaveAttribute("aria-pressed", "true");
});

test("ME-074 @local Zooming out past normal opens Look around; zooming in near you leaves it; + and − zoom", async ({
    page,
}, testInfo) => {
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
    // Zooming back in only leaves when the camera is near you. A small map cannot be panned up or down (the camera
    // keeps it centred), so: bring you to the middle sideways as far as the map allows, then pinch / scroll in on you.
    const middle = { x: vp.width / 2, y: vp.height / 2 };
    for (let i = 0; i < 6 && (await lookAround(page).isVisible()); i++) {
        const at = await toScreen(page, me.x, me.y);
        if (Math.abs(at.x - middle.x) > 40) await panBy(page, testInfo, middle.x - at.x, 0);
        const on = await toScreen(page, me.x, me.y);
        await steadyZoom(
            page,
            testInfo,
            { x: Math.min(Math.max(on.x, 40), vp.width - 40), y: Math.min(Math.max(on.y, 40), vp.height - 40) },
            "in",
            1500
        );
    }
    await expect(lookAround(page), "zooming back in near you leaves Look around").toBeHidden();
    if (!isPhone(testInfo)) {
        await settle(page);
        const w0 = (await camera(page)).width;
        await page.getByRole("button", { name: "Zoom Out -" }).click();
        await expect.poll(async () => (await camera(page)).width, { message: "− zooms out" }).toBeGreaterThan(w0);
        await settle(page);
        const w1 = (await camera(page)).width;
        await page.getByRole("button", { name: "Zoom In +" }).click();
        await expect.poll(async () => (await camera(page)).width, { message: "+ zooms in" }).toBeLessThan(w1);
    }
});

test("ME-075 @local Look around: drag pans and hides the hint, keys pan, a quick tap does not fling the camera", async ({
    page,
}, testInfo) => {
    await editRoom(page, testInfo);
    await openLookAround(page);
    await page.waitForTimeout(800);
    await expect(page.getByTestId("look-around-hint")).toBeVisible();
    const c0 = await camera(page);
    // On the part of the map the sheet or panel does not cover.
    // Dragging right moves the camera left, so the arrow key below still has room to pan right.
    const from = await freeMapSpot(page, testInfo, 0.3, 0.4);
    const to = await freeMapSpot(page, testInfo, 0.7, 0.6);
    await drag(page, testInfo, from, to);
    await expect.poll(async () => (await camera(page)).x).not.toBe(c0.x);
    await expect(page.getByTestId("look-around-hint")).toBeHidden();
    await page.waitForTimeout(600);
    const c1 = await camera(page);
    const tap = await freeMapSpot(page, testInfo, 0.5, 0.5);
    await hit(page, testInfo, tap);
    await page.waitForTimeout(600);
    const c2 = await camera(page);
    expect(Math.abs(c2.x - c1.x) + Math.abs(c2.y - c1.y), "a quick tap leaves the camera where it was").toBeLessThan(
        20
    );
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
    // The map keeps itself inside the camera, so a small map cannot be pushed far enough to lose you: pan away as
    // far as it goes, then zoom in on the far side until you are off-screen (the drags stay clear of the sheet or
    // panel). Zooming in right next to you would leave Look around instead.
    const me = await playerPosition(page);
    for (let i = 0; i < 6 && !(await tab.isVisible()); i++) {
        await panBy(page, testInfo, -400, 0);
        const spot = await freeMapSpot(page, testInfo, 0.95, 0.5);
        await steadyZoom(page, testInfo, spot, "in", 700, "look-around-you-tab");
        await page.waitForTimeout(500);
    }
    await expect(lookAround(page)).toBeVisible();
    await expect(tab).toBeVisible();
    await expect(tab).toContainText("You");
    await expect(tab.locator("img.you-tab-woka")).toBeVisible();
    await tab.click();
    await expect(tab).toBeHidden();
    await expect
        .poll(
            async () => {
                const p = await toScreen(page, me.x, me.y);
                return p.x > 0 && p.x < vp.width && p.y > 0 && p.y < vp.height;
            },
            { message: "the camera glides back to you" }
        )
        .toBe(true);
});

test("ME-077 @local The X (back to you), Esc and the grey map button leave Look around at the previous zoom", async ({
    page,
}, testInfo) => {
    await editRoom(page, testInfo);
    await page.waitForTimeout(500);
    const z0 = (await camera(page)).zoom;
    // The sheet covers the map button on a phone (it goes over the bar, like the chat), so there the way out is the X
    // or pulling the sheet down from its lowest height; on a computer the grey map button and Esc.
    const exits: (() => Promise<void>)[] = [() => lookAroundClose(page).click()];
    if (isPhone(testInfo)) {
        exits.push(async () => {
            // Half height > lowest height > gone: the grip moves each time, so it is measured each time.
            for (let i = 0; i < 2 && (await lookAround(page).isVisible()); i++) {
                const grip = (await page.getByTestId("look-around-grip").boundingBox())!;
                const at = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
                await drag(page, testInfo, at, { x: at.x, y: at.y + 120 }, 8);
                await page.waitForTimeout(500);
            }
        });
    } else {
        exits.push(
            () => page.getByTestId("map-overview-button").click(),
            () => page.keyboard.press("Escape")
        );
    }
    for (const leave of exits) {
        await openLookAround(page);
        await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(z0);
        await leave();
        await expect(lookAround(page)).toBeHidden();
        await expect
            .poll(async () => Math.abs((await camera(page)).zoom - z0), { message: "back at the previous zoom" })
            .toBeLessThan(0.01);
    }
});

test("ME-078 @local Look around: a listed place has a framed name tag, with the people inside counted; tapping it opens its card", async ({
    page,
}, testInfo) => {
    await roomWithPlaces(page, testInfo);
    await openLookAround(page);
    const frame = lookAround(page).getByTestId("look-around-area-frame").filter({ hasText: "Lounge" });
    await expect(frame).toBeVisible();
    const tag = frame.locator(".la-tag");
    await expect(tag).toContainText("Lounge");
    await expect(tag).toContainText("1 person");
    // The listed object has its own tag too.
    await expect(lookAround(page).locator(".la-tag-obj", { hasText: "Basic Wood Table" })).toBeVisible();
    await tag.click({ force: true });
    await expect(page.getByTestId("look-around-place-card")).toContainText("Lounge");
});

test("ME-079 @local Places: search, Areas and Objects groups with counts, Filter, rows, no People list, X closes", async ({
    page,
}, testInfo) => {
    await roomWithPlaces(page, testInfo, { quiet: true });
    await openLookAround(page);
    // Places is the sheet / panel itself: it opens with Look around, there is no search circle to press.
    const panel = places(page);
    await expect(panel.locator(".places-ttl")).toHaveText("Look around");
    await expect(page.getByTestId("look-around-search")).toHaveAttribute("placeholder", "Places and objects");
    const areasHead = panel.locator(".group-head.areas");
    const objectsHead = panel.locator(".group-head.entities");
    await expect(areasHead).toContainText("Areas");
    await expect(areasHead.locator("b")).toHaveText("1");
    await expect(objectsHead).toContainText("Objects");
    await expect(objectsHead.locator("b")).toHaveText("1");
    const areaRows = panel.locator(".area-items .place-row");
    const objectRows = panel.locator(".entity-items .place-row");
    await expect(areaRows).toHaveCount(1);
    await expect(areaRows.first().locator(".place-name")).toHaveText("Lounge");
    // The row says what the place does and who is inside ("property · people"). Soft, so the rest still runs.
    await expect
        .soft(areaRows.first().locator(".place-sub"), "the row shows the people inside as soon as the panel opens")
        .toHaveText("Quiet zone · 1 person", { timeout: 5000 });
    await expect(objectRows).toHaveCount(1);
    await expect(objectRows.first().locator(".place-name")).toHaveText("Basic Wood Table");
    await expect(panel).not.toContainText("People");
    // Each group folds away on its own (what the old All / Areas / Objects chips did: show one kind only).
    await objectsHead.click();
    await expect(objectRows.first()).toBeHidden();
    await expect(areaRows.first()).toBeVisible();
    await objectsHead.click();
    await expect(objectRows.first()).toBeVisible();
    await areasHead.click();
    await expect(areaRows.first()).toBeHidden();
    await expect(objectRows.first()).toBeVisible();
    await areasHead.click();
    await expect(areaRows.first()).toBeVisible();
    // Search narrows both lists.
    await page.getByTestId("look-around-search").fill("loun");
    await expect(areaRows).toHaveCount(1);
    await expect(objectRows).toHaveCount(0);
    await expect(areasHead.locator("b")).toHaveText("1");
    await expect(objectsHead.locator("b")).toHaveText("0");
    await page.getByTestId("look-around-search").fill("");
    await expect(objectRows).toHaveCount(1);
    // Filter lists the settings the places of this room use, and picking one keeps only the places that have it.
    await page.getByTestId("look-around-filter").click();
    const filters = panel.locator(".places-filters .chip");
    await expect(filters).toHaveCount(1);
    await expect(filters.first()).toHaveText("Quiet zone");
    await filters.first().click();
    await expect(filters.first()).toHaveClass(/on/);
    await expect(page.getByTestId("look-around-filter")).toContainText("1");
    await expect(areaRows).toHaveCount(1);
    await expect(objectRows).toHaveCount(0);
    await filters.first().click();
    await expect(objectRows).toHaveCount(1);
    // The X closes Look around.
    await lookAroundClose(page).click();
    await expect(lookAround(page)).toBeHidden();
});

test("ME-080 @local Place card: a row flies there and opens its card; Walk there walks you there", async ({
    page,
}, testInfo) => {
    const { url, object } = await roomWithPlaces(page, testInfo);
    await openLookAround(page);
    const panel = places(page);
    await panel.locator(".entity-items .place-row").first().click();
    const card = page.getByTestId("look-around-place-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".place-card-name")).toHaveText("Basic Wood Table");
    if (isPhone(testInfo)) await expect(panel).toBeHidden();
    await expect(card.locator(".place-card-walk")).toHaveText(/Walk there/);
    await expect(card.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(card.getByRole("button", { name: /back/i })).toHaveCount(0);
    const start = await playerPosition(page).catch(() => undefined);
    await card.locator(".place-card-walk").click();
    const e = (await readWam(url)).entities[object];
    if (start) {
        await expect
            .poll(
                async () =>
                    Math.hypot(
                        (await playerPosition(page)).x - (e.x + 32),
                        (await playerPosition(page)).y - (e.y + 32)
                    ),
                { message: "you walk to the object", timeout: 20_000 }
            )
            .toBeLessThan(80);
    }
    if (!isPhone(testInfo)) {
        await openLookAround(page);
        await panel.locator(".area-items .place-row").first().click();
        await expect(card.locator(".place-card-name")).toHaveText("Lounge");
        await expect(card).toContainText("Sofas and coffee");
        await card.getByRole("button", { name: "Close" }).click();
        await expect(card).toBeHidden();
    }
});

test("ME-081 Places: Edit this room leaves Look around and opens the editor on Objects", async ({ page }, testInfo) => {
    await editRoom(page, testInfo);
    await openLookAround(page);
    await page.getByTestId("look-around-edit").click();
    await expect(lookAround(page)).toBeHidden();
    await expect(page.getByTestId("edit-pill")).toBeVisible();
    await expect(rail(page, "EntityEditor")).toHaveAttribute("aria-pressed", "true");
});

test("ME-082 @local Look around: tapping another player's WOKA opens their card", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    const url = await editRoom(page, testInfo, "empty");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await wa(bob, () => WA.player.teleport(240, 240));
    await expect
        .poll(async () => (await scenePlayers(page)).find((p) => p.name === "Bob")?.x ?? 0)
        .toBeGreaterThan(200);
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
        [...s.MapPlayersByKey.values()].map((p: { playerName: string; x: number; y: number }) => ({
            name: p.playerName,
            x: p.x,
            y: p.y,
        }))
    );
}

test("ME-083 Look around in a call: the pill and hint never cover the video tiles", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    const url = await editRoom(page, testInfo, "empty");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    const tiles = page.locator("#cameras-container .camera-box:visible");
    await expect
        .poll(async () => tiles.count(), { message: "Alice sees the bubble's video tiles", timeout: 30_000 })
        .toBeGreaterThan(1);
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
