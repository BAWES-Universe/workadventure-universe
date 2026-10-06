import type { Page, TestInfo } from "@playwright/test";
import { expect, isPhone, newPlayer, test, wa } from "../lib/game";
import {
    areaCentre,
    areaProps,
    backToAreaList,
    camera,
    drag,
    editRoom,
    hit,
    newArea,
    newAreaAt,
    openEditor,
    pickTool,
    playerPosition,
    readWam,
    renameArea,
    toScreen,
    SPOT_A,
    SPOT_C,
} from "../lib/me";

async function areasOpen(page: Page, testInfo: TestInfo, map: "map" | "empty" = "map"): Promise<string> {
    const url = await editRoom(page, testInfo, map);
    await openEditor(page, testInfo);
    await pickTool(page, "AreaEditor");
    return url;
}

/** Leaves the editor, steps out of the area, then into its middle (map with a script only). */
async function walkInto(page: Page, url: string, id: string): Promise<void> {
    if (await page.getByTestId("edit-pill").isVisible()) await page.getByTestId("closeMapEditorButton").click();
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    await walkOut(page, url, id);
    const a = (await readWam(url)).areas.find((x) => x.id === id)!;
    await wa(page, (p: { x: number; y: number }) => WA.player.teleport(p.x, p.y), { x: a.x + a.width / 2, y: a.y + a.height / 2 });
}

/** Puts the WOKA in the map corner farthest from the area. */
async function walkOut(page: Page, url: string, id: string): Promise<void> {
    const a = (await readWam(url)).areas.find((x) => x.id === id)!;
    const x = a.x + a.width / 2 > 160 ? 16 : 304;
    const y = a.y + a.height / 2 > 160 ? 16 : 304;
    await wa(page, (p: { x: number; y: number }) => WA.player.teleport(p.x, p.y), { x, y });
}

/** The middle of the 10 × 10 "empty" room. */
const ROOM_MIDDLE = { x: 160, y: 160 };

const settings = (page: Page) => page.getByTestId("edit-panel");
const propertyPage = (page: Page) => page.getByTestId("area-property-page");

test("ME-031 Areas panel: title, line, New area, In this room list", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const panel = settings(page);
    await expect(panel.locator(".em-title").first()).toHaveText("Areas");
    await expect(panel).toContainText(isPhone(testInfo) ? "Tap an area, or draw a new one" : "Click an area, or drag on the map to draw one");
    await expect(page.getByTestId("area-new")).toHaveText(/New area/);
    expect(await page.getByTestId("area-new").evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("gradient");
    await expect(panel).toContainText(/In this room/i);
    await expect(panel).toContainText("No areas yet");
    await newArea(page, url);
    await backToAreaList(page);
    const row = page.getByTestId("area-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Unnamed area");
    await expect(row).toContainText("6 × 5 tiles");
    await expect(panel).not.toContainText("No areas yet");
});

