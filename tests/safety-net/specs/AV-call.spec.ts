import type { Page } from "@playwright/test";
import { expect, isPhone, join, newPlayer, roomUrl, test, wa } from "../lib/game";
import {
    boxOf,
    expectInBubble,
    expectNoBubble,
    expectState,
    joinBubble,
    openProfileMenu,
    tapOrClick,
    teleport,
} from "../lib/av";

function tileOf(page: Page, name: string) {
    return page.locator("#cameras-container .camera-box").filter({ hasText: name });
}

async function staysOutOfBubble(page: Page, name: string) {
    for (let i = 0; i < 6; i++) {
        await expect(page.locator("#cameras-container").getByText(name, { exact: true })).toHaveCount(0);
        await page.waitForTimeout(1000);
    }
}

async function openTileMenu(page: Page, name: string) {
    const tile = tileOf(page, name);
    await tile.hover();
    await tile.locator("button.user-menu-btn").click();
    const menu = page.getByRole("group", { name: "Volume control" }).locator("xpath=..");
    await expect(menu).toBeVisible();
    return menu;
}

async function dragHandle(page: Page, dy: number) {
    const handle = await boxOf(page.getByTestId("resize-handle"));
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy / 2, { steps: 5 });
    await page.mouse.move(x, y + dy, { steps: 5 });
    await page.mouse.up();
}

async function playVideos(page: Page, count: number) {
    const src = new URL("/static/Videos/Chat.mp4", page.url()).toString();
    for (let i = 0; i < count; i++) {
        await wa(page, async (url) => {
            await WA.ui.playVideo(url, { name: "Clip" });
        }, src);
    }
}

test("AV-033 AV-034 Walking up forms a bubble with both videos; walking away closes it", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await expect(player.locator("#cameras-container").getByText("You", { exact: true })).toBeVisible();
    await expect(bob.locator("#cameras-container").getByText("You", { exact: true })).toBeVisible();
    await expect(tileOf(player, "Bob").locator("video")).toHaveCount(1);
    await expect(player.locator("audio").first()).toBeAttached();
    await teleport(bob, 290, 20);
    await expectNoBubble(player);
    await expectNoBubble(bob);
    await bob.context().close();
});

test("AV-036 AV-037 Lock keeps a third player out; unlock lets them in", async ({ player, url, browser }, testInfo) => {
    test.slow();
    const bob = await joinBubble(browser, testInfo, player, url);
    const lock = async () => {
        if (isPhone(testInfo)) {
            const menu = await openProfileMenu(player, testInfo);
            await menu.getByTestId("lock-button").tap();
            if (await menu.isVisible()) await player.getByTestId("action-user").locator("button.profile-button").tap();
        } else {
            await player.getByTestId("lock-button").click();
        }
    };
    await lock();
    if (!isPhone(testInfo)) {
        await expectState(player, "lock-button", "forbidden");
        await expect(player.getByTestId("lock-button")).toContainText("Unlock");
    } else {
        const menu = await openProfileMenu(player, testInfo);
        await expect(menu.getByTestId("lock-button")).toHaveAttribute("data-state", "forbidden");
        await player.getByTestId("action-user").locator("button.profile-button").tap();
    }

    const carol = await newPlayer(browser, testInfo, url, "Carol");
    await staysOutOfBubble(player, "Carol");
    await expect(carol.locator("#cameras-container .camera-box")).toHaveCount(0);

    await lock();
    if (!isPhone(testInfo)) await expectState(player, "lock-button", "normal");
    await teleport(carol, 60, 150);
    await teleport(carol, 20, 144);
    await expectInBubble(player, "Carol");
    await expectInBubble(carol, "Alice");
    await carol.context().close();
    await bob.context().close();
});

test("AV-038 Nobody can start a bubble with a player in Do not disturb", async ({ player, url, browser }, testInfo) => {
    await openProfileMenu(player, testInfo);
    await tapOrClick(player, testInfo, player.getByTestId("profile-menu").locator(".status-button", { hasText: "Do not disturb" }).last());
    await expectState(player, "microphone-button", "disabled");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await staysOutOfBubble(player, "Bob");
    await expect(bob.locator("#cameras-container .camera-box")).toHaveCount(0);
    await expectState(player, "microphone-button", "disabled");
    await expectState(player, "camera-button", "disabled");
    await bob.context().close();
});

