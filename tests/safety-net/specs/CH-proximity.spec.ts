import type { Page } from "@playwright/test";
import { test, expect, isPhone, newPlayer, roomUrl, wa } from "../lib/game";
import {
    alice,
    backToList,
    bobApart,
    chat,
    clipboardText,
    closeChat,
    expectProximityThread,
    inBubble,
    meet,
    message,
    openChat,
    openEndedRow,
    openProximityThread,
    position,
    send,
    serveEmojiData,
    teleport,
    typeInField,
    CORNER,
    FAR,
    SPOT_A,
    SPOT_B,
} from "../lib/ch";

const NEAR_START = { x: 48, y: 48 };

/** Carol chats with Alice and leaves, then Bob joins Alice's bubble: one ended chat and one live one. */
async function endedThenLive(browser: Parameters<typeof newPlayer>[0], testInfo: Parameters<typeof newPlayer>[1], player: Page, url: string) {
    const carol = await inBubble(browser, testInfo, player, url, "Carol");
    await send(carol, "hi from carol");
    await expect(message(player, "hi from carol")).toBeVisible({ timeout: 20_000 });
    await teleport(carol, FAR);
    await expect(player.getByTestId("proximitySessionRowTitle").getByText("Carol", { exact: true })).toBeVisible({ timeout: 20_000 });
    await carol.context().close();
    await teleport(player, CORNER);
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await meet(player, bob);
    await openProximityThread(bob);
    await openProximityThread(player);
    await expect(player.getByTestId("threadNowLabel")).toHaveText("Talking now · With Bob");
    return bob;
}

test("CH-017 Joining a bubble opens the proximity thread titled Proximity Chat, with Bob", async ({ player, browser, url }, testInfo) => {
    await player.getByTestId("camera-button").click();
    await player.getByTestId("microphone-button").click();
    const bob = await bobApart(browser, testInfo, player, url);
    await expect(chat(player)).toBeHidden();
    await meet(player, bob);
    if (isPhone(testInfo)) await openProximityThread(player);
    await expect(chat(player)).toBeVisible({ timeout: 20_000 });
    await expect(player.getByTestId("roomName")).toHaveText("Proximity Chat", { timeout: 20_000 });
    await expect(player.getByTestId("threadNowLabel")).toHaveText("Talking now · With Bob");
    await expect(player.getByTestId("threadSessionDividerLabel").last()).toHaveText("With Bob");
    await expect(player.getByTestId("threadSessionDivider").last()).toHaveAttribute("data-current", "true");
    await expect(player.getByTestId("proximityExplainer")).toContainText("Only people here when you send a message see it");
});

test("CH-018 A message sent with Enter or Send reaches the other side; Send shows only with text", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    const input = bob.getByTestId("messageInput");
    await expect(bob.getByTestId("sendMessageButton")).toBeHidden();
    await input.click();
    await input.pressSequentially("see you at the demo");
    await expect(bob.getByTestId("sendMessageButton")).toBeVisible();
    await input.press("Enter");
    await expect(input).toHaveText("");
    await expect(bob.getByTestId("sendMessageButton")).toBeHidden();
    await expect(message(player, "see you at the demo")).toBeVisible({ timeout: 10_000 });

    await input.click();
    await input.pressSequentially("second one");
    await bob.getByTestId("sendMessageButton").click();
    await expect(input).toHaveText("");
    await expect(message(player, "second one")).toBeVisible({ timeout: 10_000 });
});

test("CH-019 Shift+Enter adds a line break and never sends", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    const input = bob.getByTestId("messageInput");
    await input.click();
    await input.pressSequentially("line one");
    await input.press("Shift+Enter");
    await input.pressSequentially("line two");
    await expect(input).toContainText("line one");
    await bob.waitForTimeout(1000);
    await expect(chat(player).getByText("line one")).toHaveCount(0);
    await input.press("Enter");
    const msg = message(player, "line two");
    await expect(msg).toBeVisible({ timeout: 10_000 });
    expect(await msg.innerText()).toMatch(/line one\s*\n\s*line two/);
    await expect(chat(player).locator("li[data-event-id]").filter({ hasText: "line one" })).toHaveCount(1);
});