test("ME-032 @local New area box: corners resize, inside drag moves, Next creates it where the box was, Cancel removes", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    await page.getByTestId("area-new").click();
    const draft = page.getByTestId("area-draft");
    await expect(draft).toBeVisible();
    if (isPhone(testInfo)) await expect(settings(page)).toBeHidden();
    await expect(draft.locator(".em-size")).toHaveText("6 × 5 tiles");
    await expect(draft.locator(".em-corner")).toHaveCount(4);
    await expect(page.getByText("Drag the corners to fit. Drag outside to move around.")).toBeVisible();
    const bar = page.getByTestId("placing-bar");
    await expect(bar).toContainText("New area");
    await expect(bar).toContainText("Drag inside the box to move it");
    await expect(page.getByTestId("area-draft-cancel")).toHaveText("Cancel");
    await expect(page.getByTestId("area-draft-next")).toHaveText("Next");
    const tile = (await toScreen(page, 32, 0)).x - (await toScreen(page, 0, 0)).x;
    const se = (await draft.locator(".em-corner.em-se").boundingBox())!;
    const seC = { x: se.x + se.width / 2, y: se.y + se.height / 2 };
    await drag(page, testInfo, seC, { x: seC.x + 2 * tile, y: seC.y + tile });
    await expect.soft(draft.locator(".em-size"), "a corner dragged 2 tiles right and 1 down resizes the box by that much").toHaveText("8 × 6 tiles");
    const box0 = (await draft.boundingBox())!;
    const inside = { x: box0.x + box0.width / 2, y: box0.y + box0.height / 2 };
    await drag(page, testInfo, inside, { x: inside.x - tile, y: inside.y + tile });
    await expect.poll(async () => Math.round((await draft.boundingBox())!.x)).toBeLessThan(Math.round(box0.x - tile / 2));
    const cam0 = await camera(page);
    const moved = (await draft.boundingBox())!;
    const inBox = (p: { x: number; y: number }) => p.x >= moved.x - 20 && p.x <= moved.x + moved.width + 20 && p.y >= moved.y - 20 && p.y <= moved.y + moved.height + 20;
    let outside = await toScreen(page, SPOT_C.x, SPOT_C.y);
    if (inBox(outside)) outside = await toScreen(page, SPOT_A.x, SPOT_A.y);
    await drag(page, testInfo, outside, { x: outside.x + 120, y: outside.y + 100 });
    await expect
        .poll(async () => {
            const c = await camera(page);
            return Math.abs(c.x - cam0.x) + Math.abs(c.y - cam0.y);
        }, { message: "a drag outside the box pans" })
        .toBeGreaterThan(5);
    await page.waitForTimeout(300);
    const shown = (await draft.boundingBox())!;
    await page.getByTestId("area-draft-next").click();
    await expect.poll(async () => (await readWam(url)).areas.length).toBe(1);
    await expect(page.getByTestId("area-rename")).toBeVisible();
    const made = (await readWam(url)).areas[0];
    const topLeft = await toScreen(page, made.x, made.y);
    const bottomRight = await toScreen(page, made.x + made.width, made.y + made.height);
    const created = { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
    for (const k of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(created[k] - shown[k]), `area created where the box was drawn (${k}: box ${Math.round(shown[k])}, area ${Math.round(created[k])})`).toBeLessThan(6);
    }
    await backToAreaList(page);
    await page.getByTestId("area-new").click();
    await expect(draft).toBeVisible();
    await page.getByTestId("area-draft-cancel").click();
    await expect(draft).toBeHidden();
    await expect(bar).toBeHidden();
    expect((await readWam(url)).areas).toHaveLength(1);
});

test("ME-033 @local Drawing by dragging: desktop draws an area and opens it, a finger only pans", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    if (isPhone(testInfo)) {
        await page.getByTestId("area-new").click();
        await expect(settings(page)).toBeHidden();
        const box = (await page.getByTestId("area-draft").boundingBox())!;
        const from = { x: Math.max(20, box.x - 60), y: box.y + box.height + 60 };
        const cam0 = await camera(page);
        await drag(page, testInfo, from, { x: from.x + 120, y: from.y + 80 });
        await expect.poll(async () => (await camera(page)).x, { message: "a finger pans" }).not.toBe(cam0.x);
        await page.waitForTimeout(800);
        expect((await readWam(url)).areas, "a finger never draws").toHaveLength(0);
        await expect(page.getByTestId("area-draft")).toHaveCount(1);
        return;
    }
    const me = await playerPosition(page);
    const from = await toScreen(page, me.x - 160, me.y + 32);
    const to = await toScreen(page, me.x - 64, me.y + 112);
    await drag(page, testInfo, from, to);
    await expect.poll(async () => (await readWam(url)).areas.length).toBe(1);
    await expect(page.getByTestId("area-rename"), "the new area's settings open").toBeVisible();
    await backToAreaList(page);
    const from2 = await toScreen(page, me.x + 40, me.y + 40);
    const to2 = await toScreen(page, me.x + 141, me.y + 117);
    await page.mouse.move(from2.x, from2.y);
    await page.keyboard.down("Shift");
    await drag(page, testInfo, from2, to2);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await readWam(url)).areas.length).toBe(2);
    const snapped = (await readWam(url)).areas[1];
    for (const v of [snapped.x, snapped.y, snapped.width, snapped.height]) expect(v % 32, "Shift snaps to tiles").toBe(0);
});

