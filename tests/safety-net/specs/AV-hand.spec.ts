import type { Page } from "@playwright/test";
import { expect, isPhone, newPlayer, test } from "../lib/game";
import { boxOf, expectInBubble, expectNoBubble, joinBubble, tapOrClick, teleport } from "../lib/av";

function handButton(page: Page) {
    return page.getByTestId("raise-hand-button");
}

async function muteMic(page: Page, testInfo: Parameters<typeof tapOrClick>[1]) {
    await tapOrClick(page, testInfo, page.getByTestId("microphone-button"));
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "forbidden");
}

test("AV-063 The hand button appears only in a bubble, between the zoom column and Express", async ({ player, url, browser }, testInfo) => {
    const slot = player.locator(".hand-slot");
    await expect(slot).not.toHaveClass(/shown/);
    await expect(handButton(player)).toBeHidden();
    const pillBefore = await boxOf(player.getByTestId("actions-explorer"));

    const bob = await joinBubble(browser, testInfo, player, url);
    await expect(slot).toHaveClass(/shown/);
    await expect(handButton(player)).toBeVisible();
    const hand = await boxOf(handButton(player));
    const express = await boxOf(player.getByTestId("express-button"));
    await expect.poll(async () => (await boxOf(player.getByTestId("actions-explorer"))).y).toBeLessThan(pillBefore.y - 40);
    const pill = await boxOf(player.getByTestId("actions-explorer"));
    expect(hand.y).toBeGreaterThan(pill.y + pill.height - 2);
    expect(hand.y + hand.height).toBeLessThanOrEqual(express.y + 2);
    expect(Math.abs(hand.width - express.width)).toBeLessThan(2);

    await teleport(bob, 290, 20);
    await expectNoBubble(player);
    await expect(slot).not.toHaveClass(/shown/);
    await expect(handButton(player)).toBeHidden();
    await bob.context().close();
});

test("AV-064 AV-065 AV-066 Raising a hand: gold button with place in line, tile chip for others, pill with the list", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await muteMic(player, testInfo);
    await tapOrClick(player, testInfo, handButton(player));
    await expect(handButton(player)).toHaveAttribute("aria-pressed", "true");
    await expect(handButton(player)).toHaveClass(/\bup\b/);
    await expect(player.getByTestId("raise-hand-position")).toHaveText("1");
    await expect(handButton(player)).toHaveAttribute("aria-label", "Lower hand · you're next");

    const chip = bob.getByTestId("video-hand-position");
    await expect(chip).toHaveAttribute("aria-label", "Alice raised their hand, number 1 in line");
    await expect(chip).toContainText("✋");
    await expect(chip).toContainText("1");
    await expect(chip.locator("xpath=..")).toHaveClass(/hand-up/);

    if (!isPhone(testInfo)) {
        const pill = player.getByTestId("raised-hands-pill");
        await expect(pill).toContainText("1 raised");
        const handle = await boxOf(player.getByTestId("resize-handle"));
        expect((await boxOf(pill)).x).toBeLessThan(handle.x);
        await pill.click();
        const list = player.getByTestId("raised-hands-list");
        await expect(list.getByText("Raised hands")).toBeVisible();
        const row = list.getByTestId("raised-hand-row");
        await expect(row).toHaveCount(1);
        await expect(row).toContainText("1");
        await expect(row).toContainText("You");
        await expect(row.getByTestId("raised-hand-lower")).toHaveText("Lower hand");
        await player.keyboard.press("Escape");
        await expect(list).toHaveCount(0);
        await pill.click();
        await expect(list).toBeVisible();
        await player.mouse.click(700, 700);
        await expect(list).toHaveCount(0);
    }

    await tapOrClick(player, testInfo, handButton(player));
    await expect(handButton(player)).toHaveAttribute("aria-pressed", "false");
    await expect(bob.getByTestId("video-hand-position")).toHaveCount(0);
    await bob.context().close();
});

test("AV-067 Phone: with a hand up the chat sheet header shows the compact pill", async ({ player, url, browser }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const bob = await joinBubble(browser, testInfo, player, url);
    await muteMic(player, testInfo);
    await handButton(player).tap();
    await expect(player.getByTestId("raise-hand-position")).toHaveText("1");
    await player.getByTestId("chat-btn").tap();
    const chat = player.getByTestId("chat");
    await expect(chat).toBeVisible();
    const pill = chat.getByTestId("raised-hands-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveClass(/compact/);
    await expect(pill).toContainText("1");
    await expect(pill).not.toContainText("raised");
    await pill.tap();
    await expect(chat.getByTestId("raised-hands-list")).toBeVisible();
    await bob.context().close();
});

test("AV-068 Talking with a hand up offers to keep it; Keep it raised keeps it", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await tapOrClick(player, testInfo, handButton(player));
    const callout = player.getByTestId("keep-hand-raised");
    await expect(callout).toBeVisible({ timeout: 30_000 });
    await expect(callout).toContainText("You spoke, so your hand will go down");
    await expect(callout.locator(".keep-bar > div")).toHaveAttribute("style", /animation-duration: 6000ms/);
    await tapOrClick(player, testInfo, player.getByTestId("keep-hand-raised-button"));
    await expect(callout).toHaveCount(0);
    await expect(handButton(player)).toHaveAttribute("aria-pressed", "true");
    await expect(player.getByTestId("raise-hand-position")).toHaveText("1");
    await bob.context().close();
});

test("AV-068 Without Keep it raised the hand goes down after talking", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await tapOrClick(player, testInfo, handButton(player));
    await expect(player.getByTestId("keep-hand-raised")).toBeVisible({ timeout: 30_000 });
    await muteMic(player, testInfo);
    await expect(handButton(player)).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
    await bob.context().close();
});

test("AV-069 Hands queue in the order they went up; lowering the first moves the second up", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await muteMic(player, testInfo);
    await muteMic(bob, testInfo);
    await tapOrClick(player, testInfo, handButton(player));
    await expect(player.getByTestId("raise-hand-position")).toHaveText("1");
    await expect(bob.getByTestId("video-hand-position")).toBeVisible();
    await tapOrClick(bob, testInfo, handButton(bob));
    await expect(bob.getByTestId("raise-hand-position")).toHaveText("2");
    await expect(handButton(bob)).toHaveAttribute("aria-label", "Lower hand · number 2 in line");
    await expect(player.getByTestId("raise-hand-position")).toHaveText("1");
    if (!isPhone(testInfo)) {
        await player.getByTestId("raised-hands-pill").click();
        const rows = player.getByTestId("raised-hand-row");
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toContainText("You");
        await expect(rows.nth(1)).toContainText("Bob");
        await player.keyboard.press("Escape");
    }
    await tapOrClick(player, testInfo, handButton(player));
    await expect(bob.getByTestId("raise-hand-position")).toHaveText("1");
    await expect(handButton(bob)).toHaveAttribute("aria-label", "Lower hand · you're next");
    await bob.context().close();
});
