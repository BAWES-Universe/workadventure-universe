import type { Locator, Page, TestInfo } from "@playwright/test";
import { deflateSync } from "zlib";
import { expect, isPhone, join, wamRoom } from "./game";

const MAP_STORAGE = process.env.SAFETY_NET_MAP_STORAGE ?? "http://localhost:3000";
const MAP_STORAGE_AUTH = "Basic " + Buffer.from("john.doe:password").toString("base64");

export type Wam = {
    areas: {
        id: string;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        properties: { type: string; [k: string]: unknown }[];
    }[];
    entities: Record<
        string,
        {
            x: number;
            y: number;
            prefabRef: { id: string; collectionName: string };
            name?: string;
            properties?: { type: string; [k: string]: unknown }[];
        }
    >;
};

/** Joins a fresh editable room as Alice and returns its url. */
export async function editRoom(
    page: Page,
    testInfo: TestInfo,
    map: "empty" | "map" | "areas" | "online" = "map"
): Promise<string> {
    const url = await wamRoom(testInfo, map);
    await join(page, url, "Alice");
    return url;
}

/** The saved WAM file of a room made by wamRoom (what map-storage would serve to a newcomer). */
export async function readWam(url: string): Promise<Wam> {
    const path = url.replace(/^\/~/, "");
    const res = await fetch(MAP_STORAGE + path, { headers: { Authorization: MAP_STORAGE_AUTH } });
    if (!res.ok) throw new Error(`map-storage read failed: ${res.status}`);
    return (await res.json()) as Wam;
}

export function rail(page: Page, tool: "EntityEditor" | "AreaEditor" | "TrashEditor" | "BotEditor"): Locator {
    return page.locator(`section.side-bar-container .side-bar .tool-button button#${tool}`).first();
}

/** Tools pill > Map editor; when the bar has no room for the pill, menu > Tools > Map editor. */
export async function openTools(page: Page): Promise<void> {
    const pill = page.getByTestId("map-menu");
    if (await pill.isVisible()) await pill.click();
    else await page.getByRole("button", { name: "Open menu" }).click();
}

export async function openEditor(page: Page, testInfo: TestInfo): Promise<void> {
    void testInfo;
    await openTools(page);
    await page.getByRole("button", { name: "Map editor", exact: true }).click();
    await expect(page.getByTestId("edit-pill")).toBeVisible();
}

/** Lights a rail tool and makes sure its panel is out (phones open the editor on the bare map). */
export async function pickTool(page: Page, tool: "EntityEditor" | "AreaEditor"): Promise<void> {
    const button = rail(page, tool);
    await expect(button).toBeVisible();
    const lit = (await button.getAttribute("aria-pressed")) === "true";
    if (!(lit && (await page.getByTestId("edit-panel").isVisible()))) await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-panel")).toBeVisible();
}

/** Game state read through the dev build's modules (tests using it are @local). */
export async function scene<R, A>(page: Page, fn: (scene: any, arg: A) => R, arg?: A): Promise<Awaited<R>> {
    return page.evaluate(
        async ({ src, a }) => {
            const loaded = performance.getEntriesByType("resource").find((e) => e.name.includes("/src/front/"));
            const origin = loaded ? new URL(loaded.name).origin : location.origin;
            const { gameManager } = await import(origin + "/src/front/Phaser/Game/GameManager.ts");
            // eslint-disable-next-line no-new-func
            const f = new Function("scene", "arg", `return (${src})(scene, arg);`);
            return await f(gameManager.getCurrentGameScene(), a);
        },
        { src: fn.toString(), a: arg as A }
    ) as Promise<Awaited<R>>;
}

/** Runs fn on one of the game's own modules (the live instance, not a second copy). @local only. */
export async function module<R, A>(
    page: Page,
    path: string,
    fn: (mod: any, arg: A) => R,
    arg?: A
): Promise<Awaited<R>> {
    return page.evaluate(
        async ({ path, src, a }) => {
            const loaded = performance.getEntriesByType("resource").find((e) => e.name.includes("/src/front/"));
            const origin = loaded ? new URL(loaded.name).origin : location.origin;
            const mod = await import(origin + path);
            // eslint-disable-next-line no-new-func
            const f = new Function("mod", "arg", `return (${src})(mod, arg);`);
            return await f(mod, a);
        },
        { path, src: fn.toString(), a: arg as A }
    ) as Promise<Awaited<R>>;
}

