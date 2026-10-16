import type { Page } from "@playwright/test";
import { expect, isPhone, join, newPlayer, roomUrl, test, wa, wamRoom } from "../lib/game";
import {
    boxOf,
    expectInBubble,
    expectNoBubble,
    expectState,
    joinBubble,
    liveTracks,
    openDeviceList,
    position,
    setTabVisible,
    teleport,
    think,
    wokaOnScreen,
} from "../lib/av";

const AREAS = "tests/Areas/AreaFromTiledMap/map.json";

async function hold(page: Page, key: string, ms = 400) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
}

async function settled(page: Page) {
    let last = await position(page);
    await expect
        .poll(
            async () => {
                const now = await position(page);
                const same = now.x === last.x && now.y === last.y;
                last = now;
                return same;
            },
            { intervals: [500] }
        )
        .toBe(true);
    return last;
}

async function recordCamera(page: Page) {
    await wa(page, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = globalThis as any;
        g.cameraEvents = [];
        WA.camera.onCameraUpdate().subscribe((e: unknown) => g.cameraEvents.push(e));
    });
}

async function lastZoom(page: Page): Promise<number> {
    return wa(page, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events = (globalThis as any).cameraEvents as { zoom: number }[];
        return events.length ? events[events.length - 1].zoom : NaN;
    });
}

/** The Background tab keeps the camera out of energy saving while it is open, so only away mode can stop it. */
async function keepCameraAwake(page: Page, testInfo: Parameters<typeof openDeviceList>[1]) {
    const list = await openDeviceList(page, testInfo);
    await list.getByTestId("background-tab").click();
    await expect(list.getByTestId("background-preview")).toBeVisible();
}