test("CH-020 The composer's smiley opens an emoji picker, inserts the emoji, and closes", async ({ player, browser, url }, testInfo) => {
    await serveEmojiData(player);
    await inBubble(browser, testInfo, player, url);
    const smiley = player.getByTestId("emojiPickerButton");
    await smiley.click();
    await expect(smiley).toHaveAttribute("aria-pressed", "true");
    const picker = player.locator("emoji-picker");
    await expect(picker).toBeVisible({ timeout: 30_000 });
    const emoji = picker.getByRole("menuitem").first();
    await expect(emoji).toBeVisible({ timeout: 20_000 });
    const picked = (await emoji.textContent())?.trim() ?? "";
    expect(picked).not.toBe("");
    await emoji.click();
    await expect(player.getByTestId("messageInput")).toContainText(picked);
    await smiley.click();
    await expect(smiley).toHaveAttribute("aria-pressed", "false");
    await expect(picker).toBeHidden();
});

test("CH-021 The rotated + opens the app list and closes it", async ({ player, browser, url }, testInfo) => {
    await inBubble(browser, testInfo, player, url);
    const plus = player.getByTestId("addApplicationButton");
    await expect(plus.locator("svg")).toHaveClass(/rotate-45/);
    await plus.click();
    for (const app of ["youtube", "klaxoon", "googleSheets", "googleDocs", "googleSlides", "googleDrive", "eraser", "excalidraw", "cards", "tldraw"]) {
        await expect(player.getByTestId(`${app}ApplicationButton`)).toBeVisible();
    }
    await expect(player.getByTestId("youtubeApplicationButton")).toContainText("YouTube");
    await expect(plus.locator("svg")).toHaveClass(/rotate-0/);
    await plus.click();
    await expect(player.getByTestId("youtubeApplicationButton")).toBeHidden();
});

test("CH-022 Bob typing shows in Alice's thread and on the live card, and stops when he sends", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    await typeInField(bob, "typing away");
    await expect(chat(player).locator("[id^=typing-user-]")).toBeVisible({ timeout: 10_000 });
    await backToList(player);
    await expect(player.getByTestId("proximityTopRowTyping")).toHaveText(/Bob is typing/, { timeout: 10_000 });
    await expect(player.getByTestId("proximityTopRowSubtitle")).toBeHidden();
    await bob.keyboard.press("Enter");
    await expect(player.getByTestId("proximityTopRowTyping")).toBeHidden({ timeout: 10_000 });
    await expect(chat(player).locator("[id^=typing-user-]")).toBeHidden();
    await expect(player.getByTestId("proximityTopRowSubtitle").or(message(player, "typing away"))).toBeVisible();
});

test("CH-023 The live card reads Proximity Chat with Bob and his last message, and reopens the thread", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    await backToList(player);
    const top = player.getByTestId("proximityTopRow");
    await expect(top).toHaveAttribute("data-state", "withPeople");
    await expect(player.getByTestId("proximityTopRowTitle")).toHaveText("Proximity Chat");
    await expect(player.getByTestId("proximityTopRowSubtitle")).toHaveText("With Bob");
    await player.getByTestId("toggleDisplayProximityChat").click();
    await expectProximityThread(player);
    await send(bob, "see you at the demo");
    await expect(message(player, "see you at the demo")).toBeVisible({ timeout: 10_000 });
    await backToList(player);
    await expect(player.getByTestId("proximityTopRowSubtitle")).toHaveText("Bob: see you at the demo");
    await player.getByTestId("toggleDisplayProximityChat").click();
    await expectProximityThread(player);
    await expect(message(player, "see you at the demo")).toBeVisible();
});

test("CH-024 CH-025 An ended bubble becomes its own read-only row, with a way back", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "see you at the demo");
    await expect(message(player, "see you at the demo")).toBeVisible({ timeout: 10_000 });
    await backToList(player);
    await expect(player.getByTestId("proximityTopRow")).toBeVisible();
    await expect(player.getByTestId("proximitySessionRow")).toHaveCount(0);
    await teleport(player, NEAR_START);
    await teleport(bob, CORNER);
    await expect(player.getByTestId("proximityTopRow")).toBeHidden({ timeout: 20_000 });
    await expect(chat(player)).toBeVisible();
    const row = player.getByTestId("proximitySessionRow");
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("proximitySessionRowTitle")).toHaveText("Bob");
    await expect(row.getByTestId("proximitySessionRowKind")).toHaveText("Proximity chat");
    await expect(row.getByTestId("proximitySessionRowPreview")).toContainText("see you at the demo");

    await row.click();
    const footer = player.getByTestId("proximityEndedFooter");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText("This proximity chat has ended.");
    await expect(player.getByTestId("messageInput")).toBeHidden();
    const way = player.getByTestId("proximityWayBack");
    await expect(way).toHaveCount(1);
    await expect(way).toHaveAttribute("data-kind", "walk");
    await expect(way).toHaveText(/Walk to Bob/);
});

