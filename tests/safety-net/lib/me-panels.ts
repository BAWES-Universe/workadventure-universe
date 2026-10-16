import { fileURLToPath } from "url";
import type { Page, TestInfo } from "@playwright/test";
import { expect, isPhone } from "./game";
import { newAreaAt, pickAreas } from "./me-areas";
import {
    drag,
    module,
    editRoom,
    entityOnScreen,
    hit,
    openEditor,
    pickObject,
    pickTool,
    placeAt,
    playerPosition,
    readWam,
    SPOT_A,
} from "./me";

/**
 * Helpers for the redesigned Look around (the Places sheet / panel with the X, the "You are here" pin, area frames
 * with name tags) and for the Objects / Delete panels of the Map editor.
 */

export const lookAround = (page: Page) => page.getByTestId("look-around");
/** The sheet (phone) or the panel (computer) of Look around: title, room line, X, search, Filter, Areas and Objects. */
export const places = (page: Page) => page.getByTestId("look-around-places");
/** The X of that sheet: "Close and go back to you". */
export const lookAroundClose = (page: Page) => page.getByTestId("look-around-back");
/** The "You are here" pin over your avatar. */
export const youPin = (page: Page) => lookAround(page).locator(".you-pin");

export async function openLookAround(page: Page): Promise<void> {
    await page.getByTestId("map-overview-button").click();
    await expect(lookAround(page)).toBeVisible();
    await expect(places(page)).toBeVisible();
}

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * The part of the screen where a drag reaches the map while Look around is open: clear of the hint at the top, the
 * Places sheet (phone: bottom) or panel (computer: right edge) and the zoom column.
 */
export async function freeMapRect(page: Page, testInfo: TestInfo): Promise<Rect> {
    const vp = page.viewportSize()!;
    const sheet = await places(page).boundingBox();
    if (isPhone(testInfo)) {
        return { left: 24, top: 150, right: vp.width - 80, bottom: Math.max(260, (sheet?.y ?? vp.height * 0.6) - 24) };
    }
    return {
        left: 80,
        top: 150,
        right: Math.min(vp.width - 120, (sheet?.x ?? vp.width) - 24),
        bottom: vp.height - 120,
    };
}

/** A point in that free part of the screen (fractions of its width and height). */
export async function freeMapSpot(
    page: Page,
    testInfo: TestInfo,
    fx = 0.5,
    fy = 0.5
): Promise<{ x: number; y: number }> {
    const r = await freeMapRect(page, testInfo);
    return { x: r.left + (r.right - r.left) * fx, y: r.top + (r.bottom - r.top) * fy };
}

/** Moves the map by (dx, dy) screen pixels with drags that start and end in the free part of the screen. */
export async function panBy(page: Page, testInfo: TestInfo, dx: number, dy: number): Promise<void> {
    const r = await freeMapRect(page, testInfo);
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const maxX = (r.right - r.left) * 0.8;
    const maxY = (r.bottom - r.top) * 0.8;
    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    let rx = dx;
    let ry = dy;
    for (let i = 0; i < 12 && (Math.abs(rx) > 1 || Math.abs(ry) > 1); i++) {
        const sx = clamp(rx, maxX);
        const sy = clamp(ry, maxY);
        await drag(page, testInfo, { x: cx - sx / 2, y: cy - sy / 2 }, { x: cx + sx / 2, y: cy + sy / 2 }, 12);
        rx -= sx;
        ry -= sy;
    }
}

/**
 * A room with one named, listed area around the start ("Lounge", described "Sofas and coffee") and one placed,
 * listed object (Basic Wood Table), and with `quiet` a Quiet zone on the area; editor closed again.
 */
export async function roomWithPlaces(
    page: Page,
    testInfo: TestInfo,
    opts: { quiet?: boolean } = {}
): Promise<{ url: string; area: string; object: string }> {
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
        .poll(
            async () =>
                (await readWam(url)).entities[object].properties?.find((p) => p.type === "entityDescriptionProperties")
                    ?.searchable
        )
        .toBe(true);
    await page.getByTestId("edit-panel-back").click();
    await pickAreas(page);
    const area = await newAreaAt(page, testInfo, url, await playerPosition(page), "Lounge");
    await page.locator("#map-editor-right input#searchable").setChecked(true);
    await page.locator("#map-editor-right #objectDescription").fill("Sofas and coffee");
    await page.locator("#map-editor-right #objectDescription").press("Enter");
    await expect
        .poll(
            async () =>
                (await readWam(url)).areas[0].properties.find((p) => p.type === "areaDescriptionProperties")?.searchable
        )
        .toBe(true);
    if (opts.quiet) {
        // "Quiet zone" has no page of its own: it shows under "Turned on" at once.
        await page.getByTestId("addSilentProperty").click();
        await expect
            .poll(async () => (await readWam(url)).areas[0].properties.some((p) => p.type === "silent"))
            .toBe(true);
    }
    await page.getByTestId("closeMapEditorButton").click();
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    return { url, area, object };
}

/** The category dropdown of the Objects panel (the game's own dropdown, USelect): its head button and its options. */
export const categoryHead = (page: Page) => page.getByTestId("objects-category").locator("button.u-select-head");
export const categoryOptions = (page: Page) => page.getByTestId("objects-category").getByRole("option");

/** Opens the category dropdown and picks the option at `index` (0 is "All categories"). Returns the option's label. */
export async function pickCategory(page: Page, index: number): Promise<string> {
    await categoryHead(page).click();
    const option = categoryOptions(page).nth(index);
    const label = (await option.innerText()).trim();
    await option.click();
    return label;
}

/**
 * The local stack has no Orbit, so nobody carries the "editor" tag the game reads in GameScene (userIsEditorStore).
 * The Delete tool only draws and listens to areas for admins and editors (TrashEditorTool.getAreaPreviewVisibileFromUserPermissions),
 * so a check that deletes an area with it first gives this player the tag's effect. @local
 */
export async function actAsEditor(page: Page): Promise<void> {
    await module(page, "/src/front/Stores/GameStore.ts", (m) => m.userIsEditorStore.set(true));
}

/** A small PDF that lives in every checkout of the repo (tests/tests/assets), found from this file, not from a fixed path. */
export const LOREM_PDF = fileURLToPath(new URL("../../tests/assets/lorem-ipsum.pdf", import.meta.url));
