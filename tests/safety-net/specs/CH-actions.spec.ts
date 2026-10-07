import { test, expect, isPhone } from "../lib/game";
import { alice, chat, clipboardText, inBubble, message, send, serveEmojiData, touchHold, touchSwipe } from "../lib/ch";

test("CH-037 Desktop: hovering Bob's message shows 3 quick reactions, Add reaction, Reply and More, no Edit/Delete", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover)");
    const player = await alice(page, url);
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "see you at the demo");
    const msg = message(player, "see you at the demo");
    await expect(msg).toBeVisible({ timeout: 10_000 });
    const bar = msg.getByTestId("messageHoverBar");
    await player.mouse.move(1, 1);
    await expect(bar).toHaveCSS("opacity", "0");
    await msg.getByText("see you at the demo").hover();
    for (const emoji of ["👍", "❤️", "😂"]) {
        await expect(bar.getByTestId(`quickReaction_${emoji}`)).toBeVisible();
    }
    await expect(bar.locator("[data-testid^=quickReaction_]")).toHaveCount(3);
    await expect(bar.getByTestId("openEmojiPickerButton")).toBeVisible();
    await expect(bar.getByTestId("replyToMessageButton")).toBeVisible();
    await expect(bar.getByTestId("messageMoreButton")).toBeVisible();
    await bar.getByTestId("messageMoreButton").click();
    await expect(player.getByTestId("copyMessageTextButton")).toBeVisible();
    await expect(player.getByTestId("editMessageButton")).toHaveCount(0);
    await expect(player.getByTestId("removeMessageButton")).toHaveCount(0);
});

test("CH-038 Desktop: a quick 👍 shows a chip to both; clicking it again removes it for both", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover)");
    const player = await alice(page, url);
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "react to me");
    const msg = message(player, "react to me");
    await expect(msg).toBeVisible({ timeout: 10_000 });
    await msg.getByText("react to me").hover();
    await msg.getByTestId("quickReaction_👍").click();
    const chipA = msg.getByTestId("👍_reactionButton");
    const chipB = message(bob, "react to me").getByTestId("👍_reactionButton");
    await expect(chipA).toBeVisible();
    await expect(chipA).toContainText("1");
    await expect(chipA).toHaveAttribute("title", /Reacted with 👍: .*Alice/);
    await expect(chipB).toBeVisible({ timeout: 10_000 });
    await expect(chipB).toContainText("1");
    await expect(chipB).toHaveAttribute("title", /Alice/);
    await chipA.click();
    await expect(chipA).toHaveCount(0);
    await expect(chipB).toHaveCount(0, { timeout: 10_000 });
});

test("CH-039 Desktop: Add reaction opens the full picker by the message; the pick shows to both, in one row", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover)");
    const player = await alice(page, url);
    await serveEmojiData(player);
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "first message");
    await send(bob, "second message");
    const msg = message(player, "first message");
    await expect(message(player, "second message")).toBeVisible({ timeout: 10_000 });
    const picked: string[] = [];
    for (let i = 0; i < 6; i++) {
        await msg.getByText("first message").hover();
        await msg.getByTestId("openEmojiPickerButton").click();
        const picker = player.locator("emoji-picker");
        await expect(picker).toBeVisible();
        const emoji = picker.getByRole("menuitem").nth(i + 10);
        await expect(emoji).toBeVisible({ timeout: 30_000 });
        const pBox = (await picker.boundingBox())!;
        const bubble = (await msg.getByText("first message").boundingBox())!;
        const gapAbove = bubble.y - (pBox.y + pBox.height);
        const gapBelow = pBox.y - (bubble.y + bubble.height);
        expect(Math.min(Math.abs(gapAbove), Math.abs(gapBelow))).toBeLessThan(80);
        picked.push(((await emoji.textContent()) ?? "").trim());
        await emoji.click();
        await expect(msg.getByTestId(`${picked[i]}_reactionButton`)).toBeVisible();
        if (await picker.isVisible()) await player.keyboard.press("Escape");
    }
    await expect(message(bob, "first message").getByTestId(`${picked[0]}_reactionButton`)).toBeVisible({
        timeout: 10_000,
    });
    const chips = msg.locator("[data-testid$=_reactionButton]");
    await expect(chips).toHaveCount(6);
    // The newest chip pops in (a short slide and scale): measure once it has settled.
    let tops: number[] = [];
    await expect
        .poll(
            async () => {
                tops = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
                return new Set(tops).size;
            },
            { message: "chips not in one row", timeout: 5_000 }
        )
        .toBe(1);
    const firstChip = (await chips.first().boundingBox())!;
    const next = (await message(player, "second message").getByText("second message").boundingBox())!;
    expect(firstChip.y + firstChip.height).toBeLessThanOrEqual(next.y + 1);
});