test("AV-039 AV-040 Maximise shows a video big; full screen hides the strip and Express; minimise returns it", async ({ player, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const bob = await joinBubble(browser, testInfo, player, url);
    const tile = tileOf(player, "Bob");
    await tile.hover();
    await tile.locator(".full-screen-button").click();
    const big = player.locator("#highlighted-media");
    await expect(big.getByText("Bob")).toBeVisible();
    await expect(tileOf(player, "Bob")).toHaveCount(0);
    await expect(player.locator("#cameras-container").getByText("You", { exact: true })).toBeVisible();

    await big.hover();
    await big.locator("button.muted-video").click();
    await expect(player.getByTestId("express-button")).toHaveCount(0);
    await expect(player.locator("#cameras-container").getByText("You", { exact: true })).toBeHidden();
    await player.mouse.move(720, 300);
    await player.locator("button.muted-video").click();
    await expect(player.getByTestId("express-button")).toBeVisible();
    await expect(player.locator("#cameras-container").getByText("You", { exact: true })).toBeVisible();

    await big.hover();
    await big.locator("button.svg").first().click();
    await expect(player.locator("#highlighted-media").getByText("Bob")).toHaveCount(0);
    await expect(tileOf(player, "Bob")).toBeVisible();
    await bob.context().close();
});

test("AV-041 AV-042 Tile menu lists volume and asks; the volume mutes that person for you only", async ({ player, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover menu)");
    const bob = await joinBubble(browser, testInfo, player, url);
    const menu = await openTileMenu(player, "Bob");
    await expect(menu.getByText("Ask to mute audio")).toBeVisible();
    await expect(menu.getByText("Ask to mute video")).toBeVisible();
    await expect(menu.getByText("Moderation")).toBeVisible();
    await expect(menu.getByRole("slider")).toBeVisible();

    const volumes = (page: Page) => page.evaluate(() => [...document.querySelectorAll("audio")].map((a) => a.volume));
    await expect.poll(async () => Math.max(...(await volumes(player)))).toBe(1);
    await menu.getByRole("group", { name: "Volume control" }).locator("button").first().click();
    await expect.poll(async () => Math.max(...(await volumes(player)))).toBe(0);
    await expect.poll(async () => Math.max(...(await volumes(bob)))).toBe(1);
    await menu.getByRole("group", { name: "Volume control" }).locator("button").first().click();
    await expect.poll(async () => Math.max(...(await volumes(player)))).toBe(1);

    await player.mouse.move(700, 800);
    await expect(player.getByRole("group", { name: "Volume control" })).toHaveCount(0);
    await bob.context().close();
});

test("AV-043 Ask to mute audio and video: the other player answers Yes and is muted", async ({ player, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover menu)");
    const bob = await joinBubble(browser, testInfo, player, url);
    let menu = await openTileMenu(player, "Bob");
    await menu.getByText("Ask to mute audio").click();
    await expect(bob.getByText("Can I mute your microphone?").first()).toBeVisible();
    await expect(bob.getByRole("button", { name: "No", exact: true }).first()).toBeVisible();
    await bob.getByRole("button", { name: "Yes", exact: true }).first().click();
    await expectState(bob, "microphone-button", "forbidden");

    menu = await openTileMenu(player, "Bob");
    await menu.getByText("Ask to mute video").click();
    await expect(bob.getByText("Can I mute your camera?").first()).toBeVisible();
    await bob.getByRole("button", { name: "Yes", exact: true }).first().click();
    await expectState(bob, "camera-button", "forbidden");
    await bob.context().close();
});

test("AV-045 Tile menu Moderation opens Block or report for that person", async ({ player, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover menu)");
    const bob = await joinBubble(browser, testInfo, player, url);
    const menu = await openTileMenu(player, "Bob");
    await menu.getByText("Moderation").click();
    await expect(player.getByTestId("blockmenu-block-user-button")).toBeVisible();
    await expect(player.getByTestId("blockmenu-block-user-button")).toContainText("Bob");
    await bob.context().close();
});

test("AV-046 The fake mic makes the other player's tile show the sound meter and the talking edge", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await expect(tileOf(bob, "Alice").locator(".voice-meter-cam-off")).toBeAttached();
    await expect(tileOf(bob, "Alice").locator(".border-secondary").first()).toBeAttached({ timeout: 20_000 });
    await tapOrClick(player, testInfo, player.getByTestId("microphone-button"));
    await expect(tileOf(bob, "Alice").locator(".voice-meter-cam-off")).toHaveCount(0);
    await expect(bob.getByTestId("Alice is muted.")).toBeVisible();
    await bob.context().close();
});

