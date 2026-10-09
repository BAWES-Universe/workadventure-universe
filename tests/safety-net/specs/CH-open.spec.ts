import { test, expect, isPhone, inRoom, newPlayer, wamRoom, join } from "../lib/game";
import {
    alice,
    bobApart,
    chat,
    chatSettled,
    closeChat,
    dragHandle,
    meet,
    openChat,
    send,
    position,
    sheetHeight,
    teleport,
    CORNER,
} from "../lib/ch";

test("CH-001 Desktop chat button opens a floating panel on Chats, the bar's X closes it", async ({
    page,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const player = await alice(page, url);
    await player.getByTestId("chat-btn").click();
    await expect(chat(player)).toBeVisible();
    await expect(player.getByTestId("chatTabChats")).toHaveAttribute("aria-selected", "true");
    await expect(player.getByTestId("chat-btn")).toBeHidden();
    const box = await chat(player).boundingBox();
    expect(box?.x).toBe(16);
    const vh = player.viewportSize()!.height;
    expect(Math.round(box!.y + box!.height)).toBe(vh - 16);
    const barX = player.locator("[data-testid=chat-action] [data-testid=closeChatButton]");
    await expect(barX).toBeVisible();
    await barX.click();
    await expect(chat(player)).toBeHidden();
    await expect(player.getByTestId("chat-btn")).toBeVisible();
});

test("CH-002 C and U open, switch and close the chat, not while the map editor is on", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (keyboard)");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    // Phaser keeps key events queued until its next frame ends; on this loaded machine a frame can take longer than
    // the gap between two presses, and the queued earlier press is then replayed. Let a frame pass before each press.
    const blur = () =>
        page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
            return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        });
    const chats = page.getByTestId("chatTabChats");
    const people = page.getByTestId("chatTabPeople");

    await blur();
    await page.keyboard.press("c");
    await expect(chat(page)).toBeVisible();
    await expect(chats).toHaveAttribute("aria-selected", "true");
    await blur();
    await page.keyboard.press("c");
    await expect(chat(page)).toBeHidden();

    await blur();
    await page.keyboard.press("u");
    await expect(chat(page)).toBeVisible();
    await expect(people).toHaveAttribute("aria-selected", "true");
    await blur();
    await page.keyboard.press("c");
    await expect(chat(page)).toBeVisible();
    await expect(chats).toHaveAttribute("aria-selected", "true");
    await blur();
    await page.keyboard.press("u");
    await expect(people).toHaveAttribute("aria-selected", "true");
    await blur();
    await page.keyboard.press("u");
    await expect(chat(page)).toBeHidden();

    await blur();
    await page.keyboard.press("e");
    await expect(page.getByTestId("closeMapEditorButton")).toBeVisible();
    await blur();
    await page.keyboard.press("c");
    await blur();
    await page.keyboard.press("u");
    await blur();
    await expect(page.getByTestId("closeMapEditorButton")).toBeVisible();
    await expect(chat(page)).toBeHidden();
});