test("CH-040 Desktop: Reply shows a preview, the sent reply quotes Bob for both, the quote jumps to the original", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover)");
    const player = await alice(page, url);
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "original words");
    const msg = chat(player).locator("li[data-event-id]").filter({ hasText: "original words" }).first();
    await expect(msg).toBeVisible({ timeout: 10_000 });

    await msg.getByText("original words").hover();
    await msg.getByTestId("replyToMessageButton").click();
    const preview = player.getByTestId("replyPreview");
    await expect(preview).toContainText("Replying to Bob");
    await expect(preview).toContainText("original words");
    await expect(player.getByTestId("messageInput")).toBeFocused();
    await player.getByTestId("cancelReplyButton").click();
    await expect(preview).toBeHidden();

    await msg.getByText("original words").hover();
    await msg.getByTestId("replyToMessageButton").click();
    await expect(preview).toBeVisible();
    await player.keyboard.type("ok");
    await player.keyboard.press("Enter");
    await expect(preview).toBeHidden();
    const reply = message(bob, "ok");
    await expect(reply.getByTestId("quotedMessage")).toContainText("original words", { timeout: 10_000 });
    const mine = chat(player)
        .locator("li[data-event-id]")
        .filter({ has: player.getByTestId("quotedMessage") })
        .last();
    await expect(mine.getByTestId("quotedMessage")).toContainText("original words");
    await mine.getByTestId("quotedMessage").click();
    await expect(msg).toHaveClass(/quote-flash/);
});

test("CH-041 Desktop: More > Copy text copies and says Text copied; right-click opens the message menu", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (hover)");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const player = await alice(page, url);
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "copy these words");
    const msg = message(player, "copy these words");
    await expect(msg).toBeVisible({ timeout: 10_000 });
    await msg.getByText("copy these words").hover();
    await msg.getByTestId("messageMoreButton").click();
    await player.getByTestId("copyMessageTextButton").click();
    await expect(player.getByText("Text copied")).toBeVisible();
    expect(await clipboardText(player)).toBe("copy these words");

    await msg.getByText("copy these words").click({ button: "right" });
    const menu = player.getByTestId("messageActionMenu");
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("menuReplyButton")).toBeVisible();
    await expect(menu.getByTestId("menuCopyTextButton")).toBeVisible();
    await player.getByTestId("messageActionMenuScrim").click({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();

    await send(bob, "https://example.com");
    const link = chat(player).locator('a[href^="https://example.com"]');
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click({ button: "right" });
    await expect(menu).toBeHidden();
});

test("CH-042 Phone: press and hold opens 6 reactions plus more and Reply / Copy text; the backdrop closes it", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only (touch)");
    const player = await alice(page, url);
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "hold me");
    const msg = message(player, "hold me");
    await expect(msg).toBeVisible({ timeout: 10_000 });
    await expect(msg.getByTestId("messageHoverBar")).toBeHidden();
    await touchHold(player, msg.getByText("hold me"));
    const menu = player.getByTestId("messageActionMenu");
    await expect(menu).toBeVisible();
    for (const emoji of ["👍", "❤️", "😂", "😮", "😢", "🎉"]) {
        await expect(menu.getByTestId(`quickReaction_${emoji}`)).toBeVisible();
    }
    await expect(menu.locator("[data-testid^=quickReaction_]")).toHaveCount(6);
    await expect(menu.getByTestId("moreReactionsButton")).toBeVisible();
    await expect(menu.getByTestId("menuReplyButton")).toHaveText(/Reply/);
    await expect(menu.getByTestId("menuCopyTextButton")).toHaveText(/Copy text/);
    await expect(menu.getByTestId("menuEditButton")).toHaveCount(0);
    await expect(menu.getByTestId("menuDeleteButton")).toHaveCount(0);
    await expect(player.getByTestId("replyPreview")).toHaveCount(0);
    await player.getByTestId("messageActionMenuScrim").tap({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();
});

test("CH-043 Phone: swiping a message right starts a reply", async ({ page, browser, url }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only (touch)");
    const player = await alice(page, url);
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "swipe me");
    const msg = message(player, "swipe me");
    await expect(msg).toBeVisible({ timeout: 10_000 });
    await touchSwipe(player, msg.getByText("swipe me"), 30);
    await expect(player.getByTestId("replyPreview")).toHaveCount(0);
    await touchSwipe(player, msg.getByText("swipe me"), 120);
    const preview = player.getByTestId("replyPreview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Replying to Bob");
    await expect(preview).toContainText("swipe me");
});