test("AV-048 AV-049 White bar resizes the video area, is remembered, and small videos show names on hover", async ({ player, url, browser }, testInfo) => {
    test.slow();
    test.skip(isPhone(testInfo), "desktop only");
    const bob = await joinBubble(browser, testInfo, player, url);
    const container = player.getByTestId("cameras-container");
    await expect(container).toHaveAttribute("data-phone-layout", "videos");
    const before = (await boxOf(player.getByTestId("resize-handle"))).y;
    await dragHandle(player, 150);
    await expect.poll(async () => (await boxOf(player.getByTestId("resize-handle"))).y).toBeGreaterThan(before + 100);
    const tile = await boxOf(tileOf(player, "Bob"));
    expect(tile.width).toBeGreaterThanOrEqual(160);
    expect(Math.abs(tile.width / tile.height - 16 / 9)).toBeLessThan(0.1);
    const grown = (await boxOf(player.getByTestId("resize-handle"))).y;

    await player.reload();
    if (await player.getByTestId("loginSceneNameInput").isVisible({ timeout: 10_000 }).catch(() => false)) {
        await join(player, url, "Alice");
    }
    await expectInBubble(player, "Bob");
    await expect.poll(async () => (await boxOf(player.getByTestId("resize-handle"))).y, { timeout: 20_000 }).toBeGreaterThan(grown - 30);

    await dragHandle(player, -2000);
    await expect(container).toHaveAttribute("data-phone-layout", "small");
    const small = player.locator("#cameras-container .video-small");
    await expect(small).toHaveCount(2);
    const name = player.locator(".small-name[data-name='Bob']");
    await expect(name).toHaveCSS("opacity", "0");
    await name.locator("xpath=..").hover();
    await expect(name).toHaveCSS("opacity", "1");
    const box = await boxOf(small.first());
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.15);
    await bob.context().close();
});

test("AV-050 Over the video limit the last spot is a +N tile that shows everyone", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "covered on phones by AV-051");
    await page.addInitScript(() => {
        let value: Record<string, unknown> | undefined;
        Object.defineProperty(window, "env", {
            configurable: true,
            get: () => value,
            set: (v) => {
                value = { ...v, MAX_DISPLAYED_VIDEOS: 2 };
            },
        });
    });
    await join(page, roomUrl(testInfo), "Alice");
    await playVideos(page, 4);
    const more = page.getByTestId("more-people");
    await expect(more).toBeVisible({ timeout: 30_000 });
    await expect(more).toHaveAttribute("aria-label", /Show everyone \(\d+ more\)/);
    await expect(more).toContainText("+");
    await more.click();
    await expect(more).toBeHidden();
    await expect
        .poll(() =>
            page
                .locator("#cameras-container .camera-box:not(.more-people)")
                .evaluateAll((boxes) => boxes.filter((b) => getComputedStyle(b).display !== "none").length)
        )
        .toBeGreaterThanOrEqual(4);
    await dragHandle(page, 40);
    await expect(more).toBeVisible();
});

test("AV-051 AV-052 Phone upright: rows layout in a bubble; with the chat open videos sit above it and maximise closes chat", async ({ player, url, browser }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const bob = await joinBubble(browser, testInfo, player, url);
    await expect(player.getByTestId("cameras-container")).toHaveAttribute("data-phone-layout", /videos|small/);

    await player.getByTestId("chat-btn").tap();
    const chat = player.getByTestId("chat");
    await expect(chat).toBeVisible();
    await expect(player.locator("#highlighted-media").getByText("Bob")).toHaveCount(0);
    const chatBox = await boxOf(chat);
    const videos = await boxOf(tileOf(player, "Bob"));
    expect(videos.y + videos.height).toBeLessThanOrEqual(chatBox.y + 2);
    await tileOf(player, "Bob").locator(".full-screen-button").tap();
    await expect(chat).toBeHidden();
    await expect(player.locator("#highlighted-media").getByText("Bob")).toBeVisible();
    await bob.context().close();
});

