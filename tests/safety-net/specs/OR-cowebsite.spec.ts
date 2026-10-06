import type { Page } from "@playwright/test";
import { test, expect, isPhone, join, wa, wamRoom } from "../lib/game";
import {
    INPUT_PAGE,
    addWamAreas,
    barTop,
    cowebsite,
    cowebsiteFrame,
    fakeOutside,
    playerAt,
    popups,
    teleport,
    tiled,
    walkUntil,
} from "../lib/or";

const OPEN_WEBSITE_DESKTOP = "[SPACE] to open web site 👀";
const OPEN_WEBSITE_PHONE = "👆 to open web site 👀";

async function walkToTopRow(page: Page): Promise<void> {
    await walkUntil(page, "ArrowUp", () => expect.poll(async () => (await playerAt(page)).y, { timeout: 15_000 }).toBeLessThan(40));
}

async function walkOutLeft(page: Page): Promise<void> {
    await walkUntil(page, "ArrowLeft", () => expect.poll(async () => (await playerAt(page)).x, { timeout: 15_000 }).toBeLessThan(5 * 32));
}

async function openTwoCowebsites(page: Page): Promise<void> {
    await wa(
        page,
        async (url: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const WA = (globalThis as any).WA;
            await WA.onInit();
            await WA.nav.openCoWebSite(url, false, "", 50, 0, true);
            await WA.nav.openCoWebSite(url + "?second", false, "", 50, 0, true);
        },
        INPUT_PAGE
    );
    await expect(page.getByTestId("tab2")).toBeVisible();
}

test("OR-077 @local Walking into an openWebsite area opens the cowebsite beside the map; walking out closes it", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await fakeOutside(page.context());
    await join(page, tiled(testInfo, "tests/CoWebsite/cowebsite_property.json"), "Alice");
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);

    await walkUntil(page, "ArrowRight", () => expect(cowebsite(page)).toBeVisible());
    const tab = page.getByTestId("tab1");
    await expect(tab).toContainText("Wikipedia");
    await expect(tab).toContainText("https://wikipedia.org/");
    await expect(cowebsiteFrame(page)).toHaveAttribute("src", /^https:\/\/wikipedia\.org/);
    const box = (await cowebsite(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThan(viewport.width / 4);
    expect(Math.round(box.x + box.width)).toBeGreaterThanOrEqual(viewport.width - 2);

    await walkOutLeft(page);
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);
});

test("OR-078 @local Phone: the cowebsite opens above the map with a horizontal drag bar under it", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await fakeOutside(page.context());
    await join(page, tiled(testInfo, "tests/CoWebsite/cowebsite_property.json"), "Alice");
    await walkUntil(page, "ArrowRight", () => expect(cowebsite(page)).toBeVisible());
    await expect(cowebsiteFrame(page)).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = (await cowebsite(page).boundingBox())!;
    expect(box.y).toBeLessThan(5);
    expect(box.width).toBeGreaterThan(viewport.width - 5);
    expect(box.y + box.height).toBeLessThan(viewport.height * 0.9);

    const bar = cowebsite(page).locator(".cursor-row-resize");
    await expect(bar).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    expect(barBox.width).toBeGreaterThan(barBox.height);
    expect(barBox.y).toBeGreaterThan(box.y + box.height - 20);
});

test("OR-079 @local Desktop: on-action cowebsite shows the SPACE popup; SPACE or the button opens it; leaving removes the popup", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await fakeOutside(page.context());
    await join(page, tiled(testInfo, "tests/CoWebsite/cowebsite_property_trigger.json"), "Alice");
    await walkToTopRow(page);

    const message = popups(page).getByText(OPEN_WEBSITE_DESKTOP);
    const button = popups(page).getByRole("button", { name: "Open Website" });

    await walkUntil(page, "ArrowRight", () => expect(message).toBeVisible());
    await expect(button).toBeVisible();
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(cowebsiteFrame(page)).toHaveAttribute("src", /workadventu\.re/);
    await expect(message).toBeHidden();

    await walkOutLeft(page);
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);
    await walkUntil(page, "ArrowRight", () => expect(button).toBeVisible());
    await button.click();
    await expect(cowebsiteFrame(page)).toHaveAttribute("src", /workadventu\.re/);
    await expect(message).toBeHidden();

    await walkOutLeft(page);
    await walkUntil(page, "ArrowRight", () => expect(message).toBeVisible());
    await walkOutLeft(page);
    await expect(message).toBeHidden();
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);
});