test("CH-026 Walk to Bob from an ended chat walks Alice to him", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "hello");
    await expect(message(player, "hello")).toBeVisible({ timeout: 10_000 });
    await teleport(player, NEAR_START);
    await teleport(bob, CORNER);
    await openEndedRow(player, "Bob");
    const way = player.getByTestId("proximityWayBack");
    await expect(way).toHaveAttribute("data-kind", "walk");
    if (isPhone(testInfo)) await way.tap();
    else await way.click();
    await expect
        .poll(async () => {
            const p = await position(player);
            return Math.hypot(p.x - CORNER.x, p.y - CORNER.y);
        }, { timeout: 30_000 })
        .toBeLessThan(80);
});

test("CH-026 Go to <room> from an ended chat moves Alice to Bob's map", async ({ player, browser, url }, testInfo) => {
    test.slow();
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "hello");
    await expect(message(player, "hello")).toBeVisible({ timeout: 10_000 });
    const other = url.replace("/_/sn-", "/_/sn2-");
    await wa(bob, (target) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).WA.nav.goToRoom(target);
    }, other);
    await expect(player.getByTestId("proximityTopRow")).toBeHidden({ timeout: 30_000 });
    await openEndedRow(player, "Bob");
    const way = player.getByTestId("proximityWayBack");
    await expect(way).toHaveAttribute("data-kind", "go", { timeout: 30_000 });
    await expect(way).toHaveText(/^\s*Go to /);
    if (isPhone(testInfo)) await way.tap();
    else await way.click();
    await expect.poll(() => player.url(), { timeout: 30_000 }).toContain("/_/sn2-");
});

test("CH-026 Find people from an ended chat opens People searching for Bob", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "hello");
    await expect(message(player, "hello")).toBeVisible({ timeout: 10_000 });
    await bob.context().close();
    await expect(player.getByTestId("proximityTopRow")).toBeHidden({ timeout: 30_000 });
    await openEndedRow(player, "Bob");
    const way = player.getByTestId("proximityWayBack");
    await expect(way).toHaveAttribute("data-kind", "find", { timeout: 30_000 });
    await expect(way).toHaveText(/Find people/);
    await way.click();
    await expect(player.getByTestId("chatTabPeople")).toHaveAttribute("aria-selected", "true");
    await expect(player.getByTestId("chatSearchInput")).toHaveValue("Bob");
});

test("CH-027 Bob back within minutes: the same chat carries on, Back with Bob, no second row", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "see you at the demo");
    await expect(message(player, "see you at the demo")).toBeVisible({ timeout: 10_000 });
    await teleport(bob, FAR);
    await expect(player.getByTestId("proximityTopRow")).toBeHidden({ timeout: 20_000 });
    await openEndedRow(player, "Bob");
    await expect(player.getByTestId("messageInput")).toBeHidden();
    await teleport(bob, SPOT_B);
    await expect(player.getByTestId("messageInput")).toBeVisible({ timeout: 20_000 });
    await expect(player.getByTestId("proximityEndedFooter")).toBeHidden();
    await expect(player.getByTestId("threadSessionDivider").last()).toHaveAttribute("data-resumed", "true");
    await expect(player.getByTestId("threadSessionDividerLabel").last()).toHaveText("Back with Bob");
    await expect(message(player, "see you at the demo")).toBeVisible();
    await backToList(player);
    await expect(player.getByTestId("proximityTopRow")).toHaveAttribute("data-state", "withPeople");
    await expect(player.getByTestId("proximitySessionRow")).toHaveCount(0);
});

