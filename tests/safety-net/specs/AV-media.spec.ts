import type { Page } from "@playwright/test";
import { expect, isPhone, join, roomUrl, test, withFrontModule } from "../lib/game";
import { boxOf, expectNoBubble, expectState, joinBubble, openDeviceList, openProfileMenu, tapOrClick, teleport } from "../lib/av";

function tileOf(page: Page, name: string) {
    return page.locator("#cameras-container .camera-box").filter({ hasText: name });
}

async function pickStatus(page: Page, testInfo: Parameters<typeof openProfileMenu>[1], status: string) {
    const menu = page.getByTestId("profile-menu");
    if (!(await menu.isVisible())) await openProfileMenu(page, testInfo);
    await tapOrClick(page, testInfo, menu.locator(".status-button", { hasText: status }).last());
    const notNow = page.getByRole("button", { name: "Not now" });
    if (await notNow.isVisible({ timeout: 2000 }).catch(() => false)) await notNow.click();
}

test("AV-009 AV-010 AV-011 Mic and camera toggle, the other player sees it, live ring in the call", async ({ player, url, browser }, testInfo) => {
    await expectState(player, "microphone-button", "normal");
    await expect(player.getByTestId("microphone-button")).not.toHaveAttribute("data-live", "true");
    const bob = await joinBubble(browser, testInfo, player, url);

    await expect(player.getByTestId("microphone-button")).toHaveAttribute("data-live", "true");
    await expect(player.getByTestId("camera-button")).toHaveAttribute("data-live", "true");

    await tapOrClick(player, testInfo, player.getByTestId("microphone-button"));
    await expectState(player, "microphone-button", "forbidden");
    await expect(bob.getByTestId("Alice is muted.")).toBeVisible();
    await expect(bob.getByLabel("Alice is muted.")).toBeVisible();
    await tapOrClick(player, testInfo, player.getByTestId("microphone-button"));
    await expectState(player, "microphone-button", "normal");
    await expect(bob.getByTestId("Alice is muted.")).toHaveCount(0);

    await expect(tileOf(bob, "Alice").locator("video")).toHaveCount(1);
    await tapOrClick(player, testInfo, player.getByTestId("camera-button"));
    await expectState(player, "camera-button", "forbidden");
    await expect(tileOf(bob, "Alice").locator("video")).toHaveCount(0);
    await expect(tileOf(bob, "Alice").getByText("Alice")).toBeVisible();
    await tapOrClick(player, testInfo, player.getByTestId("camera-button"));
    await expectState(player, "camera-button", "normal");
    await expect(tileOf(bob, "Alice").locator("video")).toHaveCount(1);

    await teleport(bob, 290, 20);
    await expectNoBubble(player);
    await expect(player.getByTestId("microphone-button")).not.toHaveAttribute("data-live", "true");
    await expect(player.getByTestId("camera-button")).not.toHaveAttribute("data-live", "true");
    await bob.context().close();
});

test("AV-012 Busy, Do not disturb and Back in a moment disable mic and camera; Online restores", async ({ player }, testInfo) => {
    for (const status of ["Busy", "Do not disturb", "Back in a moment"]) {
        await pickStatus(player, testInfo, status);
        await expectState(player, "microphone-button", "disabled");
        await expectState(player, "camera-button", "disabled");
        await expect(player.getByTestId("microphone-button")).toBeDisabled();
    }
    await pickStatus(player, testInfo, "Online");
    await expectState(player, "microphone-button", "normal");
    await expectState(player, "camera-button", "normal");
});