test("OR-080 @local Phone: on-action cowebsite popup reads the tap text, sits above the bar, and the button opens it", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await fakeOutside(page.context());
    await join(page, tiled(testInfo, "tests/CoWebsite/cowebsite_property_trigger.json"), "Alice");
    await walkToTopRow(page);

    const message = popups(page).getByText(OPEN_WEBSITE_PHONE);
    await walkUntil(page, "ArrowRight", () => expect(message).toBeVisible());
    const button = popups(page).getByRole("button", { name: "Open Website" });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(await barTop(page));

    await button.tap();
    await expect(cowebsiteFrame(page)).toHaveAttribute("src", /workadventu\.re/);
    await expect(message).toBeHidden();
});

test("OR-081 Two cowebsite tabs stay loaded, keep what was typed, show only the active one; arrows on overflow", async ({ player }) => {
    await openTwoCowebsites(player);
    const input = () => player.locator('iframe[title="Cowebsite"]:visible').contentFrame().locator('[id="\\#text_input"]');

    await expect(input()).toHaveValue("");
    await input().fill("tab2");
    await player.getByTestId("tab1").click();
    await expect(player.locator('iframe[title="Cowebsite"]:visible')).toHaveCount(1);
    await expect(input()).toHaveValue("");
    await input().fill("tab1");
    await player.getByTestId("tab2").click();
    await expect(input()).toHaveValue("tab2");
    await expect(player.locator('iframe[title="Cowebsite"]')).toHaveCount(2);
    await expect(player.locator('iframe[title="Cowebsite"]:visible')).toHaveCount(1);
    await player.getByTestId("tab1").click();
    await expect(input()).toHaveValue("tab1");

    await wa(
        player,
        async (url: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const WA = (globalThis as any).WA;
            for (let i = 3; i <= 6; i++) await WA.nav.openCoWebSite(url + "?tab" + i, false, "", 50, 0, true);
        },
        INPUT_PAGE
    );
    await expect(player.getByTestId("tab6")).toHaveCount(1);
    await expect(cowebsite(player).locator(".flex-0 button").first()).toBeVisible();
});

test("OR-082 Cowebsite tab buttons: first copies the URL with a popup, second opens a new tab, X closes the tab", async ({ player }) => {
    await player.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await openTwoCowebsites(player);
    const tab = player.getByTestId("tab2");
    const buttons = tab.locator("button");
    await expect(buttons).toHaveCount(3);

    await buttons.nth(0).click();
    const copied = popups(player).getByText("Url copied to clipboard");
    await expect(copied).toBeVisible();
    expect(await player.evaluate(() => navigator.clipboard.readText())).toBe(INPUT_PAGE + "?second");
    await popups(player).locator("button").click();
    await expect(copied).toBeHidden();

    const [opened] = await Promise.all([player.context().waitForEvent("page"), buttons.nth(1).click()]);
    expect(opened.url()).toBe(INPUT_PAGE + "?second");
    await opened.close();

    await buttons.nth(2).click();
    await expect(player.getByTestId("tab2")).toHaveCount(0);
    await expect(player.getByTestId("tab1")).toBeVisible();
    await expect(player.locator('iframe[title="Cowebsite"]')).toHaveCount(1);
});

