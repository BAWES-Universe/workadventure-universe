import type { Browser, BrowserContext, CDPSession, Locator, Page, TestInfo } from "@playwright/test";
import { expect, join, newPlayer, wa, withFrontModule } from "./game";

/** Spots on tests/E2E/empty.json (10x10, spawn at tile 0,4). Next-to-each-other spots form a bubble. */
export const SPOT_A = { x: 160, y: 160 };
export const SPOT_B = { x: 192, y: 160 };
/** The corner away from the spawn, out of reach of anyone standing on it. */
export const CORNER = { x: 288, y: 288 };
/** Off the map, the spot the game's own e2e uses to end a bubble. */
export const FAR = { x: 20 * 32, y: 20 * 32 };

/** Alice joins (used by tests that skip one viewport first, so the skipped run never joins). */
export async function alice(page: Page, url: string): Promise<Page> {
    await join(page, url, "Alice");
    return page;
}

export async function teleport(page: Page, spot: { x: number; y: number }): Promise<void> {
    await wa(
        page,
        async ({ x, y }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (globalThis as any).WA.player.teleport(x, y);
        },
        spot
    );
}

export async function position(page: Page): Promise<{ x: number; y: number }> {
    return wa(page, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const WA = (globalThis as any).WA;
        await WA.onInit();
        const p = await WA.player.getPosition();
        return { x: p.x as number, y: p.y as number };
    });
}

export function chat(page: Page) {
    return page.getByTestId("chat");
}

/** Opens the chat from the bar's chat button. */
export async function openChat(page: Page): Promise<void> {
    await page.getByTestId("chat-btn").click();
    await expect(chat(page)).toBeVisible();
    await chatSettled(page);
}

/** Waits until the chat panel has stopped sliding in (it flies in over 200 ms), so a mouse drag starts on its handle. */
export async function chatSettled(page: Page): Promise<void> {
    let last = "";
    await expect
        .poll(async () => {
            const now = JSON.stringify(await chat(page).boundingBox());
            const same = now === last;
            last = now;
            return same;
        })
        .toBe(true);
}

/** The chat's close: the bar's X on a desktop, the chat's own X when the bar is hidden (phone sheet, narrow). */
export async function closeChat(page: Page): Promise<void> {
    await page.getByTestId("closeChatButton").locator("visible=true").first().click();
    await expect(chat(page)).toBeHidden();
}

/**
 * Alice (already in the room) steps into the corner, then Bob joins on the spawn: no bubble yet.
 */
export async function bobApart(
    browser: Browser,
    testInfo: TestInfo,
    alice: Page,
    url: string,
    name = "Bob"
): Promise<Page> {
    await teleport(alice, CORNER);
    return newPlayer(browser, testInfo, url, name);
}

/** Puts both next to each other so a bubble forms. */
export async function meet(alice: Page, bob: Page): Promise<void> {
    await teleport(alice, SPOT_A);
    await teleport(bob, SPOT_B);
}

/** The bubble's proximity thread is open on this page (title "Proximity Chat" with a field to type in). */
export async function expectProximityThread(page: Page): Promise<void> {
    await expect(page.getByTestId("roomName")).toHaveText("Proximity Chat", { timeout: 30_000 });
    await expect(page.getByTestId("messageInput")).toBeVisible();
}

/**
 * Alice and Bob in one bubble, each with the proximity thread open. Alice opens her chat before the bubble forms,
 * so it stays open (on the list) when the bubble ends: the game puts the chat back as it was before the bubble.
 */
export async function inBubble(
    browser: Browser,
    testInfo: TestInfo,
    alice: Page,
    url: string,
    name = "Bob"
): Promise<Page> {
    const bob = await bobApart(browser, testInfo, alice, url, name);
    await openChat(alice);
    await meet(alice, bob);
    for (const page of [alice, bob]) {
        await openProximityThread(page);
    }
    return bob;
}

/** Opens the ended proximity chat with that title from the list (the chat goes back to the list when a bubble ends). */
export async function openEndedRow(page: Page, title: string): Promise<void> {
    if (!(await chat(page).isVisible())) await openChat(page);
    if (await page.getByTestId("chatBackward").isVisible()) await backToList(page);
    const row = page
        .getByTestId("proximitySessionRow")
        .filter({ has: page.getByTestId("proximitySessionRowTitle").getByText(title, { exact: true }) });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await row.click();
    await expect(page.getByTestId("proximityEndedFooter")).toBeVisible();
}