test("CH-028 A draft left when the bubble ends shows as Unsent draft with Copy", async ({ player, browser, url }, testInfo) => {
    await player.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "hello");
    await expect(message(player, "hello")).toBeVisible({ timeout: 10_000 });
    await typeInField(player, "my unsent words");
    await teleport(bob, FAR);
    await expect(player.getByTestId("proximityTopRow")).toBeHidden({ timeout: 20_000 });
    await openEndedRow(player, "Bob");
    const draft = player.getByTestId("proximityUnsentDraft");
    await expect(draft).toBeVisible();
    await expect(draft).toContainText("Unsent draft");
    await expect(draft).toContainText("my unsent words");
    const copy = draft.getByRole("button");
    await expect(copy).toHaveText(/Copy/);
    await copy.click();
    await expect(copy).toHaveText(/Copied/);
    expect(await clipboardText(player)).toContain("my unsent words");
});

test("CH-029 An old ended chat shows You're with Bob now, and Go to chat opens the live one", async ({ player, browser, url }, testInfo) => {
    test.slow();
    await endedThenLive(browser, testInfo, player, url);
    await backToList(player);
    await player.getByTestId("proximitySessionRow").filter({ hasText: "Carol" }).click();
    const notice = player.getByTestId("proximityLiveNotice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("You're with Bob now");
    await player.getByTestId("proximityLiveNoticeOpen").click();
    await expectProximityThread(player);
    await expect(player.getByTestId("threadNowLabel")).toHaveText("Talking now · With Bob");
});

test("CH-030 CH-031 A live message while viewing an old chat is unread: tab dot, then the badge on the chat button", async ({ player, browser, url }, testInfo) => {
    test.slow();
    const bob = await endedThenLive(browser, testInfo, player, url);
    await backToList(player);
    await player.getByTestId("proximitySessionRow").filter({ hasText: "Carol" }).click();
    await expect(player.getByTestId("proximityEndedFooter")).toBeVisible();
    await send(bob, "are you there");
    await player.waitForTimeout(2000);
    await expect(player.getByTestId("proximityEndedFooter")).toBeVisible();
    await expect(message(player, "hi from carol")).toBeVisible();
    await expect(chat(player).getByText("are you there")).toHaveCount(0);
    await backToList(player);
    await expect(player.getByTestId("chatTabChatsUnread")).toBeVisible();

    await closeChat(player);
    const badge = player.getByTestId("chatUnreadBadge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("1");
    const badgeBox = (await badge.boundingBox())!;
    const btnBox = (await player.getByTestId("chat-btn").boundingBox())!;
    expect(badgeBox.x).toBeLessThan(btnBox.x + btnBox.width / 2);
    expect(badgeBox.y).toBeLessThan(btnBox.y + btnBox.height / 2);
    await openChat(player);
    await openProximityThread(player);
    await expect(message(player, "are you there")).toBeVisible();
    await closeChat(player);
    await expect(badge).toBeHidden();
});

test("CH-032 Each past chat has its own row, newest first", async ({ player, browser, url }, testInfo) => {
    test.slow();
    const bob = await endedThenLive(browser, testInfo, player, url);
    await send(bob, "bob was here");
    await expect(message(player, "bob was here")).toBeVisible({ timeout: 10_000 });
    await teleport(bob, FAR);
    await expect(player.getByTestId("proximityTopRow")).toBeHidden({ timeout: 20_000 });
    const titles = player.getByTestId("proximitySessionRowTitle");
    await expect(titles).toHaveText(["Bob", "Carol"], { timeout: 20_000 });
    await expect(player.getByTestId("oneChatListItem")).toHaveCount(2);
    await expect(player.getByTestId("oneChatListShowMore")).toHaveCount(0);
});

test("CH-033 Search chats filters the rows; Escape clears then leaves; X clears; no match says so", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "bob was here");
    await expect(message(player, "bob was here")).toBeVisible({ timeout: 10_000 });
    await teleport(bob, FAR);
    await expect(player.getByTestId("proximityTopRow")).toBeHidden({ timeout: 20_000 });
    const titles = player.getByTestId("proximitySessionRowTitle");
    await expect(titles).toHaveText(["Bob"], { timeout: 20_000 });
    const search = player.getByTestId("chatSearchInput");
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute("placeholder", "Search chats");
    await search.click();
    await search.pressSequentially("Bob");
    await expect(titles).toHaveText(["Bob"]);
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await search.press("Escape");
    await expect(search).not.toBeFocused();
    await search.click();
    await search.pressSequentially("zzz");
    await expect(titles).toHaveCount(0);
    await expect(chat(player).getByText("No conversations match your search")).toBeVisible();
    await player.getByTestId("chatSearchClear").click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(titles).toHaveText(["Bob"]);
});