test("OR-083 Desktop: the cowebsite's drag bar resizes the split; the full-screen icon hides the game and comes back", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await openTwoCowebsites(player);
    const container = cowebsite(player);
    const before = (await container.boundingBox())!;

    const bar = container.locator(".cursor-col-resize");
    await expect(bar).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    await player.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await player.mouse.down();
    await player.mouse.move(barBox.x - 200, barBox.y + barBox.height / 2, { steps: 10 });
    await player.mouse.up();
    await expect.poll(async () => (await container.boundingBox())!.width).toBeGreaterThan(before.width + 150);

    const viewport = player.viewportSize()!;
    const fullScreen = container.locator(".justify-end.w-10 > div");
    await fullScreen.click();
    await expect(container).toHaveClass(/cowebsite-fullscreen/);
    await expect.poll(async () => (await container.boundingBox())!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect((await container.boundingBox())!.height).toBeGreaterThanOrEqual(viewport.height - 1);
    await expect(bar).toBeHidden();

    await fullScreen.click();
    await expect(container).toHaveClass(/cowebsite-normal/);
    await expect(bar).toBeVisible();
    await expect.poll(async () => (await container.boundingBox())!.width).toBeLessThan(viewport.width - 100);
});

test("OR-084 @local A not-closable on-icon cowebsite shows its tab without X and closes when you leave", async ({ page }, testInfo) => {
    await fakeOutside(page.context());
    await join(page, tiled(testInfo, "tests/CoWebsite/cowebsite_property_onicon_closable.json"), "Alice");
    await walkToTopRow(page);
    await walkUntil(page, "ArrowRight", () => expect(page.getByTestId("tab1")).toBeVisible());
    await expect(page.getByTestId("tab1")).toContainText("Workadventu");
    await expect(page.getByTestId("tab1").locator("button")).toHaveCount(2);
    await walkOutLeft(page);
    await expect(page.getByTestId("tab1")).toHaveCount(0);
});

test("OR-085 Open-tab area on action: popup with Open Tab; SPACE and the button open a new browser tab; without a trigger it opens at once", async ({ page }, testInfo) => {
    await fakeOutside(page.context());
    const url = await wamRoom(testInfo, "empty");
    const link = "https://workadventu.re/open-tab";
    await addWamAreas(url, [
        { id: "tab-action", name: "tabAction", x: 160, y: 0, width: 128, height: 96, properties: [{ id: "p1", type: "openWebsite", link, newTab: true, trigger: "onaction" }] },
        { id: "tab-enter", name: "tabEnter", x: 160, y: 224, width: 128, height: 96, properties: [{ id: "p2", type: "openWebsite", link: link + "-now", newTab: true }] },
    ]);
    await join(page, url, "Alice");

    const text = isPhone(testInfo) ? "👆 to open web new tab 👀" : "[SPACE] to open new tab 👀";
    const message = popups(page).getByText(text);
    const button = popups(page).getByRole("button", { name: "Open Tab" });

    await teleport(page, 208, 48);
    await expect(message).toBeVisible();
    await expect(button).toBeVisible();
    const [bySpace] = await Promise.all([page.context().waitForEvent("page"), page.keyboard.press("Space")]);
    expect(bySpace.url()).toBe(link);
    await bySpace.close();
    await expect(message).toBeHidden();

    await teleport(page, 48, 144);
    await teleport(page, 208, 48);
    await expect(button).toBeVisible();
    const [byButton] = await Promise.all([page.context().waitForEvent("page"), button.click()]);
    expect(byButton.url()).toBe(link);
    await byButton.close();

    await teleport(page, 48, 144);
    const [atOnce] = await Promise.all([page.context().waitForEvent("page"), teleport(page, 208, 272)]);
    expect(atOnce.url()).toBe(link + "-now");
});

