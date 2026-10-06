import type { Locator, Page, Route } from "@playwright/test";
import { expect, wa } from "./game";

export const nameInput = (page: Page) => page.getByTestId("loginSceneNameInput");
export const continueButton = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
export const wokaTiles = (page: Page) => page.locator("#woka-grid [role=radio]");
export const checkedTile = (page: Page) => page.locator("#woka-grid [role=radio][aria-checked=true]");
export const cameraHeading = (page: Page) => page.getByRole("heading", { name: "Turn on your camera and microphone" });

/** Opens a room in a fresh browser and waits for the name screen. */
export async function openNameScreen(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await expect(nameInput(page)).toBeVisible({ timeout: 60_000 });
}

/** From a fresh browser to the WOKA picker, with its tiles loaded. */
export async function openWokaPicker(page: Page, url: string, name = "Alice"): Promise<void> {
    await openNameScreen(page, url);
    await nameInput(page).fill(name);
    await continueButton(page).click();
    await expect(page.getByRole("heading", { name: "Pick your WOKA" }).first()).toBeVisible();
    await expect(wokaTiles(page).first()).toBeVisible();
}

/** From a fresh browser to Build your WOKA, with its tiles loaded. */
export async function openWokaBuilder(page: Page, url: string): Promise<void> {
    await openWokaPicker(page, url);
    await page.locator("button.wokaBuildButton").click();
    await expect(page.getByRole("heading", { name: "Make it yours" }).first()).toBeVisible();
    await expect(wokaTiles(page).first()).toBeVisible();
}

/** From a fresh browser to the camera and microphone screen, with the camera preview playing. */
export async function openCameraScreen(page: Page, url: string, name = "Alice"): Promise<void> {
    await openWokaPicker(page, url, name);
    await continueButton(page).click();
    await expect(cameraHeading(page)).toBeVisible();
}

/** A picture of a canvas, to tell whether what it draws changed. */
export async function canvasPicture(canvas: Locator): Promise<string> {
    return canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
}

/** The id of the checked tile in each Build your WOKA part, by part name. */
export async function builderSelection(page: Page): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
        const tab = tabs.nth(i);
        const label = (await tab.innerText()).trim();
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(checkedTile(page)).toHaveCount(1);
        result[label] = (await checkedTile(page).getAttribute("id")) ?? "";
    }
    await tabs.first().click();
    return result;
}

/**
 * Serves the room's WOKA catalog split into many collections: the real one (with each WOKA repeated so the tiles
 * scroll) and eight small ones, so the collection pills show and overflow. Copies have ids prefixed "copy-".
 */
export async function serveManyCollections(page: Page): Promise<void> {
    await page.route("**/woka/list*", async (route: Route) => {
        const response = await route.fetch();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await response.json();
        const original = data.woka.collections[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const copy = (texture: any, n: number) => ({ ...texture, id: `copy-${n}-${texture.id}` });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textures: any[] = original.textures;
        const collections = [{ name: "Main collection", textures: [...textures, ...textures.map((t) => copy(t, 0))] }];
        for (let n = 1; n <= 8; n++) {
            collections.push({
                name: `Collection number ${n}`,
                textures: textures.slice(n, n + 3).map((t) => copy(t, n)),
            });
        }
        data.woka.collections = collections;
        await route.fulfill({ response, json: data });
    });
}

/** Swipes a finger sideways across an element (touch events, as a phone sends them). */
export async function swipe(target: Locator, dx: number): Promise<void> {
    await target.evaluate((node, distance) => {
        const box = node.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const touch = (clientX: number) => new Touch({ identifier: 1, target: node, clientX, clientY: y });
        const start = touch(x - distance / 2);
        const end = touch(x + distance / 2);
        node.dispatchEvent(new TouchEvent("touchstart", { touches: [start], changedTouches: [start], bubbles: true }));
        node.dispatchEvent(new TouchEvent("touchmove", { touches: [end], changedTouches: [end], bubbles: true }));
        node.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [end], bubbles: true }));
    }, dx);
}

