import type { Page, TestInfo } from "@playwright/test";
import { expect, isPhone, test, wa } from "../lib/game";
import { editRoom, entityOnScreen, hit, openEditor, pickObject, pickTool, placeAt, playerPosition, readWam, scene } from "../lib/me";

const SITE = "http://localhost:8081/tests/E2E/empty.json";

/** In the 10 × 10 room: places a table, gives it settings through its Settings page, and returns its id. */
async function objectWith(page: Page, testInfo: TestInfo, url: string, dx: number, setup: (settings: ReturnType<Page["getByTestId"]>) => Promise<void>): Promise<string> {
    if (!(await page.getByTestId("edit-pill").isVisible())) await openEditor(page, testInfo);
    await pickTool(page, "EntityEditor");
    const me = await playerPosition(page);
    await pickObject(page, "Basic Small Table");
    const id = await placeAt(page, testInfo, url, { x: me.x + dx, y: me.y + 64 });
    await page.getByTestId("placing-done").click();
    await hit(page, testInfo, await entityOnScreen(page, url, id));
    await page.getByTestId("object-settings").click();
    const settings = page.getByTestId("object-settings-page");
    await expect(settings).toBeVisible();
    await setup(settings);
    await page.getByTestId("edit-panel-back").click();
    return id;
}

async function addWebsite(settings: ReturnType<Page["getByTestId"]>, link = SITE): Promise<void> {
    await settings.getByTestId("openWebsite").first().click();
    await settings.locator("input#tabLink").last().fill(link);
    await settings.locator("input#tabLink").last().press("Enter");
}

/** Leaves the editor and stands just below an object. */
async function standBy(page: Page, url: string, id: string): Promise<void> {
    if (await page.getByTestId("edit-pill").isVisible()) await page.getByTestId("closeMapEditorButton").click();
    await expect(page.getByTestId("edit-pill")).toBeHidden();
    const e = (await readWam(url)).entities[id];
    await wa(page, (p: { x: number; y: number }) => WA.player.teleport(p.x, p.y), { x: e.x + 16, y: e.y + 48 });
}

test("ME-070 @local An object with one website: outlined when near, Space or click opens it; two settings give a menu", async ({ page }, testInfo) => {
    const url = await editRoom(page, testInfo, "empty");
    await openEditor(page, testInfo);
    const one = await objectWith(page, testInfo, url, 64, (s) => addWebsite(s));
    await expect.poll(async () => (await readWam(url)).entities[one].properties?.find((p) => p.type === "openWebsite")?.link).toBe(SITE);
    const two = await objectWith(page, testInfo, url, 160, async (s) => {
        await addWebsite(s, SITE + "?a");
        await addWebsite(s, SITE + "?b");
    });
    await expect.poll(async () => (await readWam(url)).entities[two].properties?.filter((p) => p.type === "openWebsite").length).toBe(2);
    await standBy(page, url, one);
    await expect
        .poll(async () => scene(page, (s) => s.activatablesManager.selectedActivatableObjectByDistance?.entityId ?? null), { message: "the object near you is the one Space acts on (outlined)" })
        .toBe(one);
    if (!isPhone(testInfo)) {
        await page.keyboard.press("Space");
        await expect(page.locator("#cowebsites-container")).toBeVisible();
        await page.locator("#cowebsites-container").getByRole("button", { name: /close/i }).first().click().catch(() => undefined);
    }
    await hit(page, testInfo, await entityOnScreen(page, url, one));
    await expect(page.locator("#cowebsites-container")).toBeVisible();
    await hit(page, testInfo, await entityOnScreen(page, url, two));
    const menu = page.getByTestId("actions-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button")).not.toHaveCount(0);
    await expect(menu.locator("button:not([data-testid=closeActionsMenuButton])")).toHaveCount(2);
    await page.getByTestId("closeActionsMenuButton").click();
    await expect(menu).toBeHidden();
});

test("ME-071 @local Clicking an object with Play a sound plays it; with Open a file opens the file", async ({ page }, testInfo) => {
    const url = await editRoom(page, testInfo, "empty");
    await openEditor(page, testInfo);
    const sound = await objectWith(page, testInfo, url, 64, async (s) => {
        await s.getByTestId("playAudio").first().click();
        await s.locator("#audioLink").fill("http://localhost:3000/e2e/tests/assets/audio/campfire.ogg");
        await s.locator("#audioLink").blur();
    });
    await expect.poll(async () => String((await readWam(url)).entities[sound].properties?.find((p) => p.type === "playAudio")?.audioLink ?? "")).toContain("campfire");
    const file = await objectWith(page, testInfo, url, 160, async (s) => {
        await s.getByTestId("openFile").first().click();
        await s.locator("input#upload, input[type=file]").first().setInputFiles("/home/claude/wt-carrier/tests/tests/assets/lorem-ipsum.pdf");
    });
    await expect.poll(async () => String((await readWam(url)).entities[file].properties?.find((p) => p.type === "openFile")?.link ?? ""), { timeout: 20_000 }).toContain(".pdf");
    await standBy(page, url, sound);
    await hit(page, testInfo, await entityOnScreen(page, url, sound));
    await expect
        .poll(async () => page.locator("audio").evaluateAll((all) => all.some((a) => (a as HTMLAudioElement).src.includes("campfire") && !(a as HTMLAudioElement).paused)), { message: "the sound plays" })
        .toBe(true);
    await standBy(page, url, file);
    await hit(page, testInfo, await entityOnScreen(page, url, file));
    await expect(page.locator("#cowebsites-container")).toBeVisible();
});
