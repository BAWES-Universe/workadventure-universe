import type { Page } from "@playwright/test";
import { expect, isPhone, newPlayer, test, wa } from "../lib/game";
import { expectInBubble, joinBubble, openProfileMenu, position, tapOrClick } from "../lib/av";

/** Held for a moment: the game reads F once per frame, so a quick tap can fall between two frames. */
async function pressF(page: Page) {
    await page.keyboard.down("f");
    await page.waitForTimeout(300);
    await page.keyboard.up("f");
}

async function askToFollow(page: Page, testInfo: Parameters<typeof tapOrClick>[1]) {
    if (isPhone(testInfo)) {
        const menu = await openProfileMenu(page, testInfo);
        await menu.getByTestId("follow-menu-item").tap();
    } else {
        await page.getByTestId("follow-menu-item").first().click();
    }
    await expect(page.getByTestId("follow-card")).toBeVisible();
}

test("AV-085 AV-086 Ask to follow shows the leader's card and the question to the other", async ({
    player,
    url,
    browser,
}, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await askToFollow(player, testInfo);
    const card = player.getByTestId("follow-card");
    await expect(card).toContainText("You asked Bob to follow you");
    await expect(card).toContainText("Waiting for their answer");
    await expect(card.locator("i[style*='--follow-ms']")).toBeAttached();
    await expect(player.getByTestId("follow-cancel")).toHaveText("Cancel request");

    const question = bob.getByTestId("follow-card");
    await expect(question).toContainText("Alice wants you to follow");
    await expect(question).toContainText("Your Woka walks behind Alice until you stop");
    await expect(bob.getByTestId("follow-decline")).toHaveText("Not now");
    await expect(bob.getByTestId("follow-accept")).toHaveText("Follow");
    await expect(question.locator("i[style*='--follow-ms']")).toBeAttached();
    await bob.context().close();
});

test("AV-087 AV-089 Following: the follower walks behind; pills on both sides; Stop ends it for both", async ({
    player,
    url,
    browser,
}, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await askToFollow(player, testInfo);
    await tapOrClick(bob, testInfo, bob.getByTestId("follow-accept"));
    await expect(bob.getByTestId("follow-pill")).toContainText("Following Alice");
    await expect(player.getByTestId("follow-pill")).toContainText("Bob is following you");
    await expect(bob.getByTestId("follow-stop")).toBeVisible();
    await expect(player.getByTestId("follow-stop")).toBeVisible();

    const start = await position(bob);
    await wa(player, async () => {
        await WA.player.moveTo(250, 250, 10);
    });
    await expect
        .poll(
            async () => {
                const p = await position(bob);
                return Math.hypot(p.x - start.x, p.y - start.y);
            },
            { timeout: 20_000 }
        )
        .toBeGreaterThan(64);

    await tapOrClick(player, testInfo, player.getByTestId("follow-stop"));
    await expect(bob.getByTestId("follow-note")).toContainText("Alice stopped leading");
    await expect(player.getByTestId("follow-pill")).toHaveCount(0);
    await expect(bob.getByTestId("follow-pill")).toHaveCount(0);
    await bob.context().close();
});

test("AV-088 AV-089 Not now tells the leader; Cancel request removes the question", async ({
    player,
    url,
    browser,
}, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await askToFollow(player, testInfo);
    await tapOrClick(bob, testInfo, bob.getByTestId("follow-decline"));
    await expect(player.getByTestId("follow-note")).toContainText("Bob said no");
    await expect(player.getByTestId("follow-card")).toHaveCount(0);
    await expect(player.getByTestId("follow-note")).toHaveCount(0, { timeout: 8000 });

    await askToFollow(player, testInfo);
    await expect(bob.getByTestId("follow-card")).toBeVisible();
    await tapOrClick(player, testInfo, player.getByTestId("follow-cancel"));
    await expect(bob.getByTestId("follow-card")).toHaveCount(0);
    await expect(bob.getByTestId("follow-note")).toContainText("Alice cancelled the follow request");
    await bob.context().close();
});