test("ME-034 @local Selecting areas: from the list; desktop: on the map, overlapping ones in turn, a click on empty map deselects", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const a = await newArea(page, url, "Alpha");
    await backToAreaList(page);
    const b = await newArea(page, url, "Beta");
    await backToAreaList(page);
    await page.getByTestId("area-row").filter({ hasText: "Alpha" }).click();
    await expect(page.getByTestId("area-rename")).toContainText("Alpha");
    await page.getByTestId("edit-panel-back").click();
    await expect(page.getByTestId("area-new")).toBeVisible();
    if (isPhone(testInfo)) return;
    const A = (await readWam(url)).areas.find((x) => x.id === a)!;
    const B = (await readWam(url)).areas.find((x) => x.id === b)!;
    const ox = (Math.max(A.x, B.x) + Math.min(A.x + A.width, B.x + B.width)) / 2;
    const oy = (Math.max(A.y, B.y) + Math.min(A.y + A.height, B.y + B.height)) / 2;
    const overlap = await toScreen(page, ox, oy);
    await hit(page, testInfo, overlap);
    await expect(page.getByTestId("area-rename")).toBeVisible();
    const first = (await page.getByTestId("area-rename").innerText()).trim();
    expect(["Alpha", "Beta"]).toContain(first);
    await hit(page, testInfo, overlap);
    await expect(page.getByTestId("area-rename"), "the second click selects the other area").not.toContainText(first);
    const empty = await toScreen(page, Math.min(A.x, B.x) - 48, Math.max(A.y + A.height, B.y + B.height) + 48);
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId("area-new"), "a click on the empty map deselects").toBeVisible();
});

test("ME-035 @local Dragging a selected area moves it and saves; Ctrl+drag leaves a copy", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "phone: the Areas panel covers the map and tucking it drops the tool (ME-007), so a finger can't reach an area");
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Mover");
    const before = (await readWam(url)).areas[0];
    const from = await areaCentre(page, url, id);
    const to = await toScreen(page, before.x + before.width / 2 + 96, before.y + before.height / 2 + 64);
    await drag(page, testInfo, from, to, 15);
    await expect.poll(async () => (await readWam(url)).areas[0].x, { message: "moved area saved" }).toBeGreaterThan(before.x + 48);
    expect((await readWam(url)).areas).toHaveLength(1);
    if (!isPhone(testInfo)) {
        const moved = (await readWam(url)).areas[0];
        const f = await areaCentre(page, url, id);
        const t = await toScreen(page, moved.x + moved.width / 2 - 160, moved.y + moved.height / 2);
        await page.mouse.move(f.x, f.y);
        await page.mouse.down();
        await page.keyboard.down("Control");
        for (let i = 1; i <= 12; i++) await page.mouse.move(f.x + ((t.x - f.x) * i) / 12, f.y + ((t.y - f.y) * i) / 12);
        await page.mouse.up();
        await page.keyboard.up("Control");
        await expect.poll(async () => (await readWam(url)).areas.length, { message: "Ctrl+drag leaves a copy" }).toBe(2);
        const spots = (await readWam(url)).areas.map((a) => ({ x: a.x, y: a.y }));
        expect(spots, "one area stays where it was").toContainEqual({ x: moved.x, y: moved.y });
        expect(spots.some((a) => a.x < moved.x - 96), "the other went where it was dragged").toBe(true);
    }
});

