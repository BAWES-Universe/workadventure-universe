import type { Locator, Page } from "@playwright/test";
import { test, expect, isPhone, newPlayer, roomUrl, join } from "../lib/game";
import {
    alice,
    backToList,
    bobApart,
    chat,
    clipboardText,
    closeChat,
    deviceContext,
    inBubble,
    isOnTop,
    message,
    openChat,
    openPeople,
    openProximityThread,
    position,
    send,
    tapWoka,
    teleport,
    CORNER,
} from "../lib/ch";

const LEFT_TOP = { x: 48, y: 48 };

function here(page: Page) {
    return page.getByTestId("peopleHere");
}

/** A name nobody else on the shared local world uses (every map is in one world locally). */
function uniqueName(base: string): string {
    return base + Math.random().toString(36).slice(2, 6);
}

async function openCardFromPeople(page: Page, name: string): Promise<void> {
    await openPeople(page);
    await here(page).locator(".wa-chat-item", { hasText: name }).locator("span.truncate", { hasText: name }).click();
    await expect(page.getByTestId("actions-menu")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("actions-menu").getByRole("heading")).toHaveText(name);
}

test("CH-045 People: the room first with its count, You first, then Bob online with Walk to", async ({
    player,
    browser,
    url,
}, testInfo) => {
    await bobApart(browser, testInfo, player, url);
    await openPeople(player);
    const title = player.getByTestId("peopleHereTitle");
    await expect(title).toContainText("2 here", { timeout: 20_000 });
    await expect(title.locator(".u-live-dot")).toBeVisible();
    const sections = player.getByTestId("peopleList").locator("section");
    await expect(sections.first()).toHaveAttribute("data-testid", "peopleHere");
    const rows = here(player).locator(".wa-chat-item");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Alice");
    await expect(rows.nth(0)).toContainText("You");
    await expect(rows.nth(1)).toContainText("Bob");
    await expect(rows.nth(1)).toContainText("Online");
    await expect(here(player).getByTestId("walk-to-Bob")).toBeVisible();
    await expect(here(player).getByTestId("walk-to-Alice")).toHaveCount(0);
});

test("CH-046 Walk to on Bob's row walks Alice to him", async ({ player, browser, url }, testInfo) => {
    const bob = await bobApart(browser, testInfo, player, url);
    await teleport(bob, LEFT_TOP);
    await openPeople(player);
    await here(player).getByTestId("walk-to-Bob").click();
    await expect
        .poll(
            async () => {
                const p = await position(player);
                return Math.hypot(p.x - LEFT_TOP.x, p.y - LEFT_TOP.y);
            },
            { timeout: 30_000 }
        )
        .toBeLessThan(80);
});

test("CH-047 CH-052 Clicking Bob in People opens his card; on a phone the chat steps aside and comes back on close", async ({
    player,
    browser,
    url,
}, testInfo) => {
    await bobApart(browser, testInfo, player, url);
    await openPeople(player);
    const list = player.getByTestId("peopleList");
    await here(player)
        .locator(".wa-chat-item", { hasText: "Bob" })
        .locator("span.truncate", { hasText: "Bob" })
        .click();
    const card = player.getByTestId("actions-menu");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole("heading")).toHaveText("Bob");
    if (!isPhone(testInfo)) {
        await expect(chat(player)).toBeVisible();
        return;
    }
    await expect(chat(player)).toBeHidden();
    await card.locator(".close-btn").first().click();
    await expect(card).toBeHidden();
    await expect(chat(player)).toBeVisible();
    await expect(player.getByTestId("chatTabPeople")).toHaveAttribute("aria-selected", "true");
    await expect(list).toBeVisible();

    await here(player)
        .locator(".wa-chat-item", { hasText: "Bob" })
        .locator("span.truncate", { hasText: "Bob" })
        .click();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(chat(player)).toBeHidden();
    await player.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(chat(player)).toBeVisible();
    await expect(player.getByTestId("chatTabPeople")).toHaveAttribute("aria-selected", "true");
});