/** Where a world point (map pixels) shows on screen, in page coordinates. */
export async function toScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
    return scene(
        page,
        (s, p: { x: number; y: number }) => {
            const cam = s.cameras.main;
            const canvas = s.game.canvas as HTMLCanvasElement;
            const r = canvas.getBoundingClientRect();
            const ratioX = r.width / s.scale.width;
            const ratioY = r.height / s.scale.height;
            return {
                x: r.left + (p.x - cam.worldView.x) * cam.zoom * ratioX,
                y: r.top + (p.y - cam.worldView.y) * cam.zoom * ratioY,
            };
        },
        { x, y }
    );
}

export async function playerPosition(page: Page): Promise<{ x: number; y: number }> {
    return scene(page, (s) => ({ x: s.CurrentPlayer.x as number, y: s.CurrentPlayer.y as number }));
}

export async function waitFrames(page: Page): Promise<void> {
    await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hooks = (window as any).e2eHooks;
        await hooks.waitForNextFrame();
        await hooks.waitForNextFrame();
    });
}

type Point = { x: number; y: number };

/** One touch gesture on its own CDP session: each frame is the list of fingers down, [] lifts them all. */
async function gesture(page: Page, frames: Point[][]): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    for (let i = 0; i < frames.length; i++) {
        const type = i === 0 ? "touchStart" : i === frames.length - 1 ? "touchEnd" : "touchMove";
        await cdp.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: frames[i].map((p, id) => ({ x: Math.round(p.x), y: Math.round(p.y), id })),
        });
        await page.waitForTimeout(16);
    }
    await cdp.detach();
}

/** A finger (phone) or the mouse (desktop) pressed at `from`, moved in steps to `to`, released. */
export async function drag(page: Page, testInfo: TestInfo, from: Point, to: Point, steps = 10): Promise<void> {
    const at = (i: number): Point => ({
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
    });
    if (isPhone(testInfo)) {
        await gesture(page, [[from], ...Array.from({ length: steps }, (_, i) => [at(i + 1)]), []]);
        return;
    }
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(at(i).x, at(i).y);
    await page.mouse.up();
}

/** Tap on a phone, click on a desktop, at a page point. */
export async function hit(page: Page, testInfo: TestInfo, p: Point): Promise<void> {
    if (isPhone(testInfo)) {
        await page.touchscreen.tap(p.x, p.y);
    } else {
        await page.mouse.move(p.x - 2, p.y);
        await page.mouse.move(p.x, p.y);
        await page.mouse.click(p.x, p.y);
    }
}

export async function camera(page: Page): Promise<{ x: number; y: number; zoom: number; width: number }> {
    return scene(page, (s) => {
        const v = s.cameras.main.worldView;
        return { x: v.x as number, y: v.y as number, zoom: s.cameras.main.zoom as number, width: v.width as number };
    });
}

/** Picks an object by name in the Objects panel (it starts placing it). */
export async function pickObject(page: Page, name: string): Promise<void> {
    await page.getByTestId("objects-search").fill(name);
    await page.getByTestId("entity-item").filter({ hasText: name }).first().click();
    await expect(page.getByTestId("placing-bar")).toBeVisible();
}

/** Places one object at a map point (desktop: one click; phone: tap, tap again) and waits for map-storage to have it. */
export async function placeAt(page: Page, testInfo: TestInfo, url: string, world: Point): Promise<string> {
    const before = Object.keys((await readWam(url)).entities);
    const p = await toScreen(page, world.x, world.y);
    if (isPhone(testInfo)) {
        await page.touchscreen.tap(p.x, p.y);
        await expect(page.getByText("Tap again to place")).toBeVisible();
        await page.touchscreen.tap(p.x, p.y);
    } else {
        await page.mouse.move(p.x - 2, p.y);
        await page.mouse.move(p.x, p.y);
        await page.mouse.click(p.x, p.y);
    }
    let id = "";
    await expect
        .poll(
            async () => {
                id = Object.keys((await readWam(url)).entities).find((k) => !before.includes(k)) ?? "";
                return id;
            },
            { message: "placed object saved to map-storage" }
        )
        .not.toBe("");
    return id;
}