test("ME-036 Rename: the title turns into a field, Enter saves, the line reads W × H tiles · tap to rename", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url);
    await expect(settings(page)).toContainText("6 × 5 tiles · tap to rename");
    await page.getByTestId("area-rename").click();
    const input = page.locator("#map-editor-right input#objectName");
    await expect(input).toBeFocused();
    await input.fill("Kitchen");
    await input.press("Enter");
    await expect(input).toBeHidden();
    await expect(page.getByTestId("area-rename")).toContainText("Kitchen");
    await expect.poll(async () => (await readWam(url)).areas.find((a) => a.id === id)?.name).toBe("Kitchen");
    await page.getByTestId("area-rename").click();
    await input.fill("Kitchen 2");
    await input.blur();
    await expect.poll(async () => (await readWam(url)).areas.find((a) => a.id === id)?.name, { message: "leaving the field saves" }).toBe("Kitchen 2");
});

test("ME-037 A two-line description keeps both lines", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Notes");
    const field = page.locator("#map-editor-right #objectDescription");
    await field.click();
    await field.pressSequentially("First line");
    await field.press("Shift+Enter");
    await field.pressSequentially("Second line");
    await field.blur();
    await expect
        .poll(async () => (await areaProps(url, id)).find((p) => p.type === "areaDescriptionProperties")?.description)
        .toBe("First line\nSecond line");
});

test("ME-038 Listed in Places on: the area shows under Areas in Places; off: it does not", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Listed spot");
    await page.locator("#map-editor-right input#searchable").setChecked(true);
    await expect.poll(async () => (await areaProps(url, id)).find((p) => p.type === "areaDescriptionProperties")?.searchable).toBe(true);
    const other = await (async () => {
        await backToAreaList(page);
        return newArea(page, url, "Hidden spot");
    })();
    void other;
    await page.getByTestId("closeMapEditorButton").click();
    await page.getByTestId("map-overview-button").click();
    await page.getByTestId("look-around-places-button").click();
    const places = page.getByTestId("look-around-places");
    await expect(places.locator(".area-items")).toContainText("Listed spot");
    await expect(places.locator(".area-items")).not.toContainText("Hidden spot");
});

test("ME-039 Add to this area: the plain rows, apps row and coral Delete", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    await newArea(page, url);
    const panel = settings(page);
    await expect(panel).toContainText("Add to this area");
    const titles = [
        "Video call",
        "Quiet zone",
        "Stage",
        "Audience",
        "Who can enter",
        "Open a website",
        "Open a file",
        "Play a sound",
        "Exit to a room",
        "Start point",
        "Focus the camera",
        "Highlight",
        "Show a message",
        "Jitsi call",
        "Add an app: YouTube, Google Docs…",
    ];
    const shown = (await panel.locator("button.em-row .em-t").allInnerTexts()).map((t) => t.trim());
    expect(shown).toEqual(titles);
    for (const testId of ["livekitRoomProperty", "addSilentProperty", "speakerMegaphone", "listenerMegaphone", "restrictedRightsPropertyData", "openWebsite", "openFile", "playAudio", "exitAreaProperty", "startAreaProperty", "focusable", "highlight", "addTooltipProperty", "jitsiRoomProperty"]) {
        await expect(panel.getByTestId(testId)).toBeVisible();
    }
    await expect(panel.getByTestId("personalAreaPropertyData"), "Personal desk only with an admin").toHaveCount(0);
    await expect(panel.getByTestId("matrixRoomPropertyData"), "Chat room only with Matrix").toHaveCount(0);
    const del = page.getByTestId("area-delete");
    await expect(del).toHaveText(/Delete/);
    const lastRow = await panel.locator(".em-scroll > button").last().getAttribute("data-testid");
    expect(lastRow).toBe("area-delete");
});

