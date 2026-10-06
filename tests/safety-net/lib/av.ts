import type { Browser, Locator, Page, TestInfo } from "@playwright/test";
import { expect, isPhone, newPlayer, wa, withFrontModule } from "./game";

export async function boxOf(locator: Locator) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    if (!box) throw new Error("no bounding box");
    return box;
}

/** Bob joins the same room. On tests/E2E/empty.json both spawn on the same tile, so they meet at once. */
export async function joinBubble(browser: Browser, testInfo: TestInfo, alice: Page, url: string, name = "Bob"): Promise<Page> {
    const bob = await newPlayer(browser, testInfo, url, name);
    await expectInBubble(alice, name);
    await expectInBubble(bob, "Alice");
    return bob;
}

export async function expectInBubble(page: Page, name: string): Promise<void> {
    await expect(page.locator("#cameras-container").getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

export async function expectNoBubble(page: Page): Promise<void> {
    await expect(page.locator("#cameras-container .camera-box").filter({ hasNotText: "You" })).toHaveCount(0, { timeout: 30_000 });
}

export async function teleport(page: Page, x: number, y: number): Promise<void> {
    await wa(page, async (pos) => {
        await WA.player.teleport(pos.x, pos.y);
    }, { x, y });
}

export async function position(page: Page): Promise<{ x: number; y: number }> {
    return wa(page, async () => {
        const p = await WA.player.getPosition();
        return { x: p.x, y: p.y };
    });
}

export async function expectState(page: Page, testId: string, state: string): Promise<void> {
    await expect(page.getByTestId(testId).first()).toHaveAttribute("data-state", state);
}

export async function tapOrClick(page: Page, testInfo: TestInfo, target: Locator): Promise<void> {
    if (isPhone(testInfo)) await target.tap();
    else await target.click();
}

export async function openProfileMenu(page: Page, testInfo: TestInfo): Promise<Locator> {
    await tapOrClick(page, testInfo, page.locator("[data-testid=action-user] button.profile-button"));
    const menu = page.getByTestId("profile-menu");
    await expect(menu).toBeVisible();
    return menu;
}

export async function openDeviceList(page: Page, testInfo: TestInfo): Promise<Locator> {
    const arrow = page.locator("button.device-arrow");
    if (isPhone(testInfo)) {
        await arrow.tap();
    } else {
        await page.getByTestId("microphone-button").hover();
        await arrow.click();
    }
    await expect(arrow).toHaveAttribute("aria-expanded", "true");
    const list = page.locator(".device-list");
    await expect(list).toBeVisible();
    return list;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const WA: any;
}

/** Live tracks of the local camera/microphone stream (reads the front's store: @local tests only). */
export async function liveTracks(page: Page): Promise<{ video: number; audio: number }> {
    return withFrontModule<{ video: number; audio: number }>(
        page,
        "src/front/Stores/MediaStore.ts",
        `m => new Promise((resolve) => {
            const stop = m.localStreamStore.subscribe((v) => {
                const stream = v.type === "success" ? v.stream : undefined;
                const live = (tracks) => tracks.filter((t) => t.readyState === "live" && t.enabled).length;
                resolve({ video: stream ? live(stream.getVideoTracks()) : 0, audio: stream ? live(stream.getAudioTracks()) : 0 });
            });
            setTimeout(stop, 0);
        })`
    );
}

export async function setTabVisible(page: Page, visible: boolean): Promise<void> {
    await page.evaluate((visible) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (visible ? "visible" : "hidden") });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => !visible });
        document.dispatchEvent(new Event("visibilitychange"));
    }, visible);
}

/** Where a WOKA is on screen, found through the thinking cloud above it (a DOM element Phaser places over the canvas). */
export async function wokaOnScreen(page: Page, cloudText: string): Promise<{ x: number; y: number }> {
    const cloud = page.locator(".thinking-cloud", { hasText: cloudText });
    const box = await boxOf(cloud);
    return { x: box.x + box.width / 2, y: box.y + box.height + 30 };
}

export async function think(page: Page, testInfo: TestInfo, text: string): Promise<void> {
    await tapOrClick(page, testInfo, page.getByTestId("express-button"));
    await tapOrClick(page, testInfo, page.getByTestId("express-think-toggle"));
    await page.getByTestId("express-input").fill(text);
    await tapOrClick(page, testInfo, page.getByTestId("express-send"));
    await expect(page.locator(".thinking-cloud", { hasText: text })).toBeVisible();
}