test("OR-086 WAM website areas: cowebsite on enter, Open Website popup on action; leaving closes and removes them", async ({ page }, testInfo) => {
    await fakeOutside(page.context());
    const url = await wamRoom(testInfo, "empty");
    await addWamAreas(url, [
        { id: "site-enter", name: "siteEnter", x: 160, y: 0, width: 128, height: 96, properties: [{ id: "p1", type: "openWebsite", link: INPUT_PAGE + "?enter", newTab: false, closable: true }] },
        { id: "site-action", name: "siteAction", x: 160, y: 224, width: 128, height: 96, properties: [{ id: "p2", type: "openWebsite", link: INPUT_PAGE + "?action", newTab: false, closable: true, trigger: "onaction" }] },
    ]);
    await join(page, url, "Alice");

    await teleport(page, 208, 48);
    await expect(cowebsiteFrame(page)).toHaveAttribute("src", INPUT_PAGE + "?enter");
    await teleport(page, 48, 144);
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);

    const message = popups(page).getByText(isPhone(testInfo) ? OPEN_WEBSITE_PHONE : OPEN_WEBSITE_DESKTOP);
    await teleport(page, 208, 272);
    await expect(message).toBeVisible();
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);
    await popups(page).getByRole("button", { name: "Open Website" }).click();
    await expect(cowebsiteFrame(page)).toHaveAttribute("src", INPUT_PAGE + "?action");
    await expect(message).toBeHidden();
    await teleport(page, 48, 144);
    await expect(page.locator('iframe[title="Cowebsite"]')).toHaveCount(0);

    await teleport(page, 208, 272);
    await expect(message).toBeVisible();
    await teleport(page, 48, 144);
    await expect(message).toBeHidden();
});

async function stubJitsi(page: Page): Promise<void> {
    await page.context().route(/^https:\/\/jitsi\.invalid\//, (route) =>
        route.fulfill({ status: 200, contentType: "application/javascript", body: "window.JitsiMeetExternalAPI = function () { return { addListener() {}, removeListener() {}, executeCommand() {}, dispose() {}, getIFrame() { return document.createElement('iframe'); } }; };" })
    );
}

async function expectJitsiFlow(page: Page, isPhoneProject: boolean, leave: () => Promise<void>, enter: () => Promise<void>): Promise<void> {
    const message = popups(page).getByText(isPhoneProject ? "👆 to enter Jitsi 👀" : "[SPACE] to enter Jitsi 👀");
    await enter();
    await expect(message).toBeVisible();
    await popups(page).getByRole("button", { name: "Enter Jitsi" }).click();
    await expect(page.getByTestId("tab1")).toContainText("Jitsi");
    await expect(message).toBeHidden();
    await leave();
    await expect(page.getByTestId("tab1")).toHaveCount(0);
}

test("OR-087 Jitsi area on action: Enter Jitsi popup opens a Jitsi tab; leaving closes it", async ({ page }, testInfo) => {
    await stubJitsi(page);
    await join(page, tiled(testInfo, "tests/E2E/empty.json"), "Alice");
    await wa(page, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const WA = (globalThis as any).WA;
        await WA.onInit();
        const area = WA.room.area.create({ name: "jitsiZone", x: 160, y: 0, width: 128, height: 96 });
        area.setProperty("jitsiTrigger", "onaction");
        area.setProperty("jitsiUrl", "https://jitsi.invalid");
        area.setProperty("jitsiRoom", "safety-net");
    });
    await expectJitsiFlow(page, isPhone(testInfo), () => teleport(page, 48, 144), () => teleport(page, 208, 48));
});

test("OR-088 WAM Jitsi area on action: Enter Jitsi popup opens a Jitsi tab; leaving closes it", async ({ page }, testInfo) => {
    await stubJitsi(page);
    const url = await wamRoom(testInfo, "empty");
    await addWamAreas(url, [
        { id: "jitsi", name: "jitsiArea", x: 160, y: 0, width: 128, height: 96, properties: [{ id: "p1", type: "jitsiRoomProperty", roomName: "safety-net", trigger: "onaction", jitsiUrl: "https://jitsi.invalid", jitsiRoomConfig: {} }] },
    ]);
    await join(page, url, "Alice");
    await expectJitsiFlow(page, isPhone(testInfo), () => teleport(page, 48, 144), () => teleport(page, 208, 48));
});