test("AV-088 Nobody answering for 30 s times the request out", async ({ player, url, browser }, testInfo) => {
    const bob = await joinBubble(browser, testInfo, player, url);
    await askToFollow(player, testInfo);
    await expect(bob.getByTestId("follow-card")).toBeVisible();
    const note = player.getByTestId("follow-note");
    await expect(note).toBeVisible({ timeout: 45_000 });
    await expect(note).toContainText(/Bob didn't answer|The follow request timed out/);
    await expect(player.getByTestId("follow-card")).toHaveCount(0);
    await bob.context().close();
});

test("AV-090 Asking a bubble of three lists each answer; one no does not end it", async ({
    player,
    url,
    browser,
}, testInfo) => {
    test.slow();
    const bob = await joinBubble(browser, testInfo, player, url);
    const carol = await newPlayer(browser, testInfo, url, "Carol");
    await expectInBubble(player, "Carol");
    await askToFollow(player, testInfo);
    const card = player.getByTestId("follow-card");
    await expect(card).toContainText("You asked 2 people to follow you");
    await expect(card).toContainText("Anyone who says yes starts following right away");
    const list = player.getByTestId("follow-asked-list");
    await expect(list.getByTestId("follow-answer-waiting")).toHaveCount(2);
    // The card stays while someone is still deciding; once everyone answered it becomes the pill. So each answer
    // shows in the list while the other one is still waiting: a yes first, then (a second time) a no first.
    await tapOrClick(bob, testInfo, bob.getByTestId("follow-accept"));
    await expect(list.getByTestId("follow-answer-following")).toHaveCount(1);
    await expect(list.getByTestId("follow-answer-waiting")).toHaveCount(1);
    await tapOrClick(carol, testInfo, carol.getByTestId("follow-decline"));
    await expect(bob.getByTestId("follow-pill")).toContainText("Following Alice");
    await expect(player.getByTestId("follow-pill")).toContainText("Bob is following you");
    await tapOrClick(player, testInfo, player.getByTestId("follow-stop"));
    await expect(player.getByTestId("follow-pill")).toHaveCount(0);

    await askToFollow(player, testInfo);
    await expect(list.getByTestId("follow-answer-waiting")).toHaveCount(2);
    await tapOrClick(carol, testInfo, carol.getByTestId("follow-decline"));
    await expect(list.getByTestId("follow-answer-declined")).toHaveCount(1);
    await expect(list.getByTestId("follow-answer-waiting")).toHaveCount(1);
    await expect(card).toContainText("Anyone who says yes starts following right away");
    await tapOrClick(bob, testInfo, bob.getByTestId("follow-accept"));
    await expect(bob.getByTestId("follow-pill")).toContainText("Following Alice");
    await expect(player.getByTestId("follow-pill")).toContainText("Bob is following you");
    await carol.context().close();
    await bob.context().close();
});

test("AV-091 Phone menu row Ask to follow names who will be asked and closes the menu", async ({
    player,
    url,
    browser,
}, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const bob = await joinBubble(browser, testInfo, player, url);
    const menu = await openProfileMenu(player, testInfo);
    const row = menu.getByTestId("follow-menu-item");
    await expect(row).toContainText("Ask to follow");
    await expect(row.getByTestId("follow-menu-subtitle")).toHaveText("Asks Bob to follow you");
    await row.tap();
    await expect(menu).toBeHidden();
    await expect(player.getByTestId("follow-card")).toBeVisible();
    await bob.context().close();
});

test("AV-092 AV-093 F asks and F again cancels; Escape cancels the request or answers Not now", async ({
    player,
    url,
    browser,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only (keyboard)");
    const bob = await joinBubble(browser, testInfo, player, url);
    await player.locator("canvas").first().focus();
    await pressF(player);
    await expect(player.getByTestId("follow-card")).toContainText("You asked Bob to follow you");
    await expect(bob.getByTestId("follow-card")).toBeVisible();
    await pressF(player);
    await expect(player.getByTestId("follow-card")).toHaveCount(0);
    await expect(bob.getByTestId("follow-card")).toHaveCount(0);

    await pressF(player);
    await expect(player.getByTestId("follow-card")).toBeVisible();
    await player.keyboard.press("Escape");
    await expect(player.getByTestId("follow-card")).toHaveCount(0);
    await expect(bob.getByTestId("follow-note")).toContainText("Alice cancelled the follow request");

    await pressF(player);
    await expect(bob.getByTestId("follow-card")).toBeVisible();
    await bob.locator("canvas").first().focus();
    await bob.keyboard.press("Escape");
    await expect(bob.getByTestId("follow-card")).toHaveCount(0);
    await expect(player.getByTestId("follow-note")).toContainText("Bob said no");
    await bob.context().close();
});