/** Where an entity saved in the WAM shows on screen (its centre). */
export async function entityOnScreen(page: Page, url: string, id: string): Promise<Point> {
    const e = (await readWam(url)).entities[id];
    const size = await scene(
        page,
        (s, eid: string) => {
            const ent = s.getGameMapFrontWrapper().getEntitiesManager().getEntities().get(eid);
            return ent ? { w: ent.displayWidth as number, h: ent.displayHeight as number } : { w: 32, h: 32 };
        },
        id
    );
    return toScreen(page, e.x + size.w / 2, e.y + size.h / 2);
}

function crc32(buf: Buffer): number {
    let c: number;
    let crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** A solid-colour RGBA PNG of the given size, for upload checks. */
export function png(
    width: number,
    height: number,
    rgba: [number, number, number, number] = [200, 60, 60, 255]
): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) row.set(rgba, 1 + x * 4);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

export function pngFile(name: string, width: number, height: number, rgba?: [number, number, number, number]) {
    return { name, mimeType: "image/png", buffer: png(width, height, rgba) };
}

/** Areas tool open: New area > Next makes a 6 × 5 tile area mid-screen and opens its settings. Returns its id. */
export async function newArea(page: Page, url: string, name?: string): Promise<string> {
    const before = (await readWam(url)).areas.map((a) => a.id);
    await page.getByTestId("area-new").click();
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
    await expect(page.getByTestId("area-rename")).toBeVisible();
    if (name) await renameArea(page, url, id, name);
    return id;
}

/** The new-area box in map pixels, as the editor holds it. The drawn box is not used: on desktop it is drawn at the wrong scale (ME-032). */
type Box = { x: number; y: number; width: number; height: number };
export async function draftBox(page: Page): Promise<Box> {
    return module(page, "/src/front/Stores/EditModeStore.ts", (m) => {
        let value = undefined as unknown as Box;
        m.editAreaDraftStore.subscribe((v: Box) => (value = v))();
        return value;
    });
}