/**
 * Makes the browser refuse the camera and microphone, as when the person blocked them: getUserMedia fails with
 * NotAllowedError and the permission reads "denied". Counts the asks in window.__jnMediaAsks.
 * With onlyWhenFlagged, it only refuses after sessionStorage "jn-block-media" is set (so a page can join first).
 */
export async function blockMedia(page: Page, onlyWhenFlagged = false): Promise<void> {
    await page.addInitScript((flagged) => {
        if (flagged && sessionStorage.getItem("jn-block-media") !== "1") return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__jnMediaAsks = 0;
        navigator.mediaDevices.getUserMedia = () => {
            w.__jnMediaAsks++;
            return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
        };
        const query = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (descriptor: PermissionDescriptor) => {
            if (
                descriptor.name === ("camera" as PermissionName) ||
                descriptor.name === ("microphone" as PermissionName)
            ) {
                return Promise.resolve({
                    state: "denied",
                    name: descriptor.name,
                    onchange: null,
                } as unknown as PermissionStatus);
            }
            return query(descriptor);
        };
    }, onlyWhenFlagged);
}

/** Records every sound the page plays (the src of each audio element play() call) in window.__jnPlayed. */
export async function recordSounds(page: Page): Promise<void> {
    await page.addInitScript(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__jnPlayed = [];
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            w.__jnPlayed.push(this.currentSrc || this.src);
            return play.call(this).catch(() => undefined);
        };
    });
}

export async function playedSounds(page: Page): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return page.evaluate(() => (window as any).__jnPlayed as string[]);
}

export const profileMenu = (page: Page) => page.getByTestId("profile-menu");
export const profileButton = (page: Page) => page.getByTestId("action-user").locator("button.profile-button");

/** Opens the profile menu. It can already be open when coming back from a join screen (as on prod). */
export async function openMenu(page: Page): Promise<void> {
    if (!(await profileMenu(page).isVisible())) await page.getByTestId("action-user").click();
    await expect(profileMenu(page)).toBeVisible();
}

/** Picks a status in the profile menu (opening it first) and waits for the menu to close. */
export async function pickStatus(page: Page, status: string): Promise<void> {
    if (!(await profileMenu(page).isVisible())) await openMenu(page);
    await profileMenu(page).getByRole("button", { name: status, exact: true }).click();
    await expect(profileMenu(page)).toBeHidden();
}

/** The status row the profile menu shows as the current one (tinted, with a visible check). */
export async function expectCurrentStatus(page: Page, status: string): Promise<void> {
    const wasOpen = await profileMenu(page).isVisible();
    if (!wasOpen) await openMenu(page);
    const row = profileMenu(page).getByRole("button", { name: status, exact: true });
    await expect(row).toHaveClass(/u-selected/);
    await expect(row.locator("svg").last()).not.toHaveClass(/opacity-0/);
    await expect(profileMenu(page).locator("button.status-button.u-selected")).toHaveCount(1);
    if (!wasOpen) {
        await page.keyboard.press("Escape");
        await expect(profileMenu(page)).toBeHidden();
    }
}

/** Closes the "Turn on notifications?" card when it shows. */
export async function dismissNotificationAsk(page: Page): Promise<void> {
    const notNow = page.getByRole("button", { name: "Not now" });
    await notNow.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
    if (await notNow.isVisible()) await notNow.click();
}

/** Starts noting, in the map script, whether this player enters a bubble. */
export async function watchBubble(page: Page): Promise<void> {
    await wa(page, () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__jnInBubble = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).WA.player.proximityMeeting.onJoin().subscribe(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__jnInBubble = true;
        });
    });
}

export async function inBubble(page: Page): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return wa(page, () => (globalThis as any).__jnInBubble === true);
}