test("ME-040 Turned on: the setting shows with a switch, its row opens its page with Remove, the switch off removes it", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Glow");
    await page.getByTestId("highlight").click();
    const pg = propertyPage(page);
    await expect(pg).toBeVisible();
    await expect(settings(page).locator(".em-title").first()).toHaveText("Highlight");
    await expect(settings(page)).toContainText("Glow");
    await expect(pg.locator(".em-remove")).toHaveText(/Remove/);
    await page.getByTestId("edit-panel-back").click();
    await expect(pg).toBeHidden();
    await expect(settings(page)).toContainText("Turned on");
    const row = settings(page).locator(".em-row.on", { hasText: "Highlight" });
    await expect(row.locator(".em-switch")).toBeChecked();
    await row.locator(".em-row-main").click();
    await expect(pg).toBeVisible();
    await page.getByTestId("edit-panel-back").click();
    await expect.poll(async () => (await areaProps(url, id)).some((p) => p.type === "highlight")).toBe(true);
    await row.locator(".em-switch").click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await areaProps(url, id)).some((p) => p.type === "highlight"), { message: "switch off removes it" }).toBe(false);
    await page.getByTestId("highlight").click();
    await pg.locator(".em-remove").click();
    await expect(pg).toBeHidden();
    await expect.poll(async () => (await areaProps(url, id)).some((p) => p.type === "highlight"), { message: "Remove removes it" }).toBe(false);
});

test("ME-041 Video call: room name and more options, Highlight added by itself, Stage and Audience still offered", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Meeting");
    await page.getByTestId("livekitRoomProperty").click();
    const pg = propertyPage(page);
    await expect(pg.locator("#roomName")).toBeVisible();
    await pg.locator("#roomName").fill("standup");
    await pg.locator("#roomName").press("Enter");
    await page.getByTestId("livekitRoomMoreOptionsButton").click();
    await expect(page.getByTestId("startWithAudioMuted")).toBeVisible();
    await expect.poll(async () => (await areaProps(url, id)).map((p) => p.type).sort(), { message: "Highlight is added by itself" }).toEqual(expect.arrayContaining(["highlight", "livekitRoomProperty"]));
    await page.keyboard.press("Escape");
    await backToAreaRows(page);
    await expect(settings(page).getByTestId("speakerMegaphone"), "Stage stays offered").toBeVisible();
    await expect(settings(page).getByTestId("listenerMegaphone"), "Audience stays offered").toBeVisible();
});

async function backToAreaRows(page: Page): Promise<void> {
    if (await propertyPage(page).isVisible()) await page.getByTestId("edit-panel-back").click();
    await expect(page.getByTestId("area-rename")).toBeVisible();
}

test("ME-043 Quiet zone: added without a page, listed under Turned on", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Library");
    await page.getByTestId("addSilentProperty").click();
    await expect(propertyPage(page)).toBeHidden();
    await expect(settings(page).locator(".em-row.on", { hasText: "Quiet zone" })).toBeVisible();
    await expect(settings(page).getByTestId("addSilentProperty")).toHaveCount(0);
    await expect.poll(async () => (await areaProps(url, id)).some((p) => p.type === "silent")).toBe(true);
});

test("ME-044 Stage and Audience pages: stage name and chat, audience picks the stage, bad waiting link shows an error", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const stage = await newArea(page, url, "Podium");
    await page.getByTestId("speakerMegaphone").click();
    const pg = propertyPage(page);
    const name = pg.getByPlaceholder("MainStage");
    await expect(name).toBeVisible();
    await name.fill("Keynote");
    await name.press("Enter");
    await expect(pg.getByTestId("chatEnabled")).toBeVisible();
    await expect.poll(async () => String((await areaProps(url, stage)).find((p) => p.type === "speakerMegaphone")?.name)).toMatch(/^keynote$/i);
    await backToAreaList(page);
    const audience = await newArea(page, url, "Seats");
    await page.getByTestId("listenerMegaphone").click();
    const select = pg.locator("select#speakerZoneSelector");
    await expect(select).toBeVisible();
    await select.selectOption({ label: "keynote" });
    await expect.poll(async () => (await areaProps(url, audience)).find((p) => p.type === "listenerMegaphone")?.speakerZoneName).toBeTruthy();
    const link = pg.locator("#tabLink, input[type=url], input[placeholder*='http']").first();
    if (await link.count()) {
        await link.fill("not a link");
        await link.blur();
        await expect(pg.getByTestId("applicationLinkError")).toBeVisible();
    }
    await expect(pg.getByTestId("chatEnabled")).toBeVisible();
});

