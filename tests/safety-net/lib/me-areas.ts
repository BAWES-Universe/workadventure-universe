import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, isPhone } from "./game";
import { drag, module as moduleOf, playerPosition, readWam, renameArea as renameAreaOld, rail, toScreen } from "./me";

/**
 * Helpers for the Areas tool of the redesigned Map editor (edit rail, Areas panel / phone sheet, New area > drag a box
 * > Next, an area's page with rows). The old flow (New area made a 6 x 5 tile box at once) is gone.
 */

type Point = { x: number; y: number };

/** The panel on a computer; on a phone it only holds the picked area's settings. */
export const settings = (page: Page) => page.getByTestId("edit-panel");
export const propertyPage = (page: Page) => page.getByTestId("area-property-page");

/** Lights the Areas tool on the rail and waits for its "New area" button (the panel on a computer, the sheet on a phone). */
export async function pickAreas(page: Page): Promise<void> {
    const button = rail(page, "AreaEditor");
    await expect(button).toBeVisible();
    const newButton = page.getByTestId("area-new");
    if (!(await newButton.isVisible())) {
        await button.click();
        // Lit but tucked away (a phone after a picked area): one more tap brings it out.
        if (
            !(await newButton.isVisible().catch(() => false)) &&
            (await button.getAttribute("aria-pressed")) === "true"
        ) {
            await expect(newButton.or(settings(page))).toBeVisible();
        }
    }
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(newButton).toBeVisible();
}

/** The part of the map the drawing can use: clear of the pill, the rail, the panel (computer) and the bars. */
async function freeRect(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
    const boxOf = async (l: Locator) =>
        (await l.count()) > 0 && (await l.first().isVisible()) ? l.first().boundingBox() : null;
    const box = async (testId: string) => boxOf(page.getByTestId(testId));
    const canvas = (await page.locator("canvas").first().boundingBox())!;
    const pill = await box("edit-pill");
    const panel = await boxOf(settings(page));
    const sheet = await box("area-sheet");
    const bar = await box("placing-bar");
    const railBox = await page.locator("section.side-bar-container").first().boundingBox();
    let right = canvas.x + canvas.width - 100;
    if (panel) right = Math.min(right, panel.x - 12);
    if (railBox) right = Math.min(right, railBox.x - 12);
    let bottom = canvas.y + canvas.height - 12;
    if (sheet) bottom = Math.min(bottom, sheet.y - 12);
    if (bar) bottom = Math.min(bottom, bar.y - 12);
    return {
        left: canvas.x + 12,
        top: Math.max(canvas.y, pill ? pill.y + pill.height : canvas.y) + 12,
        right,
        bottom,
    };
}

/** Draws a new area's box with New area + a drag from `from` to `to` (page points) and waits for the box. */
export async function drawBox(page: Page, testInfo: TestInfo, from: Point, to: Point): Promise<void> {
    await page.getByTestId("area-new").click();
    await expect(page.getByTestId("placing-bar")).toContainText("Drag on the map to draw it");
    await drag(page, testInfo, from, to, 12);
    await expect(page.getByTestId("area-draft")).toBeVisible();
}

/**
 * The default box: in the free part of the screen, about 6 x 5 tiles at the usual zoom, and clear of the WOKA (a
 * WOKA standing inside a Stage, Audience or call area joins it, which changes the page being filled in).
 */