test("CH-048 Bob's ⋯ menu has Locate, which opens his card; an outside click closes the menu", async ({
    player,
    browser,
    url,
}, testInfo) => {
    await bobApart(browser, testInfo, player, url);
    await openPeople(player);
    const more = here(player).getByTestId("more-actions-Bob");
    const menu = player.getByRole("menu");
    await more.click();
    await expect(menu.getByRole("menuitem", { name: /Locate/ })).toBeVisible();
    await player.getByTestId("peopleHereTitle").click();
    await expect(menu).toBeHidden();
    await more.click();
    await menu.getByRole("menuitem", { name: /Locate/ }).click();
    const card = player.getByTestId("actions-menu");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole("heading")).toHaveText("Bob");
    await player.keyboard.press("Escape");
    await expect(card).toBeHidden();
});

test("CH-049 Elsewhere in this world lists Bob under his map with Go to room, which takes Alice there", async ({
    player,
    browser,
    url,
}, testInfo) => {
    test.slow();
    const bobName = uniqueName("Bob");
    const otherUrl = url.replace("/_/sn-", "/_/sn4-");
    await newPlayer(browser, testInfo, otherUrl, bobName);
    await openPeople(player);
    const toggle = player.getByTestId("peopleElsewhereToggle");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toContainText("Elsewhere in this world");
    await expect(toggle).toContainText(/\d+/);
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const go = player.getByTestId(`go-to-room-${bobName}`);
    await expect(go).toBeVisible({ timeout: 20_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(go).toBeHidden();
    await closeChat(player);
    await openPeople(player);
    await expect(player.getByTestId("peopleElsewhereToggle")).toHaveAttribute("aria-expanded", "false");
    await player.getByTestId("peopleElsewhereToggle").click();
    await player.getByTestId(`go-to-room-${bobName}`).click();
    await expect.poll(() => player.url(), { timeout: 30_000 }).toContain("/_/sn4-");
});

test("CH-050 Two tabs of Alice show as one row with 2 sessions, each with its own Walk to", async ({
    player,
    browser,
    url,
}, testInfo) => {
    test.slow();
    const aliceName = uniqueName("Alice");
    await teleport(player, CORNER);
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await teleport(bob, LEFT_TOP);
    const ctx = await deviceContext(browser, testInfo);
    const tab1 = await ctx.newPage();
    await join(tab1, url, aliceName);
    await teleport(tab1, { x: 288, y: 48 });
    const tab2 = await ctx.newPage();
    await tab2.goto(url);
    await expect(tab2.getByTestId("microphone-button").or(tab2.getByTestId("loginSceneNameInput"))).toBeVisible({
        timeout: 60_000,
    });
    if (await tab2.getByTestId("loginSceneNameInput").isVisible()) await join(tab2, url, aliceName);
    await expect(tab2.getByTestId("microphone-button")).toBeVisible({ timeout: 60_000 });
    await teleport(tab2, { x: 48, y: 288 });

    await openPeople(bob);
    const toggle = here(bob).getByTestId(`sessions-toggle-${aliceName}`);
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toContainText("2 sessions");
    await expect(here(bob).locator(".wa-chat-item", { hasText: aliceName })).toHaveCount(1);
    await here(bob).getByTestId(`walk-to-${aliceName}`).click();
    const sessions = here(bob).getByTestId(`sessions-${aliceName}`);
    await expect(sessions).toBeVisible();
    await expect(sessions.getByTestId("personSession")).toHaveCount(2);
    await expect(sessions).toContainText("Session 1");
    await expect(sessions).toContainText("Session 2");
    await expect(sessions.getByTestId("walk-to-session-1")).toBeVisible();
    await expect(sessions.getByTestId("walk-to-session-2")).toBeVisible();
    await expect(sessions.getByTestId("locate-session-1")).toBeVisible();
    const before = await position(bob);
    await bob.waitForTimeout(1000);
    expect(await position(bob)).toEqual(before);
    await ctx.close();
});

test("CH-051 Search people highlights matches, says No matching people., and clearing restores folds", async ({
    player,
    browser,
    url,
}, testInfo) => {
    await bobApart(browser, testInfo, player, url);
    await openPeople(player);
    const search = player.getByTestId("chatSearchInput");
    await expect(search).toHaveAttribute("placeholder", "Search people");
    const elsewhere = player.getByTestId("peopleElsewhereToggle");
    const hasElsewhere = await elsewhere.isVisible();
    if (hasElsewhere && (await elsewhere.getAttribute("aria-expanded")) === "true") await elsewhere.click();
    await search.click();
    await search.pressSequentially("bo");
    const bobRow = here(player).locator(".wa-chat-item", { hasText: "Bob" });
    await expect(bobRow.locator("span.text-light-blue")).toHaveText(/^bo$/i);
    await expect(here(player).locator(".wa-chat-item", { hasText: "Alice" })).toHaveCount(0);
    await search.fill("");
    await search.pressSequentially("zzzq");
    await expect(player.getByTestId("peopleNoResults")).toHaveText("No matching people.");
    await expect(here(player)).toHaveCount(0);
    await player.getByTestId("chatSearchClear").click();
    await expect(search).toHaveValue("");
    await expect(here(player).locator(".wa-chat-item")).toHaveCount(2);
    if (hasElsewhere) await expect(elsewhere).toHaveAttribute("aria-expanded", "false");
});

test("CH-053 CH-055 The invite card opens above the button and closes by outside click, Escape and X", async ({
    player,
}) => {
    await openChat(player);
    const button = player.getByTestId("chatInviteButton");
    const card = player.getByTestId("chatInviteCard");
    await expect(button).toHaveText(/Invite someone to join/);
    await button.click();
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading")).toHaveText("Invite someone to join");
    await expect(card).toContainText(
        /Anyone with the link can walk straight into .+\. No download, no account needed\./
    );
    const link = player.getByTestId("chatInviteLink");
    const pageUrl = new URL(player.url());
    await expect(link).toHaveValue(`${pageUrl.origin}${pageUrl.pathname}`);
    expect(
        await link.evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length)
    ).toBe(true);
    await expect(player.getByTestId("chatInviteCopy")).toHaveText(/Copy/);
    await expect(player.getByTestId("chatInviteNextToMe")).toBeAttached();
    await expect(card).toContainText("Arrive next to me");
    const canShare = await player.evaluate(() => typeof navigator.share === "function");
    await expect(player.getByTestId("chatInviteShare")).toHaveCount(canShare ? 1 : 0);
    const cardBox = (await card.boundingBox())!;
    const btnBox = (await button.boundingBox())!;
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(btnBox.y);
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    expect(await isOnTop(card)).toBe(true);

    await player.getByTestId("chatTabChats").click();
    await expect(card).toBeHidden();
    await button.click();
    await expect(card).toBeVisible();
    await player.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await button.click();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden();

    await player.getByTestId("chatTabPeople").click();
    await player.getByTestId("chatInviteButton").click();
    await expect(player.getByTestId("chatInviteCard")).toBeVisible();
});

test("CH-054 Copy says Copied and fills the clipboard; Arrive next to me adds #moveTo", async ({ player }) => {
    await player.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await openChat(player);
    await player.getByTestId("chatInviteButton").click();
    const link = player.getByTestId("chatInviteLink");
    const copy = player.getByTestId("chatInviteCopy");
    await copy.click();
    await expect(copy).toHaveText(/Copied/);
    expect(await clipboardText(player)).toBe(await link.inputValue());
    await expect(copy).toHaveText(/Copy/, { timeout: 5_000 });
    await expect(copy).not.toHaveText(/Copied/);

    await player.getByTestId("chatInviteNextToMe").check({ force: true });
    await expect(link).toHaveValue(/#moveTo=\d+,\d+$/);
    const [, x, y] = (await link.inputValue()).match(/#moveTo=(\d+),(\d+)$/)!;
    const p = await position(player);
    expect(Math.abs(Number(x) - p.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(y) - p.y)).toBeLessThanOrEqual(2);
    await copy.click();
    expect(await clipboardText(player)).toMatch(/#moveTo=\d+,\d+$/);
});

test("CH-054 The entry point picker adds #<name> on a map with several entry points", async ({ page }, testInfo) => {
    await join(page, roomUrl(testInfo, "tests/exit1.json"), "Alice");
    await openChat(page);
    await page.getByTestId("chatInviteButton").click();
    const select = page.getByTestId("chatInviteEntryPoint");
    await expect(select).toBeVisible();
    await select.selectOption("from_exit2");
    await expect(page.getByTestId("chatInviteLink")).toHaveValue(/#from_exit2$/);
});

test("CH-063 Tapping Bob on the map opens his card with Walk to and Block or report…, nothing for signed-in only @local", async ({
    player,
    browser,
    url,
}, testInfo) => {
    const bob = await bobApart(browser, testInfo, player, url);
    await teleport(player, { x: 160, y: 160 });
    const bobSpot = { x: 256, y: 160 }; // 96 px apart: no bubble, so no videos over the map
    await teleport(bob, bobSpot);
    await tapWoka(player, "Bob", isPhone(testInfo), bobSpot);
    const card = player.getByTestId("actions-menu");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading")).toHaveText("Bob");
    await expect(card.getByRole("button", { name: "Walk to" })).toBeVisible();
    await expect(card.getByTestId("wokamenu-message-button")).toHaveCount(0);
    await expect(card.getByTestId("wokamenu-friend-button")).toHaveCount(0);
    await expect(card.getByTestId("wokamenu-view-profile-button")).toHaveCount(0);
    await card.getByTestId("wokamenu-more-button").click();
    await expect(card.getByTestId("wokamenu-block-user-button")).toHaveText(/Block or report…/);
    await tapWoka(player, "Bob", isPhone(testInfo), bobSpot);
    await expect(card).toBeHidden();
});

test("CH-010 Phone: with the sheet open, Bob's card and the Block or report popup show in front of it @local", async ({
    page,
    browser,
    url,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const player = await alice(page, url);
    const bob = await bobApart(browser, testInfo, player, url);
    // The sheet (60% of the screen) covers the lower part of the map and the map does not move for it, so Bob stands
    // near the top edge of the map, in the part that stays visible above the sheet.
    await teleport(player, { x: 160, y: 48 });
    const bobSpot = { x: 256, y: 48 }; // 96 px apart: no bubble, so no videos over the map
    await teleport(bob, bobSpot);
    await openChat(player);
    await expect(player.locator("section#chat.chat-sheet")).toBeVisible();
    await tapWoka(player, "Bob", true, bobSpot);
    const card = player.getByTestId("actions-menu");
    await expect(card).toBeVisible();
    await expect(chat(player)).toBeVisible();
    await expect.poll(() => isOnTop(card), { message: "card in front of the sheet" }).toBe(true);
    await card.getByTestId("wokamenu-more-button").tap();
    await card.getByTestId("wokamenu-block-user-button").tap();
    const dialog = player.locator("[role=dialog][aria-labelledby=report-title]");
    await expect(dialog).toBeVisible();
    // It opens with a short animation: poll until it has settled.
    await expect.poll(() => isOnTop(dialog), { message: "popup in front of the sheet" }).toBe(true);
});

/** Opens whatever chat Alice has with Bob on the Chats tab: the live one, else the ended row. */
async function openChatWithBob(page: Page): Promise<void> {
    if (!(await chat(page).isVisible())) await openChat(page);
    if (await page.getByTestId("chatBackward").isVisible()) await backToList(page);
    await page.getByTestId("chatTabChats").click();
    const live = page.getByTestId("toggleDisplayProximityChat");
    const row = page.getByTestId("proximitySessionRow").first();
    await expect(live.or(row).first()).toBeVisible({ timeout: 20_000 });
    if (await live.isVisible()) await live.click();
    else await row.click();
    await expect(page.getByTestId("roomName")).toBeVisible();
}

function videos(page: Page) {
    return page.getByTestId("webrtc-video");
}

/**
 * Clicks a control at a point where it is on top. On a phone the action bar's ^ tab (dev build) sits over the
 * bottom middle of the person card, over part of ⋯ and of "Block or report…"; a person taps the part they can see.
 */
async function clickVisiblePart(target: Locator): Promise<void> {
    await expect(target).toBeVisible();
    // The card slides in: find the uncovered point again until a click there lands.
    await expect(async () => {
        const position = await target.evaluate((el) => {
            const r = el.getBoundingClientRect();
            for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
                for (const fx of [0.5, 0.2, 0.8, 0.1, 0.9]) {
                    const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
                    if (top && (top === el || el.contains(top))) return { x: r.width * fx, y: r.height * fy };
                }
            }
            return null;
        });
        if (!position) throw new Error("no part of the control is on top");
        await target.click({ position, timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
}

/** Opens the card's ⋯ list. */
async function openMore(card: Locator): Promise<void> {
    await clickVisiblePart(card.getByTestId("wokamenu-more-button"));
}

/** Clicks "Block or report…" / "Unblock this user" in the card's ⋯ list. */
async function clickBlockItem(card: Locator): Promise<void> {
    await clickVisiblePart(card.getByTestId("wokamenu-block-user-button"));
}

test("CH-057 CH-058 CH-059 Block Bob from his card, unblock him, and he stays unblocked when others come and go", async ({
    player,
    browser,
    url,
}, testInfo) => {
    test.slow();
    const bob = await inBubble(browser, testInfo, player, url);
    await expect.poll(() => videos(player).count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const withBob = await videos(player).count();

    await openCardFromPeople(player, "Bob");
    const card = player.getByTestId("actions-menu");
    await openMore(card);
    await expect(card.getByTestId("wokamenu-block-user-button")).toHaveText(/Block or report…/);
    await clickBlockItem(card);
    const dialog = player.locator("[role=dialog][aria-labelledby=report-title]");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#report-title")).toHaveText("Bob");
    await expect(dialog).toContainText(/You won.t see or hear Bob, and they can.t message you/);
    await expect(dialog.getByTestId("blockmenu-block-user-button")).toHaveText(/Block Bob/);
    await expect(dialog.getByTestId("report-message")).toHaveCount(0);
    await dialog.getByTestId("blockmenu-block-user-button").click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => videos(player).count(), { timeout: 30_000 }).toBeLessThan(withBob);
    // Only what Bob sends after the block must not arrive.
    await send(bob, "Hello banned!");
    await openChatWithBob(player);
    await player.waitForTimeout(3000);
    await expect(chat(player).getByText("Hello banned!")).toHaveCount(0);

    await openCardFromPeople(player, "Bob");
    await openMore(card);
    await expect(card.getByTestId("wokamenu-block-user-button")).toHaveText(/Unblock this user/);
    await clickBlockItem(card);
    await expect(dialog.getByTestId("blockmenu-block-user-button")).toHaveText(/^\s*Unblock Bob/);
    await dialog.getByTestId("blockmenu-block-user-button").click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => videos(player).count(), { timeout: 30_000 }).toBe(withBob);
    await openProximityThread(player);
    await send(bob, "Hello unbanned!");
    await expect(message(player, "Hello unbanned!")).toBeVisible({ timeout: 10_000 });

    const carol = await newPlayer(browser, testInfo, url, "Carol");
    await teleport(carol, LEFT_TOP);
    await carol.context().close();
    await player.waitForTimeout(3000);
    await expect(videos(player)).toHaveCount(withBob);
    await send(bob, "still unblocked");
    await openChatWithBob(player);
    await expect(message(player, "still unblocked")).toBeVisible({ timeout: 10_000 });
    await openCardFromPeople(player, "Bob");
    await openMore(card);
    await expect(card.getByTestId("wokamenu-block-user-button")).toHaveText(/Block or report…/);
});

test("CH-060 The Block or report popup closes with Escape or its X and changes nothing", async ({
    player,
    browser,
    url,
}, testInfo) => {
    test.slow();
    const bob = await inBubble(browser, testInfo, player, url);
    const dialog = player.locator("[role=dialog][aria-labelledby=report-title]");
    const card = player.getByTestId("actions-menu");
    for (const how of ["escape", "x"]) {
        await openCardFromPeople(player, "Bob");
        await openMore(card);
        await clickBlockItem(card);
        await expect(dialog).toBeVisible();
        if (how === "escape") await player.keyboard.press("Escape");
        else await dialog.getByRole("button", { name: "Close" }).click();
        await expect(dialog).toBeHidden();
    }
    await openCardFromPeople(player, "Bob");
    await openMore(card);
    await expect(card.getByTestId("wokamenu-block-user-button")).toHaveText(/Block or report…/);
    await player.keyboard.press("Escape");
    await openProximityThread(player);
    await send(bob, "nothing changed");
    await expect(message(player, "nothing changed")).toBeVisible({ timeout: 10_000 });
});
