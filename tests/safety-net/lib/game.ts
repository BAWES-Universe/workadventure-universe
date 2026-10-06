import type { Browser, BrowserContext, Frame, Page, TestInfo } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

const MAP_STORAGE = process.env.SAFETY_NET_MAP_STORAGE ?? "http://localhost:3000";
const MAP_STORAGE_AUTH = "Basic " + Buffer.from("john.doe:password").toString("base64");

/**
 * A fresh editable (map-storage) room per test: a copy of one of the WAM test maps loaded by stack.sh,
 * so editor changes never leak between tests. Maps: empty (10x10), map (30x30), areas, online (31x17).
 */
export async function wamRoom(testInfo: TestInfo, map: "empty" | "map" | "areas" | "online" = "map"): Promise<string> {
    const slug = `sn-${testInfo.project.name}-${testInfo.testId}-${testInfo.retry}`
        .replace(/[^a-zA-Z0-9-]/g, "")
        .slice(0, 60);
    const destination = `/e2e/tests/maps/${slug}.wam`;
    await fetch(MAP_STORAGE + destination, { method: "DELETE", headers: { Authorization: MAP_STORAGE_AUTH } });
    const res = await fetch(MAP_STORAGE + "/copy", {
        method: "POST",
        headers: { Authorization: MAP_STORAGE_AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ source: `/e2e/tests/maps/${map}.wam`, destination }),
    });
    if (res.status !== 201) throw new Error(`map-storage copy failed: ${res.status} ${await res.text()}`);
    return `/~${destination}`;
}

/** A fresh public room per test, so tests running side by side never meet each other. */
export function roomUrl(testInfo: TestInfo, map = "tests/E2E/empty.json"): string {
    const slug = `sn-${testInfo.project.name}-${testInfo.testId}`.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 60);
    return `/_/${slug}/localhost:8081/${map}`;
}

export function isPhone(testInfo: TestInfo): boolean {
    return testInfo.project.name === "phone";
}

/** Goes through the real join flow: name, WOKA, camera and microphone, room. */
export async function join(page: Page, url: string, name: string): Promise<void> {
    await page.goto(url);
    await page.getByTestId("loginSceneNameInput").fill(name);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pick your WOKA" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Turn on your camera and microphone" })).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await inRoom(page);
}

export async function inRoom(page: Page): Promise<void> {
    await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
}

/** A second player in its own browser context, with the same device settings as the test's project. */
export async function newPlayer(browser: Browser, testInfo: TestInfo, url: string, name: string): Promise<Page> {
    const use = testInfo.project.use;
    const context: BrowserContext = await browser.newContext({
        viewport: use.viewport,
        deviceScaleFactor: use.deviceScaleFactor,
        hasTouch: use.hasTouch,
        isMobile: use.isMobile,
        userAgent: use.userAgent,
        permissions: use.permissions,
        locale: use.locale,
        baseURL: use.baseURL,
    });
    const page = await context.newPage();
    await join(page, url, name);
    return page;
}

/**
 * Runs a function inside the map's script iframe, where the scripting API (WA) lives.
 * Only maps with a script have one (tests/E2E/empty.json does).
 */
export async function wa<R, A>(page: Page, fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    let frame: Frame | undefined;
    await expect
        .poll(
            async () => {
                frame = page.frames().find((f) => f.url().includes("/local-script") || f.url() === "about:srcdoc");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return frame
                    ? frame.evaluate(() => typeof (globalThis as any).WA !== "undefined").catch(() => false)
                    : false;
            },
            { message: "map script frame with WA not found", timeout: 20_000 }
        )
        .toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (frame as Frame).evaluate(fn as any, arg as any) as Promise<R>;
}

/**
 * Runs `fn(module)` in the page with the game's own instance of a front module (local vite stack only).
 * The app's modules are served from the vite origin, so importing "/src/front/..." from the :8000 page
 * would load a second, unused copy. `modulePath` is relative to play/, e.g. "src/front/Stores/GameStore.ts".
 */
export async function withFrontModule<R>(page: Page, modulePath: string, fn: string): Promise<R> {
    return page.evaluate(
        async ({ modulePath, fn }) => {
            const entry = performance
                .getEntriesByType("resource")
                .map((e) => e.name)
                .find((n) => n.includes("/src/front/"));
            const origin = entry ? new URL(entry).origin : location.origin;
            const mod = await import(/* @vite-ignore */ `${origin}/${modulePath}`);
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            return new Function("m", `return (${fn})(m);`)(mod);
        },
        { modulePath, fn }
    );
}

/** Runs code in the game page. The front exposes no globals, so this only reads the DOM and Phaser canvas. */
export async function canvasBox(page: Page) {
    const box = await page.locator("#game canvas, canvas").first().boundingBox();
    if (!box) throw new Error("game canvas not found");
    return box;
}

/** Tap on a phone, click on a desktop. */
export async function press(page: Page, testInfo: TestInfo, target: ReturnType<Page["locator"]>): Promise<void> {
    if (isPhone(testInfo)) await target.tap();
    else await target.click();
}

/** Opens the profile menu (the name pill on desktop, the burger on a phone). */
export async function openProfileMenu(page: Page): Promise<void> {
    await page.getByTestId("action-user").click();
}

export const test = base.extend<{ url: string; player: Page }>({
    url: async ({}, use, testInfo) => {
        await use(roomUrl(testInfo));
    },
    player: async ({ page, url }, use) => {
        await join(page, url, "Alice");
        await use(page);
    },
});

export { expect };
