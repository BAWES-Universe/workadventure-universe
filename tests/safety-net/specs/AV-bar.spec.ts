import { expect, isPhone, join, newPlayer, test } from "../lib/game";
import { boxOf, expectInBubble, joinBubble, openProfileMenu } from "../lib/av";

test("AV-001 Desktop bar sits across the top with its groups in order", async ({ player, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const chat = await boxOf(player.getByTestId("chat-action"));
    const mic = await boxOf(player.getByTestId("microphone-button"));
    const cam = await boxOf(player.getByTestId("camera-button"));
    const profile = await boxOf(player.getByTestId("action-user"));
    expect(mic.y).toBeLessThan(120);
    expect(chat.x).toBeLessThan(mic.x);
    expect(mic.x).toBeLessThan(cam.x);
    expect(cam.x).toBeLessThan(profile.x);
    expect(profile.x + profile.width).toBeGreaterThan(1440 - 200);

    const column = player.getByTestId("actions-explorer");
    const zoomIn = await boxOf(column.getByRole("button", { name: "Zoom In +" }));
    const zoomOut = await boxOf(column.getByRole("button", { name: "Zoom Out -" }));
    const overview = await boxOf(player.getByTestId("map-overview-button"));
    const express = await boxOf(player.getByTestId("express-button"));
    expect(zoomIn.y).toBeLessThan(zoomOut.y);
    expect(zoomOut.y).toBeLessThan(overview.y);
    expect(overview.y).toBeLessThan(express.y);
    expect(express.x + express.width).toBeGreaterThan(1440 - 120);
    expect(express.y + express.height).toBeGreaterThan(900 - 120);

    const bob = await joinBubble(browser, testInfo, player, url);
    const share = await boxOf(player.getByTestId("screenShareButton"));
    const pip = await boxOf(player.getByTestId("pictureInPictureButton"));
    expect(cam.x).toBeLessThan(share.x);
    expect(share.x).toBeLessThan(pip.x);
    expect(pip.x).toBeLessThan(profile.x);
    await bob.context().close();

    await player.getByTestId("chat-btn").click();
    await expect(player.getByTestId("chat")).toBeVisible();
    const micWithChat = await boxOf(player.getByTestId("microphone-button"));
    expect(micWithChat.y).toBeLessThan(120);
});

test("AV-002 Phone bar at the bottom: menu left, mic and cam centre, chat right, no share", async ({ player }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const mic = await boxOf(player.getByTestId("microphone-button"));
    const cam = await boxOf(player.getByTestId("camera-button"));
    const profile = await boxOf(player.getByTestId("action-user"));
    const chat = await boxOf(player.getByTestId("chat-btn"));
    const arrow = await boxOf(player.locator("button.device-arrow"));
    expect(mic.y).toBeGreaterThan(926 - 160);
    expect(profile.x).toBeLessThan(mic.x);
    expect(mic.x).toBeLessThan(cam.x);
    expect(chat.x).toBeGreaterThan(cam.x);
    expect(arrow.y + arrow.height).toBeLessThanOrEqual(mic.y + 2);
    await expect(player.getByTestId("screenShareButton")).toHaveCount(0);
    await expect(player.getByTestId("pictureInPictureButton")).toHaveCount(0);

    const column = player.getByTestId("actions-explorer");
    await expect(column.getByRole("button", { name: "Zoom In +" })).toHaveCount(0);
    await expect(column.getByRole("button", { name: "Zoom Out -" })).toHaveCount(0);
    const explore = await boxOf(player.getByTestId("explore-tile"));
    const overview = await boxOf(player.getByTestId("map-overview-button"));
    const express = await boxOf(player.getByTestId("express-button"));
    expect(explore.y).toBeLessThan(overview.y);
    expect(overview.y).toBeLessThan(express.y);
    expect(express.y + express.height).toBeLessThan(mic.y);
});

test("AV-003 Sideways phone: chat left, profile right, call buttons in the bar", async ({ page, url, browser }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await page.setViewportSize({ width: 926, height: 428 });
    await join(page, url, "Alice");
    const chat = await boxOf(page.getByTestId("chat-btn"));
    const mic = await boxOf(page.getByTestId("microphone-button"));
    const profile = await boxOf(page.getByTestId("action-user"));
    expect(mic.y).toBeGreaterThan(428 - 120);
    expect(chat.x).toBeLessThan(mic.x);
    expect(profile.x).toBeGreaterThan(mic.x);

    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await expectInBubble(page, "Bob");
    for (const id of ["follow-menu-item", "lock-button", "screenShareButton", "pictureInPictureButton"]) {
        const box = await boxOf(page.getByTestId(id).first());
        expect(Math.abs(box.y + box.height / 2 - (mic.y + mic.height / 2))).toBeLessThan(30);
    }
    await bob.context().close();
});

test("AV-004 Phone menu holds the contextual actions in a bubble; Follow closes it", async ({ player, url, browser }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const bob = await joinBubble(browser, testInfo, player, url);
    const menu = await openProfileMenu(player, testInfo);
    await expect(menu.getByText("contextual actions", { exact: false })).toBeVisible();
    for (const id of ["follow-menu-item", "lock-button", "screenShareButton", "pictureInPictureButton"]) {
        await expect(menu.getByTestId(id)).toBeVisible();
    }
    await menu.getByTestId("follow-menu-item").tap();
    await expect(menu).toBeHidden();
    await expect(player.getByTestId("follow-card")).toBeVisible();
    await bob.context().close();
});

test("AV-005 Narrow desktop bar moves Follow and Lock into the profile menu; nothing disappears", async ({ page, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await page.setViewportSize({ width: 600, height: 900 });
    await join(page, url, "Alice");
    const bob = await joinBubble(browser, testInfo, page, url);
    const menu = await openProfileMenu(page, testInfo);
    for (const id of ["follow-menu-item", "lock-button"]) {
        await expect(menu.getByTestId(id)).toBeVisible();
    }
    for (const id of ["screenShareButton", "pictureInPictureButton"]) {
        await expect(page.getByTestId(id).first()).toBeVisible();
    }
    await bob.context().close();
});

test("AV-006 Phone chat sheet hides the bar and the right column until it closes", async ({ player }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await expect(player.getByTestId("express-button")).toBeVisible();
    await player.getByTestId("chat-btn").tap();
    await expect(player.getByTestId("chat")).toBeVisible();
    await expect(player.getByTestId("microphone-button")).toBeHidden();
    await expect(player.getByTestId("actions-explorer")).toBeHidden();
    await expect(player.getByTestId("express-button")).toBeHidden();
    await player.getByTestId("chat").getByTestId("closeChatButton").first().tap();
    await expect(player.getByTestId("microphone-button")).toBeVisible();
    await expect(player.getByTestId("actions-explorer")).toBeVisible();
    await expect(player.getByTestId("express-button")).toBeVisible();
});

test("AV-007 Keyboard: bar buttons ring white and Enter/Space press them without opening Express", async ({ player }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const mic = player.getByTestId("microphone-button");
    await mic.focus();
    await player.keyboard.press("Shift+Tab");
    await player.keyboard.press("Tab");
    await expect(mic).toBeFocused();
    const ring = () => mic.evaluate((el) => getComputedStyle(el.querySelector(".u-ab-state") as Element).boxShadow);
    await expect.poll(ring).toContain("rgb(255, 255, 255)");

    await player.keyboard.press("Enter");
    await expect(mic).toHaveAttribute("data-state", "forbidden");
    await expect(player.getByTestId("express-tray")).toHaveCount(0);
    await player.keyboard.press("Space");
    await expect(mic).toHaveAttribute("data-state", "normal");

    await player.keyboard.press("Tab");
    const arrow = player.locator("button.device-arrow");
    await expect(arrow).toBeFocused();
    await expect(arrow).toHaveAttribute("aria-label", "Edit cam / mic");
    await player.keyboard.press("Enter");
    await expect(arrow).toHaveAttribute("aria-expanded", "true");
    await expect(player.getByTestId("express-tray")).toHaveCount(0);
});

test("AV-008 Hovering Share, PiP, Follow and Lock shows their help tooltip", async ({ player, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const bob = await joinBubble(browser, testInfo, player, url);
    const cases: [string, string][] = [
        ["screenShareButton", "Share your screen"],
        ["pictureInPictureButton", "Picture in picture"],
        ["follow-menu-item", "Ask to follow"],
        ["lock-button", "Lock conversation"],
    ];
    for (const [id, title] of cases) {
        const button = player.getByTestId(id).first();
        await button.hover();
        const tip = button.locator("xpath=..").locator(".text-lg", { hasText: title });
        await expect(tip).toBeVisible();
        if (id !== "pictureInPictureButton") await expect(button.locator("xpath=..").locator("video")).toHaveCount(1);
        await player.mouse.move(700, 600);
        await expect(tip).toHaveCount(0);
    }
    await openProfileMenu(player, testInfo);
    const share = player.getByTestId("screenShareButton").first();
    await share.hover();
    await player.waitForTimeout(800);
    await expect(share.locator("xpath=..").locator(".text-lg", { hasText: "Share your screen" })).toHaveCount(0);
    await bob.context().close();
});