test("CH-003 Desktop People button opens the chat on People, hidden on a bar under 640px", async ({
    page,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const player = await alice(page, url);
    await player.getByTestId("user-list-button").click();
    await expect(chat(player)).toBeVisible();
    await expect(player.getByTestId("chatTabPeople")).toHaveAttribute("aria-selected", "true");
    await expect(player.getByTestId("peopleList")).toBeVisible();
    await closeChat(player);
    await player.setViewportSize({ width: 600, height: 900 });
    await expect(player.getByTestId("chat-btn")).toBeVisible();
    await expect(player.getByTestId("user-list-button")).toBeHidden();
});

test("CH-004 Phone: chat button bottom-right, sheet opens at 60% and hides the bar", async ({
    page,
    url,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const player = await alice(page, url);
    const { width, height } = player.viewportSize()!;
    const chatBtn = await player.getByTestId("chat-btn").boundingBox();
    const profile = await player.getByTestId("action-user").boundingBox();
    expect(chatBtn!.x).toBeGreaterThan(width / 2);
    expect(chatBtn!.y).toBeGreaterThan(height / 2);
    expect(profile!.x + profile!.width).toBeLessThan(width / 2);
    expect(profile!.y).toBeGreaterThan(height / 2);
    const express = await player.getByTestId("express-button").boundingBox();
    expect(express!.y + express!.height).toBeLessThanOrEqual(chatBtn!.y);
    expect(Math.abs(express!.x + express!.width / 2 - (chatBtn!.x + chatBtn!.width / 2))).toBeLessThan(chatBtn!.width);

    await player.getByTestId("chat-btn").tap();
    const sheet = player.locator("section#chat.chat-sheet");
    await expect(sheet).toBeVisible();
    await expect(player.getByTestId("chatSheetHandle")).toBeVisible();
    await expect.poll(() => sheetHeight(player)).toBe(Math.round(height * 0.6));
    expect(await sheet.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("24px");
    await expect(player.getByTestId("chat-btn")).toBeHidden();
    await expect(player.getByTestId("microphone-button")).toBeHidden();
});

test("CH-005 Phone: the sheet follows a drag, can cover the screen, and stays where it is let go", async ({
    page,
    url,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const player = await alice(page, url);
    const height = player.viewportSize()!.height;
    await openChat(player);
    await expect.poll(() => sheetHeight(player)).toBe(Math.round(height * 0.6));
    const handleY = (await player.getByTestId("chatSheetHandle").boundingBox())!.y;
    await dragHandle(player, -(handleY + 10));
    await expect.poll(() => sheetHeight(player)).toBe(height);
    expect((await chat(player).boundingBox())!.y).toBe(0);
    await dragHandle(player, height / 2);
    await expect.poll(() => sheetHeight(player)).toBe(height / 2);
    await player.waitForTimeout(500);
    expect(Math.abs((await sheetHeight(player)) - height / 2)).toBeLessThanOrEqual(2);
});

test("CH-006 Phone: dragging the sheet well below its lowest height closes the chat", async ({
    page,
    url,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const player = await alice(page, url);
    await openChat(player);
    await expect(player.getByTestId("chat-btn")).toBeHidden();
    await dragHandle(player, 400);
    await expect(chat(player)).toBeHidden();
    await expect(player.getByTestId("chat-btn")).toBeVisible();
});

test("CH-007 Phone: tapping the handle steps through the snaps", async ({ page, url }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const player = await alice(page, url);
    const h = player.viewportSize()!.height;
    const peek = Math.min(Math.round(h / 2), Math.max(240, Math.round(h * 0.34)));
    const half = Math.round(h * 0.6);
    await openChat(player);
    await expect.poll(() => sheetHeight(player)).toBe(half);
    const handle = player.getByTestId("chatSheetHandle");
    await handle.tap();
    await expect.poll(() => sheetHeight(player)).toBe(h);
    await handle.tap();
    await expect.poll(() => sheetHeight(player)).toBe(peek);
    await handle.tap();
    await expect.poll(() => sheetHeight(player)).toBe(half);
});

test("CH-008 Phone: the sheet reopens at the height it was left at, after a reload", async ({
    page,
    url,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const player = await alice(page, url);
    const h = player.viewportSize()!.height;
    await openChat(player);
    await expect.poll(() => sheetHeight(player)).toBe(Math.round(h * 0.6));
    await dragHandle(player, -Math.round(h * 0.2));
    await expect.poll(() => sheetHeight(player)).toBe(Math.round(h * 0.8));
    const kept = Number(await player.evaluate(() => localStorage.getItem("chatSheetRest")));
    expect(kept).toBeCloseTo(0.8, 2);
    await closeChat(player);
    await player.reload();
    await inRoom(player);
    await openChat(player);
    await expect.poll(() => sheetHeight(player)).toBe(Math.round(h * 0.8));
});

test("CH-009 Phone: a message in a bubble opens a low sheet that shows it whole", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const player = await alice(page, url);
    const h = player.viewportSize()!.height;
    const peek = Math.min(Math.round(h / 2), Math.max(240, Math.round(h * 0.34)));
    const bob = await bobApart(browser, testInfo, player, url);
    await meet(player, bob);
    await openChat(bob);
    await expect(bob.getByTestId("roomName")).toHaveText("Proximity Chat", { timeout: 30_000 });
    await expect(chat(player)).toBeHidden();
    await send(bob, "see you at the demo");
    await expect(chat(player)).toBeVisible({ timeout: 20_000 });
    const msg = chat(player).locator("li[data-event-id]").filter({ hasText: "see you at the demo" });
    await expect(msg).toBeVisible();
    await player.waitForTimeout(500);
    const height = await sheetHeight(player);
    expect(height).toBeGreaterThanOrEqual(peek);
    expect(height).toBeLessThan(Math.round(h * 0.6));
    const msgBox = await msg.boundingBox();
    const inputBox = await player.getByTestId("messageInput").boundingBox();
    const sheetBox = await chat(player).boundingBox();
    expect(msgBox!.y).toBeGreaterThanOrEqual(sheetBox!.y);
    expect(msgBox!.y + msgBox!.height).toBeLessThanOrEqual(inputBox!.y);
});

test("CH-011 Phone sideways: the chat is a side panel, not a sheet, and an X closes it", async ({
    page,
    url,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const player = await alice(page, url);
    await player.setViewportSize({ width: 926, height: 428 });
    await openChat(player);
    await expect(player.locator("section#chat.chat-sheet")).toHaveCount(0);
    await expect(player.getByTestId("chatSheetHandle")).toHaveCount(0);
    const box = (await chat(player).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.height).toBe(428);
    expect(box.width).toBeLessThan(926 / 2);
    await expect(player.getByTestId("chatTabChats")).toBeVisible();
    await expect(player.getByTestId("chat-btn")).toBeHidden();
    const x = player.getByTestId("closeChatButton").locator("visible=true");
    await expect(x).toHaveCount(1);
    await x.click();
    await expect(chat(player)).toBeHidden();
    await expect(player.getByTestId("chat-btn")).toBeVisible();
});

test("CH-012 Desktop: the panel's edge handle resizes, is kept, and double-click toggles full width", async ({
    page,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const player = await alice(page, url);
    await openChat(player);
    await chatSettled(player);
    const bar = player.locator("#resize-bar");
    const start = (await chat(player).boundingBox())!.width;
    const b = (await bar.boundingBox())!;
    await player.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await player.mouse.down();
    await player.mouse.move(b.x + 150, b.y + b.height / 2, { steps: 5 });
    await expect(bar).toHaveCSS("background-color", "rgb(167, 139, 250)");
    await player.mouse.up();
    await expect.poll(async () => (await chat(player).boundingBox())!.width).toBeGreaterThan(start + 100);
    const widened = Math.round((await chat(player).boundingBox())!.width);
    await closeChat(player);
    await openChat(player);
    await chatSettled(player);
    await expect.poll(async () => Math.round((await chat(player).boundingBox())!.width)).toBe(widened);

    const b2 = (await bar.boundingBox())!;
    await player.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await player.mouse.down();
    await player.mouse.move(0, b2.y + b2.height / 2, { steps: 5 });
    await player.mouse.up();
    await expect.poll(async () => Math.round((await chat(player).boundingBox())!.width)).toBe(200);

    const vw = player.viewportSize()!.width;
    await bar.dblclick();
    await expect.poll(async () => Math.round((await chat(player).boundingBox())!.width)).toBe(vw - 32);
    await bar.dblclick();
    await expect.poll(async () => Math.round((await chat(player).boundingBox())!.width)).toBe(335);
});

test("CH-013 Desktop: a wide panel shows list and thread side by side, a narrow one has a back arrow", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const player = await alice(page, url);
    await openChat(player);
    await chatSettled(player);
    await expect(player.getByTestId("chatBackward")).toHaveCount(0);
    const bar = player.locator("#resize-bar");
    const b = (await bar.boundingBox())!;
    await player.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await player.mouse.down();
    await player.mouse.move(b.x + 500, b.y + b.height / 2, { steps: 5 });
    await player.mouse.up();
    await expect.poll(async () => (await chat(player).boundingBox())!.width).toBeGreaterThan(670);
    await expect(chat(player).getByText("Open a conversation")).toBeVisible();

    const bob = await bobApart(browser, testInfo, player, url);
    await meet(player, bob);
    await expect(player.getByTestId("roomName")).toHaveText("Proximity Chat", { timeout: 30_000 });
    await expect(player.getByTestId("proximityTopRow")).toBeVisible();
    await expect(chat(player).getByText("Open a conversation")).toBeHidden();
    const list = (await player.getByTestId("proximityTopRow").boundingBox())!;
    const title = (await player.getByTestId("roomName").boundingBox())!;
    expect(Math.round(list.width)).toBeLessThanOrEqual(335);
    expect(title.x).toBeGreaterThan(list.x + list.width - 5);

    await bar.dblclick();
    await expect
        .poll(async () => Math.round((await chat(player).boundingBox())!.width))
        .toBe(player.viewportSize()!.width - 32);
    await bar.dblclick();
    await expect.poll(async () => Math.round((await chat(player).boundingBox())!.width)).toBe(335);
    await expect(player.getByTestId("roomName")).toBeVisible();
    await expect(player.getByTestId("proximityTopRow")).toBeHidden();
    await player.getByTestId("chatBackward").click();
    await expect(player.getByTestId("proximityTopRow")).toBeVisible();
    await expect(player.getByTestId("roomName")).toBeHidden();
});

test("CH-014 Tabs switch by click, by dragging the pill and by arrow keys", async ({ player }, testInfo) => {
    await openChat(player);
    const chats = player.getByTestId("chatTabChats");
    const people = player.getByTestId("chatTabPeople");
    const tablist = player.getByRole("tablist");
    await expect(chats).toHaveAttribute("aria-selected", "true");
    await expect(tablist).toHaveAttribute("data-active", "chats");
    if (isPhone(testInfo)) await people.tap();
    else await people.click();
    await expect(people).toHaveAttribute("aria-selected", "true");
    await expect(tablist).toHaveAttribute("data-active", "people");
    if (isPhone(testInfo)) await chats.tap();
    else await chats.click();
    await expect(chats).toHaveAttribute("aria-selected", "true");

    const c = (await chats.boundingBox())!;
    const p = (await people.boundingBox())!;
    const y = c.y + c.height / 2;
    await player.mouse.move(c.x + c.width / 2, y);
    await player.mouse.down();
    await player.mouse.move(p.x + p.width / 2, y, { steps: 8 });
    await player.mouse.up();
    await expect(people).toHaveAttribute("aria-selected", "true");
    await expect(tablist).toHaveAttribute("data-active", "people");

    test.skip(isPhone(testInfo), "arrow keys: desktop only");
    const walkedFrom = await position(player);
    await people.focus();
    await player.keyboard.press("ArrowLeft");
    await expect(chats).toHaveAttribute("aria-selected", "true");
    await expect(chats).toBeFocused();
    await player.keyboard.press("ArrowRight");
    await expect(people).toHaveAttribute("aria-selected", "true");
    await expect(people).toBeFocused();
    expect(await position(player)).toEqual(walkedFrom);
});

test("CH-015 The People tab counts everyone online in this world", async ({ player, browser, url }, testInfo) => {
    test.slow();
    await teleport(player, CORNER);
    await openChat(player);
    const count = player.getByTestId("chatTabPeopleCount");
    await expect(count).toHaveText(/^\d+$/);
    const before = Number(await count.textContent());
    expect(before).toBeGreaterThanOrEqual(1);
    await expect(count).toHaveAttribute("title", `${before} people online in this world`);
    // Every local map shares one world, and other suites' players come and go in it. A leave can hide Bob's +1 for a
    // moment, so the join is retried with a fresh Bob; a pill that never counts a newcomer still fails every attempt.
    await expect(async () => {
        const base = Number(await count.textContent());
        const bob = await newPlayer(browser, testInfo, url, "Bob");
        try {
            await expect.poll(async () => Number(await count.textContent()), { timeout: 20_000 }).toBeGreaterThan(base);
        } catch (e) {
            await bob.context().close();
            throw e;
        }
    }).toPass({ timeout: 200_000 });
    const after = Number(await count.textContent());
    await expect(count).toHaveAttribute("title", `${after} people online in this world`);
});

test("CH-016 Alone: no live card, a Say hi in person card whose button opens People", async ({ player }) => {
    await teleport(player, CORNER);
    await openChat(player);
    await expect(player.getByTestId("proximityTopRow")).toBeHidden();
    const hint = player.getByTestId("nearbyHint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("Say hi in person");
    const btn = player.getByTestId("nearbyHintPeople");
    await expect(btn).toHaveText(/See who's here/);
    await btn.click();
    await expect(player.getByTestId("chatTabPeople")).toHaveAttribute("aria-selected", "true");
    await expect(player.getByTestId("peopleList")).toBeVisible();
});

test("CH-106 Desktop, mic and camera off: joining a bubble opens the proximity thread by itself", async ({
    player,
    browser,
    url,
}, testInfo) => {
    await player.getByTestId("camera-button").click();
    await player.getByTestId("microphone-button").click();
    const bob = await bobApart(browser, testInfo, player, url);
    await expect(chat(player)).toBeHidden();
    await meet(player, bob);
    if (isPhone(testInfo)) {
        await player.waitForTimeout(5_000);
        await expect(chat(player)).toBeHidden();
        return;
    }
    await expect(chat(player)).toBeVisible({ timeout: 20_000 });
    await expect(player.getByTestId("roomName")).toHaveText("Proximity Chat");
    await expect(player.getByTestId("messageInput")).toBeVisible();
});