test("ME-045 Who can enter: write and read tags are saved", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Office");
    await page.getByTestId("restrictedRightsPropertyData").click();
    for (const [testId, tag] of [["writeTags", "staff"], ["readTags", "member"]]) {
        const input = page.getByTestId(testId);
        await input.click();
        await input.fill(tag);
        await input.press("Enter");
    }
    await expect
        .poll(async () => {
            const p = (await areaProps(url, id)).find((x) => x.type === "restrictedRightsPropertyData");
            return p ? { write: p.writeTags, read: p.readTags } : undefined;
        })
        .toEqual({ write: ["staff"], read: ["member"] });
});

test("ME-047 @local Open a website on enter opens beside the game; on action asks first; leaving closes it", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo, "empty");
    const id = await newAreaAt(page, testInfo, url, ROOM_MIDDLE, "Site");
    await page.getByTestId("openWebsite").click();
    const pg = propertyPage(page);
    await pg.locator("select#trigger").selectOption({ label: "Show immediately on enter" });
    await pg.locator("input#tabLink").fill("http://localhost:8081/tests/E2E/empty.json");
    await pg.locator("input#tabLink").press("Enter");
    for (const sel of ["#newTab", "#closable"]) await expect(pg.locator(sel)).toBeAttached();
    await expect.poll(async () => (await areaProps(url, id)).find((p) => p.type === "openWebsite")?.link).toBe("http://localhost:8081/tests/E2E/empty.json");
    await walkInto(page, url, id);
    await expect(page.locator("#cowebsites-container")).toBeVisible();
    await walkOut(page, url, id);
    await expect(page.locator("#cowebsites-container")).toBeHidden();
    await openEditor(page, testInfo);
    await pickTool(page, "AreaEditor");
    await page.getByTestId("area-row").first().click();
    await settings(page).locator(".em-row.on", { hasText: "Open a website" }).locator(".em-row-main").click();
    await pg.locator("select#trigger").selectOption({ label: "Show action toast with message" });
    await pg.locator("#triggerMessage").fill("Press to open the site");
    await pg.locator("#triggerMessage").blur();
    await expect.poll(async () => (await areaProps(url, id)).find((p) => p.type === "openWebsite")?.trigger).toBe("onaction");
    await walkInto(page, url, id);
    await expect(page.getByText("Press to open the site")).toBeVisible();
    await expect(page.locator("#cowebsites-container")).toBeHidden();
});

test("ME-048 Add an app: the chips, YouTube adds a website preset and opens its page, off integrations greyed", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Apps");
    await page.getByTestId("area-add-app").click();
    const chips = settings(page).locator(".em-apps .em-chip");
    for (const label of ["YouTube", "Klaxoon", "Google Drive", "Google Docs", "Google Sheets", "Google Slides", "Eraser", "Excalidraw", "Cards", "tldraw"]) {
        await expect(chips.filter({ hasText: label }).first(), label).toBeVisible();
    }
    await page.getByTestId("openWebsiteYoutube").click();
    await expect(propertyPage(page)).toBeVisible();
    await expect.poll(async () => (await areaProps(url, id)).find((p) => p.type === "openWebsite")?.application).toBe("youtube");
    await page.getByTestId("edit-panel-back").click();
    await page.getByTestId("area-add-app").click();
    await expect(page.getByTestId("openWebsiteKlaxoon"), "Klaxoon is off on this server: its chip is greyed").toBeDisabled();
});