/** Opens the live proximity thread, from wherever the chat is. */
export async function openProximityThread(page: Page): Promise<void> {
    if (!(await chat(page).isVisible())) {
        await openChat(page);
    }
    const input = page.getByTestId("messageInput");
    await expect
        .poll(
            async () => {
                if (await input.isVisible()) return true;
                const tab = page.getByTestId("chatTabChats");
                const selected = await tab.getAttribute("aria-selected", { timeout: 500 }).catch(() => null);
                if (selected === "false") await tab.click({ timeout: 2000 }).catch(() => undefined);
                const live = page.getByTestId("toggleDisplayProximityChat");
                if (await live.isVisible()) await live.click({ timeout: 2000 }).catch(() => undefined);
                return input.isVisible();
            },
            { message: "proximity thread did not open", timeout: 30_000, intervals: [500, 1000, 2000] }
        )
        .toBe(true);
    await expect(page.getByTestId("roomName")).toHaveText("Proximity Chat");
}

/** Types into the proximity field and sends with Enter. */
export async function send(page: Page, text: string): Promise<void> {
    const input = page.getByTestId("messageInput");
    await input.click();
    await input.fill(text);
    await input.press("Enter");
    await expect(input).toHaveText("");
}

/** Types into the proximity field key by key, without sending. */
export async function typeInField(page: Page, text: string): Promise<void> {
    await page.getByTestId("messageInput").click();
    await page.keyboard.type(text);
}

/** A message bubble in the open thread, by its text. */
export function message(page: Page, text: string) {
    return chat(page).locator("li[data-event-id]").filter({ hasText: text }).last();
}

/** Back from a thread to the list. */
export async function backToList(page: Page): Promise<void> {
    const back = page.getByTestId("chatBackward");
    // A bubble that just formed can still select its thread a moment later: back again until the list stays.
    await expect(async () => {
        if (await back.isVisible()) await back.click({ timeout: 5000 });
        await expect(back).toBeHidden({ timeout: 3000 });
        await page.waitForTimeout(1000);
        await expect(back).toBeHidden({ timeout: 100 });
    }).toPass({ timeout: 40_000 });
    await expect(page.getByTestId("chatTabChats")).toBeVisible();
}

/** Opens the People tab inside the open chat. */
export async function openPeople(page: Page): Promise<void> {
    if (!(await chat(page).isVisible())) {
        await openChat(page);
    }
    if (await page.getByTestId("chatBackward").isVisible()) await backToList(page);
    await page.getByTestId("chatTabPeople").click();
    await expect(page.getByTestId("peopleList")).toBeVisible();
}

export async function sheetHeight(page: Page): Promise<number> {
    const box = await chat(page).boundingBox();
    if (!box) throw new Error("chat sheet not on screen");
    return Math.round(box.height);
}

/** Drags the phone sheet's handle by dy pixels (negative is up), with the pointer, step by step. */
export async function dragHandle(page: Page, dy: number): Promise<void> {
    const handle = page.getByTestId("chatSheetHandle");
    const box = await handle.boundingBox();
    if (!box) throw new Error("sheet handle not on screen");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(x, y + (dy * i) / steps);
    }
    await page.mouse.up();
}

/** The clipboard text, read in the page (the context needs clipboard permissions). */
export async function clipboardText(page: Page): Promise<string> {
    return page.evaluate(() => navigator.clipboard.readText());
}

// One CDP session per page: Chrome keeps the touch in progress per session, so a touchEnd sent on a fresh session
// is refused ("Must send a TouchStart first").
const cdpSessions = new WeakMap<Page, Promise<CDPSession>>();

async function touch(page: Page, type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number): Promise<void> {
    let cdp = cdpSessions.get(page);
    if (!cdp) {
        cdp = page.context().newCDPSession(page);
        cdpSessions.set(page, cdp);
    }
    await (
        await cdp
    ).send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }],
    });
}

/** A real finger press and hold (touch pointer events), then lift. */
export async function touchHold(page: Page, target: Locator, ms = 700): Promise<void> {
    const box = await target.boundingBox();
    if (!box) throw new Error("nothing to hold");
    const x = box.x + Math.min(20, box.width / 2);
    const y = box.y + box.height / 2;
    await touch(page, "touchStart", x, y);
    await page.waitForTimeout(ms);
    await touch(page, "touchEnd", x, y);
}

/** A finger swipe from the target's left part, by dx and dy. */
export async function touchSwipe(page: Page, target: Locator, dx: number, dy = 0): Promise<void> {
    const box = await target.boundingBox();
    if (!box) throw new Error("nothing to swipe");
    const x = box.x + Math.min(20, box.width / 2);
    const y = box.y + box.height / 2;
    await touch(page, "touchStart", x, y);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
        await touch(page, "touchMove", x + (dx * i) / steps, y + (dy * i) / steps);
    }
    await touch(page, "touchEnd", x + dx, y + dy);
}