/** Screen point of a world point, from the camera's own report (a small wheel nudge makes it report). */
async function worldToScreen(page: Page, world: { x: number; y: number }) {
    await recordCamera(page);
    const canvas = page.locator("canvas").first();
    const box = await boxOf(canvas);
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -60);
    await expect.poll(() => lastZoom(page)).not.toBeNaN();
    await page.waitForTimeout(1000);
    const view = await wa(page, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events = (globalThis as any).cameraEvents as { x: number; y: number; width: number; height: number }[];
        return events[events.length - 1];
    });
    const scale = box.width / view.width;
    return { x: box.x + (world.x - view.x) * scale, y: box.y + (world.y - view.y) * scale };
}

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, holdMs: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    for (let i = 1; i <= 15; i++) {
        const p = { x: from.x + ((to.x - from.x) * i) / 15, y: from.y + ((to.y - from.y) * i) / 15 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
        await page.waitForTimeout(50);
    }
    await page.waitForTimeout(holdMs);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("AV-094 Desktop silent zone: banner under mic/cam, devices disabled, no bubble; leaving restores", async ({
    page,
    browser,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const url = roomUrl(testInfo, AREAS);
    await join(page, url, "Alice");
    await teleport(page, 850, 400);
    const banner = page.getByRole("status").filter({ hasText: "Silent zone" });
    await expect(banner).toContainText(
        "No calls here. Your camera and microphone are off, and no one can start a conversation with you until you leave this area."
    );
    const mic = await boxOf(page.getByTestId("microphone-button"));
    expect((await boxOf(banner)).y).toBeGreaterThan(mic.y + mic.height - 2);
    await expectState(page, "microphone-button", "disabled");
    await expectState(page, "camera-button", "disabled");

    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await teleport(bob, 850, 400);
    for (let i = 0; i < 5; i++) {
        await expect(page.locator("#cameras-container").getByText("Bob", { exact: true })).toHaveCount(0);
        await page.waitForTimeout(1000);
    }

    await teleport(page, 100, 360);
    await expect(banner).toHaveCount(0);
    await expectState(page, "microphone-button", "normal");
    await expectState(page, "camera-button", "normal");
    await teleport(bob, 100, 360);
    await teleport(bob, 110, 365);
    await expectInBubble(page, "Bob");
    await bob.context().close();
});

test("AV-095 Phone silent zone banner sits above the bar, clear of the column and Express", async ({
    page,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await join(page, roomUrl(testInfo, AREAS), "Alice");
    await teleport(page, 850, 400);
    const banner = page.getByRole("status").filter({ hasText: "Silent zone" });
    await expect(banner).toContainText("No calls here.");
    const b = await boxOf(banner);
    const mic = await boxOf(page.getByTestId("microphone-button"));
    expect(b.y + b.height).toBeLessThanOrEqual(mic.y);
    for (const id of ["actions-explorer", "express-button"]) {
        const o = await boxOf(page.getByTestId(id));
        const overlaps = b.x < o.x + o.width && o.x < b.x + b.width && b.y < o.y + o.height && o.y < b.y + b.height;
        expect(overlaps, `${id} overlaps the banner`).toBe(false);
    }
    await expect(banner.locator("button")).toHaveCount(0);
});

test("AV-096 Arrow keys, WASD and ZQSD walk; Shift runs", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await player.locator("canvas").first().focus();
    const cases: [string, "x" | "y", number][] = [
        ["ArrowRight", "x", 1],
        ["ArrowLeft", "x", -1],
        ["ArrowDown", "y", 1],
        ["ArrowUp", "y", -1],
        ["d", "x", 1],
        ["a", "x", -1],
        ["s", "y", 1],
        ["w", "y", -1],
        ["z", "y", -1],
        ["q", "x", -1],
    ];
    for (const [key, axis, sign] of cases) {
        await teleport(player, 160, 160);
        const before = await settled(player);
        await hold(player, key);
        const after = await settled(player);
        expect((after[axis] - before[axis]) * sign, `${key} moves ${axis}`).toBeGreaterThan(8);
    }
    const distance = async (shift: boolean) => {
        const runs: number[] = [];
        for (let i = 0; i < 3; i++) {
            await teleport(player, 40, 160);
            const before = await settled(player);
            if (shift) await player.keyboard.down("Shift");
            await hold(player, "ArrowRight", 150);
            if (shift) await player.keyboard.up("Shift");
            runs.push((await settled(player)).x - before.x);
        }
        return runs.sort((a, b) => a - b)[1];
    };
    const walk = await distance(false);
    const run = await distance(true);
    expect(run).toBeGreaterThan(walk * 1.3);
});

test("AV-097 Right-click on the floor walks there; left-click does not", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await teleport(player, 48, 144);
    await think(player, testInfo, "here");
    const me = await wokaOnScreen(player, "here");
    const start = await settled(player);
    await player.mouse.click(me.x + 160, me.y);
    await player.waitForTimeout(1500);
    expect(await position(player)).toEqual(start);
    await player.mouse.click(me.x + 160, me.y, { button: "right" });
    await expect.poll(async () => (await position(player)).x - start.x, { timeout: 10_000 }).toBeGreaterThan(40);
});

test("AV-098 Phone: a quick tap on the floor walks there; a long press does not", async ({ player }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await teleport(player, 48, 144);
    await think(player, testInfo, "here");
    const me = await wokaOnScreen(player, "here");
    const start = await settled(player);
    await touchDrag(player, { x: me.x + 140, y: me.y }, { x: me.x + 140, y: me.y }, 700);
    await player.waitForTimeout(1500);
    const afterLong = await settled(player);
    expect(Math.abs(afterLong.x - start.x)).toBeLessThan(4);
    await player.touchscreen.tap(me.x + 140, me.y);
    await expect.poll(async () => (await position(player)).x - start.x, { timeout: 10_000 }).toBeGreaterThan(30);
});

test("AV-099 Phone: touch and drag walks with the joystick; release stops", async ({ player }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await teleport(player, 48, 144);
    const start = await settled(player);
    await touchDrag(player, { x: 214, y: 600 }, { x: 314, y: 600 }, 1500);
    const end = await settled(player);
    expect(end.x - start.x).toBeGreaterThan(20);
});

test("AV-100 Releasing a held arrow inside the Express tray does not leave the WOKA walking", async ({
    player,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await teleport(player, 40, 160);
    await player.locator("canvas").first().focus();
    await player.keyboard.down("ArrowRight");
    await player.waitForTimeout(150);
    await player.keyboard.press("Enter");
    await expect(player.getByTestId("express-tray")).toBeVisible();
    await player.keyboard.up("ArrowRight");
    await player.keyboard.press("Escape");
    await expect(player.getByTestId("express-tray")).toHaveCount(0);
    const a = await settled(player);
    await player.waitForTimeout(1500);
    expect(await position(player)).toEqual(a);
});

test("AV-101 R turns the WOKA to face the next direction", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await wa(player, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = globalThis as any;
        g.moves = [];
        WA.player.onPlayerMove((e: { direction: string }) => g.moves.push(e.direction));
    });
    await player.locator("canvas").first().focus();
    await player.keyboard.press("r");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const directions = () => wa(player, () => (globalThis as any).moves as string[]);
    await expect.poll(async () => (await directions()).length).toBeGreaterThan(0);
    const first = (await directions())[0];
    await player.keyboard.press("r");
    await expect.poll(async () => (await directions()).at(-1)).not.toBe(first);
});

