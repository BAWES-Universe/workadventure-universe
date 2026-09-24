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

  test("names the people you are with, and tells the truth when you are alone", async ({ browser }) => {
    await using alice = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "toprow"));
    await Map.teleportToPosition(alice, 4 * 32, 5 * 32);
    await chatUtils.open(alice, false);

    const topRow = alice.getByTestId("proximityTopRow");

    // Alone: what the bubble knows, what the world knows, and a way to find people.
    await expect(topRow).toHaveAttribute("data-state", "alone");
    await expect(alice.getByTestId("proximityTopRowTitle")).toHaveText("No one nearby");
    // Other specs may have people elsewhere in the same world, but nobody else is on this map yet.
    await expect(alice.getByTestId("proximityTopRowSubtitle")).toContainText(
      /No one else is in this world right now|^0 others/
    );
    await expect(alice.getByTestId("proximityTopRowSeeWhoIsHere")).toBeVisible();

    // Someone arrives on the same map: counted from the world, not from the bubble.
    await using bob = await getPage(browser, "Bob", publicTestMapUrl("tests/E2E/empty.json", "toprow"));
    await expect(alice.getByTestId("proximityTopRowSubtitle")).toContainText(/^1 other (in|on)/, { timeout: 20_000 });
    await expect(topRow).toHaveAttribute("data-state", "alone");

    // Bob walks over: the row is named after him.
    await chatUtils.openUserList(bob, false);
    await chatUtils.UL_walkTo(bob, "Alice");
    await expect(topRow).toHaveAttribute("data-state", "withPeople", { timeout: 20_000 });
    await expect(alice.getByTestId("proximityTopRowTitle")).toHaveText("Bob");
    await expect(alice.getByTestId("proximityTopRowSeeWhoIsHere")).toBeHidden();

    // Tapping the row opens the same proximity timeline as before.
    await alice.getByTestId("toggleDisplayProximityChat").click();
    await expect(alice.getByTestId("roomName")).toHaveText("Proximity Chat");
    await expect(alice.locator(".messageTextBody")).toContainText("New discussion with Bob");

    await bob.context().close();
    await alice.context().close();
  });
});