test("ME-049 @local Open a file: the PDF uploads and opens beside the game on enter", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo, "empty");
    const id = await newAreaAt(page, testInfo, url, ROOM_MIDDLE, "Docs");
    await page.getByTestId("openFile").click();
    const pg = propertyPage(page);
    await pg.locator("select#trigger").selectOption({ label: "Show immediately on enter" }).catch(() => undefined);
    await pg.locator("input#upload, input[type=file]").first().setInputFiles("/home/claude/wt-carrier/tests/tests/assets/lorem-ipsum.pdf");
    await expect.poll(async () => String((await areaProps(url, id)).find((p) => p.type === "openFile")?.link ?? ""), { timeout: 20_000 }).toContain(".pdf");
    await walkInto(page, url, id);
    await expect(page.locator("#cowebsites-container")).toBeVisible();
});

test("ME-050 @local Play a sound: plays inside, stops outside", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo, "empty");
    const id = await newAreaAt(page, testInfo, url, ROOM_MIDDLE, "Music");
    await page.getByTestId("playAudio").click();
    const pg = propertyPage(page);
    await pg.locator("#audioLink").fill("http://localhost:3000/e2e/tests/assets/audio/campfire.ogg");
    await pg.locator("#audioLink").blur();
    await pg.getByTestId("advancedOption").click();
    await expect(pg.locator("#volume")).toBeAttached();
    await expect.poll(async () => String((await areaProps(url, id)).find((p) => p.type === "playAudio")?.audioLink ?? "")).toContain("campfire.ogg");
    await walkInto(page, url, id);
    const player = page.locator("audio.audio-manager-audioplayer").first();
    await expect.poll(async () => player.evaluate((a: HTMLAudioElement) => a.src)).toContain("campfire.ogg");
    await expect.poll(async () => player.evaluate((a: HTMLAudioElement) => !a.paused)).toBe(true);
    await walkOut(page, url, id);
    await expect.poll(async () => page.locator("audio.audio-manager-audioplayer").evaluateAll((all) => all.every((a) => (a as HTMLAudioElement).paused || !(a as HTMLAudioElement).src.includes("campfire")))).toBe(true);
});

test("ME-051 @local Exit to a room: pick another map and its start area; walking in takes you there", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo, "empty");
    const id = await newAreaAt(page, testInfo, url, ROOM_MIDDLE, "Door");
    await page.getByTestId("exitAreaProperty").click();
    const pg = propertyPage(page);
    const maps = pg.locator("select#exitMapSelector");
    await expect(maps).toBeVisible();
    await expect.poll(async () => (await maps.locator("option").allInnerTexts()).join(",")).toContain("start_defined");
    const option = (await maps.locator("option").allInnerTexts()).find((t) => t.includes("start_defined"))!;
    await maps.selectOption({ label: option });
    const starts = pg.locator("select#startAreaNameSelector");
    await expect.poll(async () => (await starts.locator("option").count())).toBeGreaterThan(0);
    const startName = (await starts.locator("option").allInnerTexts()).map((t) => t.trim()).find((t) => t.length > 0)!;
    await starts.selectOption({ label: startName });
    await expect.poll(async () => String((await areaProps(url, id)).find((p) => p.type === "exit")?.url ?? "")).toContain("start_defined");
    await walkInto(page, url, id);
    await expect.poll(() => page.url(), { timeout: 30_000 }).toContain("start_defined.wam");
});

test("ME-052 @local Start point: added without a page; #name in the URL puts you inside", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo, "empty");
    const id = await newAreaAt(page, testInfo, url, ROOM_MIDDLE, "Arrival");
    await page.getByTestId("startAreaProperty").click();
    await expect(propertyPage(page)).toBeHidden();
    await expect(settings(page).locator(".em-row.on", { hasText: "Start point" })).toBeVisible();
    await expect.poll(async () => (await areaProps(url, id)).some((p) => p.type === "start")).toBe(true);
    await page.getByTestId("closeMapEditorButton").click();
    await page.goto("about:blank");
    await page.goto(url + "#Arrival");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(page.getByTestId("microphone-button").or(save).first()).toBeVisible({ timeout: 60_000 });
    if (await save.isVisible()) await save.click();
    await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
    const a = (await readWam(url)).areas.find((x) => x.id === id)!;
    const pos = await wa(page, async () => WA.player.getPosition());
    expect(pos.x).toBeGreaterThanOrEqual(a.x);
    expect(pos.x).toBeLessThanOrEqual(a.x + a.width);
    expect(pos.y).toBeGreaterThanOrEqual(a.y);
    expect(pos.y).toBeLessThanOrEqual(a.y + a.height + 16);
});