test("AV-053 Sideways phone keeps the old video layout", async ({ page, url, browser }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await page.setViewportSize({ width: 926, height: 428 });
    await join(page, url, "Alice");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await expectInBubble(page, "Bob");
    await expect(page.getByTestId("cameras-container")).not.toHaveAttribute("data-phone-layout", /.+/);
    await bob.context().close();
});

test("AV-054 Walking in a bubble collapses the videos to one line, then they come back", async ({ player, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const bob = await joinBubble(browser, testInfo, player, url);
    await expect(player.getByTestId("resize-handle")).toBeVisible();
    await player.keyboard.down("ArrowDown");
    await player.waitForTimeout(250);
    await player.keyboard.up("ArrowDown");
    await expect(player.getByTestId("resize-handle")).toHaveCount(0);
    await expect(player.getByTestId("cameras-container")).not.toHaveAttribute("data-phone-layout", /.+/);
    await expect(player.getByTestId("resize-handle")).toBeVisible({ timeout: 20_000 });
    await bob.context().close();
});

test("AV-055 AV-058 Desktop screen share: two You tiles, the other sees it big; never small in rows", async ({ player, url, browser }, testInfo) => {
    test.slow();
    test.skip(isPhone(testInfo), "desktop only");
    const bob = await joinBubble(browser, testInfo, player, url);
    await player.getByTestId("screenShareButton").click();
    await expectState(player, "screenShareButton", "active");
    await expect(player.locator("#cameras-container").getByText("You", { exact: true })).toHaveCount(2);
    await expect(bob.locator("#highlighted-media").getByText("Alice")).toBeVisible();

    await dragHandle(player, -2000);
    await expect(player.getByTestId("cameras-container")).not.toHaveAttribute("data-phone-layout", "small");
    await expect(player.locator("#cameras-container .video-small")).toHaveCount(0);

    await player.getByTestId("screenShareButton").click();
    await expectState(player, "screenShareButton", "normal");
    await expect(player.locator("#cameras-container").getByText("You", { exact: true })).toHaveCount(1);
    await expect(bob.locator("#highlighted-media").getByText("Alice")).toHaveCount(0);
    await bob.context().close();
});

test("AV-056 AV-062 Phone menu has Share screen and Picture in picture in a bubble", async ({ player, url, browser }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const bob = await joinBubble(browser, testInfo, player, url);
    const menu = await openProfileMenu(player, testInfo);
    await expect(menu.getByTestId(/^pictureInPictureButton(Disabled)?$/)).toBeVisible();
    await menu.getByTestId("screenShareButton").tap();
    await expect(bob.locator("#highlighted-media").getByText("Alice")).toBeVisible();
    await bob.context().close();
});

test("AV-057 In a silent zone Share screen starts nothing", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, roomUrl(testInfo, "tests/Areas/AreaFromTiledMap/map.json"), "Alice");
    await teleport(page, 850, 400);
    await expect(page.getByText("Silent zone", { exact: true })).toBeVisible();
    await expect(page.getByTestId("screenShareButton")).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page.locator("#cameras-container").getByText("You", { exact: true })).toHaveCount(0);
});

test("AV-059 Desktop PiP opens a floating window with the call and closes on a second click", async ({ player, url, browser }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const bob = await joinBubble(browser, testInfo, player, url);
    await player.evaluate(() => localStorage.setItem("allowPictureInPicture", "false"));
    const popup = player.waitForEvent("popup");
    await player.getByTestId("pictureInPictureButton").click();
    const pip = await popup;
    await expect(pip.getByText("Bob")).toBeVisible();
    await expect(pip.getByText("You")).toBeVisible();
    await expectState(player, "pictureInPictureButton", "active");
    expect(await player.evaluate(() => localStorage.getItem("allowPictureInPicture"))).toBe("true");
    await player.getByTestId("pictureInPictureButton").click();
    await expect.poll(() => pip.isClosed()).toBe(true);
    await expectState(player, "pictureInPictureButton", "normal");
    await bob.context().close();
});
