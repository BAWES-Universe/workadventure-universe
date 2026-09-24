import { expect, test } from "@playwright/test";
import Map from "../utils/map";
import { publicTestMapUrl } from "../utils/urls";
import chatUtils from "../utils/chat";
import { getPage } from "../utils/auth";
import { isMobile } from "../utils/isMobile";

test.describe("Chat top row @chat @nomobile @nowebkit", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName === "webkit" || isMobile(page), "Skip on WebKit and mobile");
  });

  test("says who is on the map, and shows a live card only while you are with someone", async ({ browser }) => {
    await using alice = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "toprow"));
    await Map.teleportToPosition(alice, 4 * 32, 5 * 32);
    await chatUtils.open(alice, false);

    const topRow = alice.getByTestId("proximityTopRow");
    const subtitle = alice.getByTestId("hereStripSubtitle");

    // Alone: the strip says so, there is no live card, and a hint says how nearby chat starts.
    await expect(alice.getByTestId("hereStripPeople")).toBeVisible();
    // Other specs may have people elsewhere in the same world, but nobody else is on this map yet.
    await expect(subtitle).toContainText(/^Only you here/);
    await expect(topRow).toBeHidden();
    await expect(alice.getByTestId("nearbyHint")).toBeVisible();

    // Someone arrives on the same map: counted from the world, not from the bubble. Still no live card.
    await using bob = await getPage(browser, "Bob", publicTestMapUrl("tests/E2E/empty.json", "toprow"));
    await expect(subtitle).toHaveText("You & Bob", { timeout: 20_000 });
    await expect(topRow).toBeHidden();

    // Bob walks over: the live card appears, named after him.
    await chatUtils.openUserList(bob, false);
    await chatUtils.UL_walkTo(bob, "Alice");
    await expect(topRow).toHaveAttribute("data-state", "withPeople", { timeout: 20_000 });
    await expect(alice.getByTestId("proximityTopRowTitle")).toHaveText("Bob");
    await expect(alice.getByTestId("nearbyHint")).toBeHidden();

    // Tapping the card opens the same proximity timeline as before, titled with who you're with.
    await alice.getByTestId("toggleDisplayProximityChat").click();
    await expect(alice.getByTestId("roomName")).toHaveText("Bob");
    await expect(alice.getByTestId("threadNowLabel")).toContainText("Talking now");
    await expect(alice.getByTestId("threadSessionDividerLabel").last()).toHaveText("With Bob");
    await expect(alice.getByTestId("threadSessionDivider").last()).toHaveAttribute("data-current", "true");

    await bob.context().close();
    await alice.context().close();
  });
});