export async function newAreaAt(
    page: Page,
    testInfo: TestInfo,
    url: string,
    world: Point,
    name?: string
): Promise<string> {
    const before = (await readWam(url)).areas.map((a) => a.id);
    await page.getByTestId("area-new").click();
    const draft = page.getByTestId("area-draft");
    await expect(draft).toBeVisible();
    const box = (await draft.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const start = await draftBox(page);
    const zoom = (await camera(page)).zoom;
    const to = {
        x: from.x + (world.x - (start.x + start.width / 2)) * zoom,
        y: from.y + (world.y - (start.y + start.height / 2)) * zoom,
    };
    await drag(page, testInfo, from, to, 12);
    await expect
        .poll(
            async () => {
                const d = await draftBox(page);
                return world.x >= d.x && world.x <= d.x + d.width && world.y >= d.y && world.y <= d.y + d.height;
            },
            { message: "the new area box covers the point" }
        )
        .toBe(true);
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
    await expect(page.getByTestId("area-rename")).toBeVisible();
    if (name) await renameArea(page, url, id, name);
    return id;
}

export async function renameArea(page: Page, url: string, id: string, name: string): Promise<void> {
    await page.getByTestId("area-rename").click();
    const input = page.locator("#map-editor-right input#objectName");
    await input.fill(name);
    await input.press("Enter");
    await expect(page.getByTestId("area-rename")).toContainText(name);
    await expect.poll(async () => (await readWam(url)).areas.find((a) => a.id === id)?.name).toBe(name);
}

/** From an area's settings (or one of its setting pages) back to the area list. */
export async function backToAreaList(page: Page): Promise<void> {
    for (let i = 0; i < 3 && !(await page.getByTestId("area-new").isVisible()); i++) {
        await page.getByTestId("edit-panel-back").click();
    }
    await expect(page.getByTestId("area-new")).toBeVisible();
}

export async function areaProps(url: string, id: string): Promise<{ type: string; [k: string]: unknown }[]> {
    return (await readWam(url)).areas.find((a) => a.id === id)?.properties ?? [];
}

export async function areaCentre(page: Page, url: string, id: string): Promise<Point> {
    const a = (await readWam(url)).areas.find((x) => x.id === id)!;
    return toScreen(page, a.x + a.width / 2, a.y + a.height / 2);
}

/** Open floor in the "map" room (areas.tmj), clear of walls and furniture, both in view on a phone. */
export const SPOT_A = { x: 112, y: 320 };
export const SPOT_B = { x: 208, y: 320 };
/** Open floor right of the start tiles. */
export const SPOT_C = { x: 400, y: 304 };

/** Waits until the camera stops gliding. @local */
export async function settle(page: Page): Promise<void> {
    let last = "";
    await expect
        .poll(
            async () => {
                const c = JSON.stringify(await camera(page));
                const same = c === last;
                last = c;
                return same;
            },
            { intervals: [300], message: "camera settles" }
        )
        .toBe(true);
}

/** An entity's box on screen, from the game's own bounds of it. @local */
export async function entityBox(
    page: Page,
    id: string
): Promise<{ x: number; y: number; width: number; height: number }> {
    const b = await scene(
        page,
        (s, eid: string) => {
            const r = s.getGameMapFrontWrapper().getEntitiesManager().getEntities().get(eid).getBounds();
            return {
                left: r.left as number,
                top: r.top as number,
                right: r.right as number,
                bottom: r.bottom as number,
            };
        },
        id
    );
    const tl = await toScreen(page, b.left, b.top);
    const br = await toScreen(page, b.right, b.bottom);
    return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

/**
 * A continuous gesture played inside the page, one step per animation frame, for `ms` or until `stopTestId` shows.
 * The zoom's resistance wall is time-based, so steps sent one by one from the test (slow on a loaded machine) never
 * push through it the way a steady scroll or pinch does.
 */
export async function steadyZoom(
    page: Page,
    testInfo: TestInfo,
    centre: Point,
    direction: "out" | "in",
    ms = 4000,
    stopTestId?: string
): Promise<void> {
    await page.evaluate(
        async ({ c, out, ms, touch, stop }) => {
            const canvas = document.querySelector("canvas") as HTMLCanvasElement;
            const frame = () => new Promise((r) => requestAnimationFrame(r));
            const done = () => (stop ? !!document.querySelector(`[data-testid="${stop}"]`) : false);
            const end = performance.now() + ms;
            if (!touch) {
                while (performance.now() < end && !done()) {
                    for (let i = 0; i < 3; i++) {
                        canvas.dispatchEvent(
                            new WheelEvent("wheel", {
                                deltaY: out ? 100 : -100,
                                clientX: c.x,
                                clientY: c.y,
                                bubbles: true,
                                cancelable: true,
                            })
                        );
                    }
                    await frame();
                }
                return;
            }
            const fingers = (d: number) =>
                [c.x - d / 2, c.x + d / 2].map(
                    (x, i) =>
                        new Touch({ identifier: i + 1, target: canvas, clientX: x, clientY: c.y, pageX: x, pageY: c.y })
                );
            const send = (type: string, list: Touch[], changed: Touch[]) =>
                canvas.dispatchEvent(
                    new TouchEvent(type, {
                        touches: list,
                        targetTouches: list,
                        changedTouches: changed,
                        bubbles: true,
                        cancelable: true,
                    })
                );
            let d = out ? 300 : 60;
            send("touchstart", fingers(d), fingers(d));
            await frame();
            while (performance.now() < end && !done()) {
                for (let i = 0; i < 3; i++) {
                    d = out ? d * 0.9 : d * 1.1;
                    if (d < 40 || d > 400) {
                        send("touchend", [], fingers(d));
                        d = out ? 300 : 60;
                        send("touchstart", fingers(d), fingers(d));
                    }
                    send("touchmove", fingers(d), fingers(d));
                }
                await frame();
            }
            send("touchend", [], fingers(d));
        },
        { c: centre, out: direction === "out", ms, touch: isPhone(testInfo), stop: stopTestId }
    );
}
