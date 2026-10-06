import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, roomUrl, wa, withFrontModule } from "./game";

const MAP_STORAGE = process.env.SAFETY_NET_MAP_STORAGE ?? "http://localhost:3000";
const MAP_STORAGE_AUTH = "Basic " + Buffer.from("john.doe:password").toString("base64");
export const MAPS = "http://localhost:8081";
export const INPUT_PAGE = `${MAPS}/tests/CoWebsite/page_with_input.html`;

/** A fresh public room on one of the Tiled maps under maps/tests (or maps/starter). */
export function tiled(testInfo: TestInfo, map: string): string {
    return roomUrl(testInfo, map);
}

/** Holds an arrow key until `until` passes (the WOKA walks; walls stop it at the map edge). */
export async function walkUntil(page: Page, key: string, until: () => Promise<unknown>): Promise<void> {
    await page.keyboard.down(key);
    try {
        await until();
    } finally {
        await page.keyboard.up(key);
    }
}

export async function teleport(page: Page, x: number, y: number): Promise<void> {
    await wa(
        page,
        async ({ x, y }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const WA = (globalThis as any).WA;
            await WA.onInit();
            await WA.player.teleport(x, y);
        },
        { x, y }
    );
}

/** Where the WOKA stands, read from the game itself (works on maps without a script). Local stack only. */
export async function playerAt(page: Page): Promise<{ x: number; y: number }> {
    return withFrontModule(
        page,
        "src/front/Phaser/Game/GameManager.ts",
        "m => { const p = m.gameManager.getCurrentGameScene().CurrentPlayer; return { x: p.x, y: p.y }; }"
    );
}

/** The tile (column, row) the WOKA stands on. */
export async function tileOf(page: Page): Promise<string> {
    const p = await playerAt(page);
    return `${Math.floor(p.x / 32)},${Math.floor(p.y / 32)}`;
}

/** Text a map script left on its own global (callbacks record what they did there). */
export async function scriptGlobal<T>(page: Page, name: string): Promise<T | undefined> {
    return wa(page, (n: string) => (globalThis as unknown as Record<string, T | undefined>)[n], name);
}

export function popups(page: Page): Locator {
    return page.locator(".popups");
}

export function cowebsite(page: Page): Locator {
    return page.locator("#cowebsites-container");
}

export function cowebsiteFrame(page: Page): Locator {
    return page.locator('iframe[title="Cowebsite"]:visible');
}

/** Answers every request to an outside site with a small page, so links work without internet. */
export async function fakeOutside(context: BrowserContext, hosts: string[] = ["workadventu.re", "wikipedia.org"]): Promise<void> {
    for (const host of hosts) {
        await context.route(new RegExp(`^https?://([a-z0-9-]+\\.)*${host.replace(/\./g, "\\.")}/`), (route) =>
            route.fulfill({ status: 200, contentType: "text/html", body: `<html><body><h1>${host} page</h1></body></html>` })
        );
    }
}

type WamArea = {
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    properties: Record<string, unknown>[];
};

/** Adds areas to a room made by wamRoom, before anyone joins it (what the map editor would have saved). */
export async function addWamAreas(url: string, areas: WamArea[]): Promise<void> {
    const path = url.replace(/^\/~/, "");
    const res = await fetch(MAP_STORAGE + path, { headers: { Authorization: MAP_STORAGE_AUTH } });
    if (!res.ok) throw new Error(`map-storage read failed: ${res.status}`);
    const wam = (await res.json()) as { areas: unknown[] };
    wam.areas.push(...areas.map((a) => ({ visible: true, ...a })));
    const put = await fetch(MAP_STORAGE + path, {
        method: "PUT",
        headers: { Authorization: MAP_STORAGE_AUTH, "Content-Type": "application/json" },
        body: JSON.stringify(wam),
    });
    if (!put.ok) throw new Error(`map-storage write failed: ${put.status} ${await put.text()}`);
}

/** Bottom of the action bar's top edge: popups must sit above it. */
export async function barTop(page: Page): Promise<number> {
    const box = await page.getByTestId("microphone-button").boundingBox();
    expect(box).not.toBeNull();
    return box!.y;
}

/** Starts recording every tile the WOKA stands on (sampled each animation frame). Local stack only. */
export async function recordTiles(page: Page): Promise<void> {
    await withFrontModule(
        page,
        "src/front/Phaser/Game/GameManager.ts",
        `m => {
            const w = window;
            w.__orTiles = [];
            const tick = () => {
                const p = m.gameManager.getCurrentGameScene().CurrentPlayer;
                const t = Math.floor(p.x / 32) + "," + Math.floor(p.y / 32);
                if (w.__orTiles[w.__orTiles.length - 1] !== t) w.__orTiles.push(t);
                requestAnimationFrame(tick);
            };
            tick();
        }`
    );
}

/** The tiles recorded since recordTiles, in order, without repeats. */
export async function recordedTiles(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __orTiles: string[] }).__orTiles);
}

/** True when the WOKA went straight from a tile matching `from` to tile `to` (a jump, not a walk). */
export function jumped(tiles: string[], from: RegExp, to: string): boolean {
    return tiles.some((t, i) => from.test(t) && tiles[i + 1] === to);
}

/**
 * Walks with `key` until the recorder sees the jump; a loaded headless machine can skip the exit tile in one frame,
 * so it walks back with `back` and tries again (at most three times). A broken exit never jumps.
 */
export async function walkUntilJump(page: Page, key: string, back: string, from: RegExp, to: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const start = (await recordedTiles(page)).length;
        await page.keyboard.down(key);
        try {
            await expect
                .poll(async () => jumped((await recordedTiles(page)).slice(Math.max(start - 1, 0)), from, to), { timeout: 6_000 })
                .toBe(true);
            return;
        } catch {
            // fall through and walk back over the exit
        } finally {
            await page.keyboard.up(key);
        }
        const end = (await recordedTiles(page)).at(-1);
        await page.keyboard.down(back);
        await expect.poll(async () => (await recordedTiles(page)).at(-1), { timeout: 6_000 }).not.toBe(end);
        await page.keyboard.up(back);
    }
    expect(jumped(await recordedTiles(page), from, to), `no jump to ${to}: ${(await recordedTiles(page)).join(" ")}`).toBe(true);
}