test("CH-035 A script's chat message arrives from The bot and adds a Room messages row", async ({ page }, testInfo) => {
    const player = await alice(page, roomUrl(testInfo, "tests/TriggerMessageApi/triggerMessage.json"));
    await teleport(player, { x: 272, y: 112 });
    await player.waitForTimeout(500);
    await player.keyboard.press("Space");
    await expect(chat(player)).toBeVisible({ timeout: 20_000 });
    await openProximityThread(player);
    const msg = message(player, "Hello world!");
    await expect(msg).toBeVisible({ timeout: 10_000 });
    await expect(msg).toContainText("The bot");
    await backToList(player);
    const row = player.getByTestId("proximitySessionRow").filter({ hasText: "Room messages" });
    await expect(row.getByTestId("proximitySessionRowTitle")).toHaveText("Room messages");
    await expect(row.getByTestId("proximitySessionRowPreview")).toContainText("The bot: Hello world!");
    await row.click();
    await expect(player.getByTestId("roomName")).toHaveText("Room messages");
    await expect(player.getByTestId("threadNowLabel")).toHaveText("Messages from this room's scripts");
});

test("CH-036 Links and markdown render: new-tab links, bold, highlighted code", async ({ player, browser, url }, testInfo) => {
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "https://example.com");
    const plain = chat(player).locator('a[href^="https://example.com"]');
    await expect(plain).toBeVisible({ timeout: 10_000 });
    await expect(plain).toHaveAttribute("target", "_blank");
    await expect(plain).toHaveAttribute("rel", "noopener noreferrer");
    await expect(plain).toHaveCSS("color", "rgb(255, 255, 255)");

    await send(bob, "**bold** and a [link](https://example.org)");
    await expect(chat(player).locator("strong", { hasText: "bold" })).toBeVisible({ timeout: 10_000 });
    const md = chat(player).locator('a[href="https://example.org"]');
    await expect(md).toHaveText("link");
    await expect(md).toHaveAttribute("target", "_blank");

    const input = bob.getByTestId("messageInput");
    await input.click();
    await input.pressSequentially("```js");
    await input.press("Shift+Enter");
    await input.pressSequentially("const answer = 42;");
    await input.press("Shift+Enter");
    await input.pressSequentially("```");
    await input.press("Enter");
    const code = chat(player).locator("pre code.hljs");
    await expect(code).toContainText("const answer = 42;", { timeout: 10_000 });
    await expect(code.locator(".hljs-keyword").first()).toHaveText("const");
});

test("CH-044 Messages carried over from the previous map can no longer be reacted to", async ({ player, browser, url }, testInfo) => {
    test.slow();
    const bob = await inBubble(browser, testInfo, player, url);
    await send(bob, "carried along");
    await expect(message(player, "carried along")).toBeVisible({ timeout: 10_000 });
    const other = url.replace("/_/sn-", "/_/sn3-");
    await wa(player, (target) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).WA.nav.goToRoom(target);
    }, other);
    await expect.poll(() => player.url(), { timeout: 30_000 }).toContain("/_/sn3-");
    await expect(player.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
    await openEndedRow(player, "Bob");
    const msg = message(player, "carried along");
    await expect(msg).toBeVisible();
    if (isPhone(testInfo)) {
        await msg.locator("#message").dispatchEvent("contextmenu");
        const menu = player.getByTestId("messageActionMenu");
        await expect(menu).toBeVisible();
        await expect(menu.getByTestId("menuCopyTextButton")).toBeVisible();
        await expect(menu.getByTestId("moreReactionsButton")).toHaveCount(0);
        await expect(menu.locator("[data-testid^=quickReaction_]")).toHaveCount(0);
        return;
    }
    await msg.getByText("carried along").hover();
    const bar = msg.getByTestId("messageHoverBar");
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId("messageMoreButton")).toBeVisible();
    await expect(bar.locator("[data-testid^=quickReaction_]")).toHaveCount(0);
    await expect(bar.getByTestId("openEmojiPickerButton")).toHaveCount(0);
});