test("AV-102 AV-015 A player's card opens on tap/click; Walk to walks next to them, clear of the device tab", async ({
    player,
    url,
    browser,
}, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await teleport(bob, 208, 144);
    await expectNoBubble(player);
    const target = await worldToScreen(player, await position(bob));
    if (isPhone(testInfo)) await player.touchscreen.tap(target.x, target.y);
    else await player.mouse.click(target.x, target.y);
    const card = player.getByTestId("actions-menu");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Bob");
    const walkTo = card.getByText("Walk to", { exact: true });
    await expect(walkTo).toBeVisible();
    if (isPhone(testInfo)) {
        // The ^ tab must not cover any part of a card button: Walk to, the ⋯ button and (for signed-in players)
        // View profile are each checked on a 5x3 grid across their whole area, edges included.
        const buttons = [
            ["Walk to", walkTo],
            ["⋯", card.getByTestId("wokamenu-more-button")],
            ["View profile", card.getByText("View profile", { exact: true })],
        ] as const;
        let checked = 0;
        for (const [name, button] of buttons) {
            if ((await button.count()) === 0) continue;
            const b = await boxOf(button);
            const covered = await player.evaluate(({ x, y, width, height }) => {
                const hits: string[] = [];
                for (let i = 0; i <= 4; i++) {
                    for (let j = 0; j <= 2; j++) {
                        const px = x + 1 + ((width - 2) * i) / 4;
                        const py = y + 1 + ((height - 2) * j) / 2;
                        const top = document.elementFromPoint(px, py);
                        if (!top?.closest("[data-testid=actions-menu]")) {
                            hits.push(`${Math.round(px)},${Math.round(py)} -> ${top?.className ?? "nothing"}`);
                        }
                    }
                }
                return hits;
            }, b);
            expect(covered, `${name} is on top across its whole area`).toEqual([]);
            checked++;
        }
        expect(checked, "at least Walk to and the ⋯ button were checked").toBeGreaterThanOrEqual(2);
    }
    const bobAt = await position(bob);
    if (isPhone(testInfo)) await walkTo.tap();
    else await walkTo.click();
    await expect
        .poll(
            async () => {
                const p = await position(player);
                return Math.hypot(p.x - bobAt.x, p.y - bobAt.y);
            },
            { timeout: 15_000 }
        )
        .toBeLessThan(64);
    await bob.context().close();
});

test("AV-103 A quick tap or click on your own WOKA opens your own card", async ({ player }, testInfo) => {
    await teleport(player, 112, 144);
    const me = await worldToScreen(player, await settled(player));
    if (isPhone(testInfo)) await player.touchscreen.tap(me.x, me.y);
    else await player.mouse.click(me.x, me.y);
    const card = player.getByTestId("actions-menu");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Alice");
});