test("AV-013 Desktop device tab shows on hover, centred on the seam, toggles the list", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const arrow = player.locator("button.device-arrow");
    await player.mouse.move(700, 700);
    await expect.poll(() => arrow.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await player.getByTestId("microphone-button").hover();
    await expect.poll(() => arrow.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    const mic = await boxOf(player.getByTestId("microphone-button"));
    const cam = await boxOf(player.getByTestId("camera-button"));
    const tab = await boxOf(arrow);
    const seam = (mic.x + mic.width + cam.x) / 2;
    expect(Math.abs(tab.x + tab.width / 2 - seam)).toBeLessThan(8);
    expect(tab.y).toBeGreaterThan(mic.y + mic.height - 4);

    await expect(arrow).toHaveAttribute("aria-expanded", "false");
    await arrow.click();
    await expect(arrow).toHaveAttribute("aria-expanded", "true");
    await expect(player.locator(".device-list")).toBeVisible();
    await expect.poll(() => arrow.locator(".device-arrow-tab").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");
    await arrow.click();
    await expect(arrow).toHaveAttribute("aria-expanded", "false");
    await expect(player.locator(".device-list")).toHaveCount(0);
});

test("AV-014 Phone device tab always shows above the bar and opens the list upwards", async ({ player }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const arrow = player.locator("button.device-arrow");
    await expect.poll(() => arrow.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    const mic = await boxOf(player.getByTestId("microphone-button"));
    const tab = await boxOf(arrow);
    expect(tab.height).toBeGreaterThanOrEqual(44);
    expect(tab.y + tab.height).toBeLessThanOrEqual(mic.y + 2);
    await arrow.tap();
    await expect(arrow).toHaveAttribute("aria-expanded", "true");
    const list = await boxOf(player.locator(".device-list"));
    expect(list.y + list.height).toBeLessThanOrEqual(mic.y);
});

test("AV-016 Device list shows its tabs, sections and footer", async ({ player }, testInfo) => {
    const list = await openDeviceList(player, testInfo);
    await expect(list.getByRole("tab", { name: "Devices" })).toHaveAttribute("aria-selected", "true");
    await expect(list.getByRole("tab", { name: "Background" })).toBeVisible();
    await expect(list.getByText("Camera", { exact: true })).toBeVisible();
    await expect(list.getByText("Microphone", { exact: true })).toBeVisible();
    await expect(list.getByText("Noise filter")).toBeVisible();
    await expect(list.locator("button.device-row[aria-pressed=true]").filter({ hasNotText: /Output/ })).toHaveCount(2);
    if (await list.getByText("Audio output", { exact: true }).isVisible()) {
        await expect(list.locator("button.device-row[aria-pressed=true]").filter({ hasText: /Output/ })).toHaveCount(1);
    }
    await expect(list.getByRole("button", { name: "Test my settings" })).toBeVisible();
    await expect(list.getByRole("button", { name: "Close", exact: true })).toBeVisible();
});

test("AV-020 Close and a click outside both close the device list", async ({ player }, testInfo) => {
    const list = await openDeviceList(player, testInfo);
    await tapOrClick(player, testInfo, list.getByRole("button", { name: "Close", exact: true }));
    await expect(list).toHaveCount(0);

    const reopened = await boxOf(await openDeviceList(player, testInfo));
    const outside = { x: 30, y: reopened.y + reopened.height / 2 };
    if (isPhone(testInfo)) await player.touchscreen.tap(outside.x, outside.y);
    else await player.mouse.click(outside.x, outside.y);
    await expect(player.locator(".device-list")).toHaveCount(0);
});

test("AV-019 With the camera or mic off, the list says so and turns it back on", async ({ player }, testInfo) => {
    await tapOrClick(player, testInfo, player.getByTestId("camera-button"));
    await expectState(player, "camera-button", "forbidden");
    let list = await openDeviceList(player, testInfo);
    await expect(list.getByText("Your camera is off")).toBeVisible();
    await tapOrClick(player, testInfo, list.getByRole("button", { name: "Turn on camera" }));
    await expectState(player, "camera-button", "normal");
    if (await list.isVisible()) await tapOrClick(player, testInfo, list.getByRole("button", { name: "Close", exact: true }));
    await expect(list).toHaveCount(0);

    await tapOrClick(player, testInfo, player.getByTestId("microphone-button"));
    await expectState(player, "microphone-button", "forbidden");
    list = await openDeviceList(player, testInfo);
    await expect(list.getByText("Your microphone is off")).toBeVisible();
    await tapOrClick(player, testInfo, list.getByRole("button", { name: "Turn on microphone" }));
    await expectState(player, "microphone-button", "normal");
});

test("AV-021 Test my settings leaves for the camera and microphone screen", async ({ player }, testInfo) => {
    const list = await openDeviceList(player, testInfo);
    await tapOrClick(player, testInfo, list.getByRole("button", { name: "Test my settings" }));
    await expect(player.getByRole("heading", { name: "Turn on your camera and microphone" })).toBeVisible();
});

test("AV-022 In a silent zone the list hides devices and offers no turn-on buttons", async ({ page }, testInfo) => {
    await join(page, roomUrl(testInfo, "tests/Areas/AreaFromTiledMap/map.json"), "Alice");
    await teleport(page, 850, 400);
    await expect(page.getByText("Silent zone", { exact: true })).toBeVisible();
    const list = await openDeviceList(page, testInfo);
    await expect(list.locator("button.device-row").filter({ hasNotText: /Output/ })).toHaveCount(0);
    await expect(list.getByText("Your camera is off")).toBeVisible();
    await expect(list.getByText("Your microphone is off")).toBeVisible();
    await expect(list.getByRole("button", { name: "Turn on camera" })).toHaveCount(0);
    await expect(list.getByRole("button", { name: "Turn on microphone" })).toHaveCount(0);
});

test("AV-023 Noise filter offers Standard and Strong; Strong gets ready or falls back", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "Chrome desktop row");
    const list = await openDeviceList(player, testInfo);
    const filter = list.getByTestId("noise-filter");
    await expect(filter.getByText("Noise filter")).toBeVisible();
    const standard = filter.getByRole("radio", { name: "Standard" });
    const strong = filter.getByRole("radio", { name: "Strong" });
    await expect(standard).toHaveAttribute("aria-checked", "true");
    await strong.click();
    await expect(filter.getByText(/Getting ready…|Also removes typing|Strong couldn't start in this browser, so Standard is on\./).first()).toBeVisible();
    await expect(filter.getByText(/Also removes typing, clicks and voices behind you|Strong couldn't start in this browser, so Standard is on\./)).toBeVisible({ timeout: 60_000 });
    await standard.click();
    await expect(standard).toHaveAttribute("aria-checked", "true");
    await expect(strong).toHaveAttribute("aria-checked", "false");
});

test("AV-025 AV-030 Background tab: mirrored preview, blur options, image tiles, no video backgrounds", async ({ player }, testInfo) => {
    const list = await openDeviceList(player, testInfo);
    await tapOrClick(player, testInfo, list.getByTestId("background-tab"));
    const preview = list.getByTestId("background-preview");
    await expect(preview.locator("video")).toBeVisible();
    await expect(preview.getByText("Only you see this")).toBeVisible();
    await expect.poll(() => preview.locator("video").evaluate((v) => getComputedStyle(v).transform)).toContain("matrix(-1");
    await expect(list.getByTestId("background-effects-unsupported")).toHaveCount(0);
    await expect(list.getByText("Blur", { exact: true })).toBeVisible();
    for (const name of ["None", "Light", "Medium", "Strong"]) {
        await expect(list.locator("button.opt", { hasText: name })).toBeVisible();
    }
    await expect(list.locator("button.opt", { hasText: "None" })).toHaveAttribute("aria-pressed", "true");
    await expect(list.getByText("Images", { exact: true })).toBeVisible();
    expect(await list.locator(".imgs button.th").count()).toBeGreaterThan(0);
    await expect(list.locator("[data-testid=background-tab] .tab-dot")).toHaveCount(0);

    for (const name of ["Waterfall", "Stars", "Matrix"]) {
        await expect(list.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(list.getByText("Background Videos")).toHaveCount(0);
    await expect(list.locator("video")).toHaveCount(1);
});

test("AV-027 With the camera off, the Background tab never turns it on", async ({ player }, testInfo) => {
    await tapOrClick(player, testInfo, player.getByTestId("camera-button"));
    await expectState(player, "camera-button", "forbidden");
    const list = await openDeviceList(player, testInfo);
    await tapOrClick(player, testInfo, list.getByTestId("background-tab"));
    await expect(
        list.getByText("Your camera is off. Pick an effect now and it's ready when you turn the camera on.")
    ).toBeVisible();
    await tapOrClick(player, testInfo, list.locator("button.opt", { hasText: "Medium" }));
    await expect(list.locator("button.opt", { hasText: "Medium" })).toHaveAttribute("aria-pressed", "true");
    await expect(list.locator("[data-testid=background-tab] .tab-dot")).toHaveCount(1);
    await player.waitForTimeout(1500);
    await expectState(player, "camera-button", "forbidden");
    await expect(list.getByTestId("background-preview").locator("video")).toHaveCount(0);
});

test("AV-032 @local Alone and idle, the camera stops; hovering the camera button brings it back", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "hover is a desktop action");
    const liveVideoTracks = () =>
        withFrontModule<number>(
            player,
            "src/front/Stores/MediaStore.ts",
            `m => new Promise((resolve) => {
                const stop = m.localStreamStore.subscribe((v) => {
                    resolve(v.type === "success" && v.stream ? v.stream.getVideoTracks().filter((t) => t.readyState === "live").length : 0);
                });
                setTimeout(stop, 0);
            })`
        );
    await player.mouse.move(700, 700);
    await expect.poll(liveVideoTracks, { timeout: 40_000, intervals: [2000] }).toBe(0);
    await player.getByTestId("camera-button").hover();
    await expect.poll(liveVideoTracks, { timeout: 15_000 }).toBe(1);
});