/** Where a remote player's WOKA is on screen, from the running game scene (vite dev only: tests using it are @local). */
export async function wokaPoint(
    page: Page,
    name: string
): Promise<{ x: number; y: number; worldX: number; worldY: number } | null> {
    return withFrontModule<{ x: number; y: number; worldX: number; worldY: number } | null>(
        page,
        "src/front/Phaser/Game/GameManager.ts",
        `m => {
            const scene = m.gameManager.getCurrentGameScene();
            const p = Array.from(scene.MapPlayersByKey.values()).find((p) => p.playerName === ${JSON.stringify(name)});
            if (!p) return null;
            const cam = scene.cameras.main;
            const rect = scene.game.canvas.getBoundingClientRect();
            const sx = rect.width / scene.scale.width;
            const sy = rect.height / scene.scale.height;
            return {
                x: rect.left + (cam.x + (p.x - cam.worldView.x) * cam.zoom) * sx,
                y: rect.top + (cam.y + (p.y - 6 - cam.worldView.y) * cam.zoom) * sy,
                worldX: p.x,
                worldY: p.y,
            };
        }`
    );
}

/**
 * Taps (phone) or clicks (desktop) a remote player's WOKA on the map. With `at` (where that player was teleported),
 * waits until this page shows the WOKA there, so the tap does not land where it stood before (a phone tap on the
 * empty map walks you there instead).
 */
export async function tapWoka(page: Page, name: string, phone: boolean, at?: { x: number; y: number }): Promise<void> {
    let point: { x: number; y: number } | null = null;
    await expect
        .poll(
            async () => {
                const found = await wokaPoint(page, name);
                point = found;
                if (!found) return false;
                return !at || Math.hypot(found.worldX - at.x, found.worldY - at.y) < 8;
            },
            { message: at ? `${name} is not on the map at ${at.x},${at.y}` : `${name} is not on the map` }
        )
        .toBe(true);
    const { x, y } = point as unknown as { x: number; y: number };
    if (phone) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
}

/** What is drawn on top at the centre of an element: true when it is the element itself (or inside it). */
export async function isOnTop(target: Locator): Promise<boolean> {
    return target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 30));
        return top !== null && (el === top || el.contains(top));
    });
}

/** A new browser context with the test project's device settings (the same as a second player gets). */
export async function deviceContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
    const use = testInfo.project.use;
    return browser.newContext({
        viewport: use.viewport,
        deviceScaleFactor: use.deviceScaleFactor,
        hasTouch: use.hasTouch,
        isMobile: use.isMobile,
        userAgent: use.userAgent,
        permissions: use.permissions,
        locale: use.locale,
        baseURL: use.baseURL,
    });
}

const EMOJI_DATA = [
    ["😀", "grinning face"],
    ["😃", "grinning face with big eyes"],
    ["😄", "grinning face with smiling eyes"],
    ["😁", "beaming face with smiling eyes"],
    ["😆", "grinning squinting face"],
    ["😅", "grinning face with sweat"],
    ["🤣", "rolling on the floor laughing"],
    ["😂", "face with tears of joy"],
    ["🙂", "slightly smiling face"],
    ["🙃", "upside-down face"],
    ["😉", "winking face"],
    ["😊", "smiling face with smiling eyes"],
    ["😇", "smiling face with halo"],
    ["🥰", "smiling face with hearts"],
    ["😍", "smiling face with heart-eyes"],
    ["🤩", "star-struck"],
    ["😘", "face blowing a kiss"],
    ["😗", "kissing face"],
    ["😚", "kissing face with closed eyes"],
    ["😙", "kissing face with smiling eyes"],
    ["😋", "face savoring food"],
    ["😛", "face with tongue"],
].map(([emoji, annotation], order) => ({
    annotation,
    emoji,
    group: 0,
    order: order + 1,
    shortcodes: [annotation.replace(/[^a-z]+/g, "_")],
    tags: annotation.split(" "),
    version: 1,
}));

/**
 * The emoji picker loads its emoji list from cdn.jsdelivr.net, which the local test machine cannot reach. This serves
 * a small list in its place, so the picker itself can be tested.
 */
export async function serveEmojiData(page: Page): Promise<void> {
    await page.context().route(/cdn\.jsdelivr\.net\/npm\/emoji-picker-element-data/, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: {
                ETag: '"sn-emoji-1"',
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "ETag",
            },
            body: route.request().method() === "HEAD" ? "" : JSON.stringify(EMOJI_DATA),
        })
    );
}