test("ME-053 @local Focus, Highlight and Show a message act when you walk in", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo, "empty");
    const id = await newAreaAt(page, testInfo, url, ROOM_MIDDLE, "Spotlight");
    await page.getByTestId("focusable").click();
    await expect(propertyPage(page).locator("#zoomMarginName, input").first()).toBeVisible();
    await backToAreaRows(page);
    await page.getByTestId("highlight").click();
    await backToAreaRows(page);
    await page.getByTestId("addTooltipProperty").click();
    await propertyPage(page).locator("#contentTooltip").fill("Welcome to the spotlight");
    await propertyPage(page).locator("#contentTooltip").blur();
    await expect.poll(async () => (await areaProps(url, id)).map((p) => p.type).sort()).toEqual(expect.arrayContaining(["focusable", "highlight", "tooltipPropertyData"]));
    await page.getByTestId("closeMapEditorButton").click();
    const view0 = (await camera(page)).width;
    await walkInto(page, url, id);
    await expect(page.getByText("Welcome to the spotlight")).toBeVisible();
    await expect.poll(async () => Math.abs((await camera(page)).width - view0), { message: "the camera zooms on the area" }).toBeGreaterThan(16);
});

test("ME-055 Jitsi call: room name on its page; not offered next to a video call", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Jitsi room");
    await page.getByTestId("jitsiRoomProperty").click();
    await expect(propertyPage(page).locator("#roomName")).toBeVisible();
    await expect.poll(async () => (await areaProps(url, id)).some((p) => p.type === "jitsiRoomProperty")).toBe(true);
    await backToAreaList(page);
    await newArea(page, url, "Call room");
    await page.getByTestId("livekitRoomProperty").click();
    await backToAreaRows(page);
    await expect(settings(page).getByTestId("jitsiRoomProperty")).toHaveCount(0);
});

test("ME-057 Delete an area from its settings or with the Delete key; Undo brings it back", async ({ page }, testInfo) => {
    const url = await areasOpen(page, testInfo);
    const id = await newArea(page, url, "Temporary");
    await page.getByTestId("area-delete").click();
    await expect.poll(async () => (await readWam(url)).areas.length).toBe(0);
    const toast = page.getByTestId("edit-undo-toast");
    await expect(toast).toContainText("removed");
    await page.getByTestId("edit-undo-toast-undo").click();
    await expect.poll(async () => (await readWam(url)).areas.map((a) => a.id), { message: "Undo brings it back" }).toEqual([id]);
    if (!isPhone(testInfo)) {
        await page.getByTestId("area-row").first().click();
        await expect(page.getByTestId("area-rename")).toBeVisible();
        await page.locator("canvas").first().hover({ position: { x: 5, y: 5 } });
        await page.keyboard.press("Delete");
        await expect.poll(async () => (await readWam(url)).areas.length, { message: "Delete key removes the selected area" }).toBe(0);
    }
});

test("ME-058 Another player's Areas list follows creates, renames and deletes without reload", async ({ page, browser }, testInfo) => {
    test.setTimeout(240_000);
    const url = await areasOpen(page, testInfo);
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await openEditor(bob, testInfo);
    await pickTool(bob, "AreaEditor");
    const id = await newArea(page, url);
    await expect(bob.getByTestId("area-row")).toHaveCount(1, { timeout: 5000 });
    await renameArea(page, url, id, "Shared");
    await expect(bob.getByTestId("area-row")).toContainText("Shared", { timeout: 5000 });
    await page.getByTestId("area-delete").click();
    await expect(bob.getByTestId("area-row")).toHaveCount(0, { timeout: 5000 });
    await bob.context().close();
});