export async function defaultBox(
    page: Page,
    testInfo: TestInfo,
    shift = { x: 0, y: 0 }
): Promise<{ from: Point; to: Point }> {
    // The bar and sheet only show once New area is pressed or are already there: measure with the panel as it is.
    const free = await freeRect(page);
    const w = Math.min(isPhone(testInfo) ? 170 : 220, (free.right - free.left) * 0.7);
    const h = Math.min(isPhone(testInfo) ? 140 : 170, (free.bottom - free.top) * 0.5);
    const me = await playerPosition(page);
    const woka = await toScreen(page, me.x, me.y);
    const mid = { x: (free.left + free.right) / 2, y: (free.top + free.bottom) / 2 };
    const fits = (c: Point) =>
        c.x - w / 2 >= free.left && c.x + w / 2 <= free.right && c.y - h / 2 >= free.top && c.y + h / 2 <= free.bottom;
    const clear = (c: Point) => Math.abs(woka.x - c.x) > w / 2 + 40 || Math.abs(woka.y - c.y) > h / 2 + 50;
    // The middle first, then around it; the first spot that is clear of the WOKA wins (the middle if none is).
    const steps = [
        [0, 0],
        [0, -1],
        [-1, 0],
        [0, 1],
        [1, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
    ];
    let centre = mid;
    for (const [dx, dy] of steps) {
        const c = { x: mid.x + dx * (w + 40), y: mid.y + dy * (h + 40) };
        if (fits(c) && clear(c)) {
            centre = c;
            break;
        }
    }
    const cx = centre.x + shift.x;
    const cy = centre.y + shift.y;
    return { from: { x: cx - w / 2, y: cy - h / 2 }, to: { x: cx + w / 2, y: cy + h / 2 } };
}

/**
 * Areas tool open: New area, drag a box, Next. The page of the new area opens with the cursor in its name; the name
 * is typed when given, otherwise left empty (Enter keeps "Unnamed area") so the area's rows show. Returns its id.
 */
export async function newArea(
    page: Page,
    testInfo: TestInfo,
    url: string,
    name?: string,
    shift?: { x: number; y: number }
): Promise<string> {
    const { from, to } = await defaultBox(page, testInfo, shift);
    return finishArea(page, testInfo, url, from, to, name);
}

/** Like newArea, with the box drawn around a map point (world pixels), `half` pixels either way (map pixels). */
export async function newAreaAt(
    page: Page,
    testInfo: TestInfo,
    url: string,
    world: Point,
    name?: string,
    half = { x: 64, y: 48 }
): Promise<string> {
    const a = await toScreen(page, world.x - half.x, world.y - half.y);
    const b = await toScreen(page, world.x + half.x, world.y + half.y);
    return finishArea(page, testInfo, url, a, b, name);
}

async function finishArea(
    page: Page,
    testInfo: TestInfo,
    url: string,
    from: Point,
    to: Point,
    name?: string
): Promise<string> {
    const before = (await readWam(url)).areas.map((a) => a.id);
    await drawBox(page, testInfo, from, to);
    await page.getByTestId("area-draft-next").click();
    let id = "";
    await expect
        .poll(
            async () => {
                id = (await readWam(url)).areas.find((a) => !before.includes(a.id))?.id ?? "";
                return id;
            },
            { message: "new area saved to map-storage" }
        )
        .not.toBe("");
    await showAreaRows(page, name);
    if (name) await expect.poll(async () => (await readWam(url)).areas.find((a) => a.id === id)?.name).toBe(name);
    return id;
}

/**
 * A freshly drawn area opens with the cursor in its name field: types `name` (or leaves it empty) and presses Enter,
 * so the area's own rows show. Also steps back from one of its setting pages.
 */
export async function showAreaRows(page: Page, name?: string): Promise<void> {
    const nameField = page.locator("#map-editor-right input#objectName");
    const rename = page.getByTestId("area-rename");
    await expect(rename.or(propertyPage(page)).or(nameField).first()).toBeVisible();
    if (await nameField.isVisible()) {
        if (name) await nameField.fill(name);
        await nameField.press("Enter");
        await expect(rename).toBeVisible();
    }
    if (await propertyPage(page).isVisible()) {
        await page.getByTestId("edit-panel-back").click();
        await expect(propertyPage(page)).toBeHidden();
    }
    await expect(rename).toBeVisible();
}

/** Renames the picked area through its title (the pencil). */
export async function renameArea(page: Page, url: string, id: string, name: string): Promise<void> {
    await showAreaRows(page);
    await renameAreaOld(page, url, id, name);
}

/**
 * From an area's page (or one of its settings' pages) back to the Areas list: Back, which on a phone tucks the panel
 * away to the sheet with "New area".
 */
export async function backToAreaList(page: Page): Promise<void> {
    for (let i = 0; i < 3 && !(await page.getByTestId("area-new").isVisible()); i++) {
        await page.getByTestId("edit-panel-back").click();
    }
    await expect(page.getByTestId("area-new")).toBeVisible();
}

/** Back from one of an area's setting pages to the area's own rows. */
export async function backToAreaRows(page: Page): Promise<void> {
    await showAreaRows(page);
}

/**
 * From the Areas list, opens an area's settings: a row picks the area (on a phone the list is the pulled-up sheet and
 * the panel stays tucked, so Settings on the bar under the area brings its page out).
 */
export async function openAreaFromList(page: Page, testInfo: TestInfo, name?: string): Promise<void> {
    if (isPhone(testInfo) && (await page.getByTestId("area-all").isVisible()))
        await page.getByTestId("area-all").click();
    const rows = page.getByTestId("area-row");
    await (name ? rows.filter({ hasText: name }) : rows).first().click();
    if (isPhone(testInfo)) await page.getByTestId("area-actions-settings").click();
    await expect(page.getByTestId("area-rename")).toBeVisible();
}

/**
 * The local stack has no Orbit, so a room never lists extension modules. This adds the portal module ("Portal to any
 * room") to the game's own module list the way the scene does when a room's metadata names it; call it before an
 * area's page opens (the page reads the list once). @local only.
 */
export async function enablePortalModule(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const loaded = performance.getEntriesByType("resource").find((e) => e.name.includes("/src/front/"));
        const origin = loaded ? new URL(loaded.name).origin : location.origin;
        const store = await import(origin + "/src/front/Stores/GameSceneStore.ts");
        const portal = await import(origin + "/src/front/external-modules/teleport/index.ts");
        let present = false;
        store.extensionModuleStore.subscribe(
            (list: { id: string }[]) => (present = list.some((m) => m.id === portal.default.id))
        )();
        if (!present) store.extensionModuleStore.add(portal.default);
    });
}

/**
 * The local pusher runs without YOUTUBE_ENABLED, so the YouTube chip is greyed like any integration that is off.
 * Switches the game's own flag on before the apps list is opened, so the chip can be used. @local only.
 */
export async function enableYoutubeChip(page: Page): Promise<void> {
    await moduleOf(page, "/src/front/Connection/ConnectionManager.ts", (m) => {
        m.connectionManager.youtubeToolActivated = true;
    });
}

/** New area > drag a box > Next, leaving the new area's own rows showing; for tests that do not read the saved map. */
export async function drawArea(page: Page, testInfo: TestInfo, name?: string): Promise<void> {
    const { from, to } = await defaultBox(page, testInfo);
    await drawBox(page, testInfo, from, to);
    await page.getByTestId("area-draft-next").click();
    await showAreaRows(page, name);
}
