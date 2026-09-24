import { expect, test } from "@playwright/test";
import Map from "../utils/map";
import { publicTestMapUrl } from "../utils/urls";
import chatUtils from "../utils/chat";
import { getPage } from "../utils/auth";
import { isMobile } from "../utils/isMobile";

test.describe("Proximity chat in the chat list @chat @nomobile @nowebkit", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName === "webkit" || isMobile(page), "Skip on WebKit and mobile");
  });

  test("is labelled as such while live, and keeps its own row once it ended", async ({ browser }) => {
    await using alice = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "toprow"));
    await Map.teleportToPosition(alice, 4 * 32, 5 * 32);
    await chatUtils.open(alice, false);

    const topRow = alice.getByTestId("proximityTopRow");

    // Alone: two tabs, no live card, and a hint that says how proximity chat starts.
    await expect(alice.getByTestId("chatTabChats")).toHaveAttribute("aria-selected", "true");
    await expect(alice.getByTestId("chatTabPeople")).toBeVisible();
    await expect(topRow).toBeHidden();
    await expect(alice.getByTestId("nearbyHint")).toBeVisible();

    // Someone arrives on the same map: the People tab counts them, still no live card.
    await using bob = await getPage(browser, "Bob", publicTestMapUrl("tests/E2E/empty.json", "toprow"));
    await expect(alice.getByTestId("chatTabPeopleCount")).toHaveText("2", { timeout: 20_000 });
    await expect(topRow).toBeHidden();

    // Bob walks over. Joining the bubble opens the proximity chat on its own, titled as such, with Bob underneath.
    await chatUtils.openUserList(bob, false);
    await chatUtils.UL_walkTo(bob, "Alice");
    await expect(alice.getByTestId("roomName")).toHaveText("Proximity Chat", { timeout: 20_000 });
    await expect(alice.getByTestId("threadNowLabel")).toHaveText("Talking now · With Bob");
    await expect(alice.getByTestId("threadSessionDividerLabel").last()).toHaveText("With Bob");
    await expect(alice.getByTestId("threadSessionDivider").last()).toHaveAttribute("data-current", "true");

    // Bob writes something.
    await expect(bob.getByTestId("roomName")).toHaveText("Proximity Chat", { timeout: 20_000 });
    await bob.getByTestId("messageInput").fill("see you at the demo");
    await bob.getByTestId("sendMessageButton").click();
    await expect(alice.getByText("see you at the demo")).toBeVisible({ timeout: 20_000 });

    // Back on the list: the live card is labelled as the proximity chat, with who you're with underneath.
    await chatUtils.closeTimeline(alice);
    await expect(topRow).toHaveAttribute("data-state", "withPeople");
    await expect(alice.getByTestId("proximityTopRowTitle")).toHaveText("Proximity Chat");
    await expect(alice.getByTestId("nearbyHint")).toBeHidden();

    // Bob walks away: the chat you had drops into the list as its own row, named after who was in it.
    await Map.teleportToPosition(bob, 20 * 32, 20 * 32);
    await expect(topRow).toBeHidden({ timeout: 20_000 });
    const row = alice.getByTestId("proximitySessionRow");
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("proximitySessionRowTitle")).toHaveText("Proximity Chat");
    await expect(row.getByTestId("proximitySessionRowNames")).toContainText("Bob");
    await expect(row.getByTestId("proximitySessionRowPreview")).toContainText("see you at the demo");

    // Opening it shows only that chat, read-only, with a way back to Bob.
    await row.click();
    await expect(alice.getByTestId("roomName")).toHaveText("Proximity Chat");
    await expect(alice.getByTestId("threadNowLabel")).toContainText("With Bob");
    await expect(alice.getByTestId("proximityEndedFooter")).toBeVisible();
    await expect(alice.getByTestId("messageInput")).toBeHidden();
    await expect(alice.getByTestId("proximityWayBack").first()).toHaveAttribute("data-kind", "walk");

    // People: the room comes first, with its count, and Bob is in it.
    await chatUtils.closeTimeline(alice);
    await alice.getByTestId("chatTabPeople").click();
    await expect(alice.getByTestId("peopleHereTitle")).toContainText("2 here");
    await expect(alice.getByTestId("walk-to-Bob")).toBeVisible();

    await bob.context().close();
    await alice.context().close();
  });
});