test("AV-104 AV-105 Zoom buttons and the wheel zoom the map; tooltips show; one wheel jump is at most 2x", async ({
    player,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await recordCamera(player);
    const zoomIn = player.getByRole("button", { name: "Zoom In +" });
    const zoomOut = player.getByRole("button", { name: "Zoom Out -" });
    await zoomOut.click();
    await expect.poll(() => lastZoom(player)).not.toBeNaN();
    await player.waitForTimeout(800);
    const z0 = await lastZoom(player);
    await zoomIn.click();
    await expect.poll(() => lastZoom(player)).toBeGreaterThan(z0);
    await player.waitForTimeout(800);
    const z1 = await lastZoom(player);
    await zoomOut.click();
    await expect.poll(() => lastZoom(player)).toBeLessThan(z1);

    const tip = (button: typeof zoomIn) => button.locator(".explorer-tip");
    await zoomIn.hover();
    await expect(tip(zoomIn)).toHaveText("Zoom In +");
    await expect.poll(() => tip(zoomIn).evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await zoomOut.hover();
    await expect.poll(() => tip(zoomOut).evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await player.mouse.move(400, 400);
    await zoomIn.focus();
    await player.keyboard.press("Shift+Tab");
    await player.keyboard.press("Tab");
    await expect.poll(() => tip(zoomIn).evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    await player.mouse.move(300, 300);
    await player.waitForTimeout(800);
    const w0 = await lastZoom(player);
    await player.mouse.wheel(0, -300);
    await expect.poll(() => lastZoom(player)).toBeGreaterThan(w0);
    await player.waitForTimeout(800);
    const w1 = await lastZoom(player);
    await player.mouse.wheel(0, 300);
    await expect.poll(() => lastZoom(player)).toBeLessThan(w1);
    await player.waitForTimeout(800);
    const w2 = await lastZoom(player);
    await player.mouse.wheel(0, -20000);
    await player.waitForTimeout(1500);
    expect((await lastZoom(player)) / w2).toBeLessThanOrEqual(2.0001);
});

test("AV-106 Phone: pinching zooms the map", async ({ player }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await recordCamera(player);
    const cdp = await player.context().newCDPSession(player);
    const pinch = async (from: number, to: number) => {
        const cx = 214;
        const cy = 450;
        await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
                { x: cx - from, y: cy, id: 1 },
                { x: cx + from, y: cy, id: 2 },
            ],
        });
        for (let i = 1; i <= 8; i++) {
            const d = from + ((to - from) * i) / 8;
            await cdp.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [
                    { x: cx - d, y: cy, id: 1 },
                    { x: cx + d, y: cy, id: 2 },
                ],
            });
            await player.waitForTimeout(30);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await pinch(100, 60);
    await expect.poll(() => lastZoom(player)).not.toBeNaN();
    await player.waitForTimeout(800);
    const z0 = await lastZoom(player);
    await pinch(40, 140);
    await expect.poll(() => lastZoom(player)).toBeGreaterThan(z0);
    await player.waitForTimeout(800);
    const z1 = await lastZoom(player);
    await pinch(140, 40);
    await expect.poll(() => lastZoom(player)).toBeLessThan(z1);
});

test("AV-107 Scrolling out past the limit opens Look around; zooming back in near you leaves it", async ({
    page,
}, testInfo) => {
    test.slow();
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, await wamRoom(testInfo, "map"), "Alice");
    const player = page;
    const overview = player.getByTestId("map-overview-button");
    await player.mouse.move(300, 300);
    await expect
        .poll(
            async () => {
                await player.mouse.wheel(0, 100);
                return overview.getAttribute("aria-pressed");
            },
            { timeout: 60_000, intervals: [700] }
        )
        .toBe("true");
    await expect(player.getByTestId("look-around")).toBeVisible();
    await expect
        .poll(
            async () => {
                await player.mouse.wheel(0, -100);
                return overview.getAttribute("aria-pressed");
            },
            { timeout: 60_000, intervals: [700] }
        )
        .toBe("false");
});

test("AV-108 @local Desktop alone: a hidden tab goes Away with the camera off and mic on; back restores", async ({
    player,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await keepCameraAwake(player, testInfo);
    await expect.poll(() => liveTracks(player)).toEqual({ video: 1, audio: 1 });
    await setTabVisible(player, false);
    await expect(player.getByTestId("action-user")).toContainText("Away");
    await expect.poll(() => liveTracks(player)).toEqual({ video: 0, audio: 1 });
    await setTabVisible(player, true);
    await expect(player.getByTestId("action-user")).toContainText("Online");
    await expect.poll(() => liveTracks(player)).toEqual({ video: 1, audio: 1 });
});

test("AV-109 @local Phone alone: background turns camera and mic off; back restores both", async ({
    player,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await keepCameraAwake(player, testInfo);
    await expect.poll(() => liveTracks(player)).toEqual({ video: 1, audio: 1 });
    await setTabVisible(player, false);
    await expect.poll(() => liveTracks(player)).toEqual({ video: 0, audio: 0 });
    await setTabVisible(player, true);
    await expect.poll(() => liveTracks(player)).toEqual({ video: 1, audio: 1 });
});

test("AV-110 @local In a bubble a hidden tab cuts nothing", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await expect.poll(() => liveTracks(player)).toEqual({ video: 1, audio: 1 });
    await setTabVisible(player, false);
    await player.waitForTimeout(3000);
    expect(await liveTracks(player)).toEqual({ video: 1, audio: 1 });
    await expect(bob.getByTestId("Alice is muted.")).toHaveCount(0);
    await expect(player.getByTestId("action-user")).not.toContainText("Away");
    await setTabVisible(player, true);
    await bob.context().close();
});
