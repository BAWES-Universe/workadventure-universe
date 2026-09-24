import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getPage } from "./utils/auth";
import { publicTestMapUrl } from "./utils/urls";
import { isMobile } from "./utils/isMobile";
import Map from "./utils/map";
import menu from "./utils/menu";

/**
 * Opens the Say popup with Enter, types a line and sends it.
 * The game ignores Enter for 500ms after the popup closes, so opening is retried until the popup shows.
 */
async function sendSay(page: Page, text: string) {
    await expect(async () => {
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("say-popup")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("say-popup")).toBeHidden();
}

/** Same as {@link sendSay}, for a Think (Ctrl+Enter). */
async function sendThink(page: Page, text: string) {
    await expect(async () => {
        await page.keyboard.down("Control");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Control");
        await expect(page.getByTestId("say-popup")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("say-popup")).toBeHidden();
}

test.describe("Say bubbles @nomobile @nowebkit", () => {
    test.beforeEach(
        "Ignore tests on mobilechromium because map editor not available for mobile devices",
        ({ page }) => {
            // Map Editor not available on mobile
            test.skip(isMobile(page), 'Map editor is not available on mobile');
        }
    );

    test("should display a speech bubble and be received by other users", async ({ browser }) => {
        // Create two browser contexts for Alice and Bob
        await using alicePage = await getPage(browser, 'Alice',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles")
        );

        
        await using bobPage = await getPage(browser, 'Bob',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles")
        );
        
        // Wait for both users to be connected
        await expect(alicePage.getByText("Bob", { exact: true })).toBeVisible({ timeout: 20_000 });
        await Map.teleportToPosition(alicePage, 15*12, 15*12);
        
        // Alice sends a message
        await alicePage.keyboard.press("Enter");
        await alicePage.keyboard.type("Hello Bob, this is a test message!");
        await alicePage.keyboard.press("Enter");

        // Verify the speech bubble is visible and contains the correct text for both users
        // Say lines stack, so target the newest one
        await expect(alicePage.locator(".say-bubble").last()).toBeAttached();
        await expect(alicePage.locator(".say-bubble").last()).toHaveText("Hello Bob, this is a test message!");

        await expect(bobPage.locator(".say-bubble").last()).toBeAttached();
        await expect(bobPage.locator(".say-bubble").last()).toHaveText("Hello Bob, this is a test message!");

        // Close both pages
        await alicePage.context().close();
        await bobPage.context().close();
    });

    test("should display a thinking bubble and be received by other users", async ({ browser }) => {
        // Create two browser contexts for Alice and Bob
        await using alicePage = await getPage(browser, 'Alice',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles")
        );
        //await Map.teleportToPosition(alicePage, 0, 0);
        await using bobPage = await getPage(browser, 'Bob',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles")
        );

        // Wait for both users to be connected
        await expect(alicePage.getByText("Bob", { exact: true })).toBeVisible({timeout : 20_000});
        await Map.teleportToPosition(alicePage, 15*12, 15*12);

        // Alice sends a thinking message
        await alicePage.keyboard.down("Control");
        await alicePage.keyboard.press("Enter");
        await alicePage.keyboard.up("Control");
        await alicePage.keyboard.type("This is a thinking message for Bob!");
        await alicePage.keyboard.press("Enter");

        // Verify the thinking bubble is visible and contains the correct text for both users
        await expect(alicePage.locator(".thinking-cloud")).toBeAttached();
        await expect(alicePage.locator(".thinking-cloud")).toHaveText("This is a thinking message for Bob!");

        await expect(bobPage.locator(".thinking-cloud")).toBeAttached();
        await expect(bobPage.locator(".thinking-cloud")).toHaveText("This is a thinking message for Bob!");

        // Close both pages
        await alicePage.context().close();
        await bobPage.context().close();
    });

    test("should stack two quick lines and show both to other users", async ({ browser }) => {
        await using alicePage = await getPage(browser, 'Alice',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles_stack")
        );
        await using bobPage = await getPage(browser, 'Bob',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles_stack")
        );

        await expect(alicePage.getByText("Bob", { exact: true })).toBeVisible({ timeout: 20_000 });
        await Map.teleportToPosition(alicePage, 15*12, 15*12);

        await sendSay(alicePage, "First line");
        await sendSay(alicePage, "Second line");

        // Both lines are visible, oldest on top, newest at the bottom
        await expect(alicePage.locator(".say-bubble")).toHaveText(["First line", "Second line"]);
        await expect(bobPage.locator(".say-bubble")).toHaveText(["First line", "Second line"]);

        await alicePage.context().close();
        await bobPage.context().close();
    });

    test("should cap the stack at three lines and let every line expire", async ({ browser }) => {
        await using alicePage = await getPage(browser, 'Alice',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles_cap")
        );
        await using bobPage = await getPage(browser, 'Bob',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles_cap")
        );

        await expect(alicePage.getByText("Bob", { exact: true })).toBeVisible({ timeout: 20_000 });
        await Map.teleportToPosition(alicePage, 15*12, 15*12);

        await sendSay(alicePage, "Line 1");
        await sendSay(alicePage, "Line 2");
        await sendSay(alicePage, "Line 3");
        await sendSay(alicePage, "Line 4");

        // The 4th line removes the oldest one
        await expect(alicePage.locator(".say-bubble")).toHaveText(["Line 2", "Line 3", "Line 4"]);
        await expect(bobPage.locator(".say-bubble")).toHaveText(["Line 2", "Line 3", "Line 4"]);

        // Every line fades on its own 5s timer
        await expect(alicePage.locator(".say-bubble")).toHaveCount(0, { timeout: 10_000 });
        await expect(bobPage.locator(".say-bubble")).toHaveCount(0, { timeout: 10_000 });

        await alicePage.context().close();
        await bobPage.context().close();
    });

    test("should keep the Say line when a Think is cleared by moving", async ({ browser }) => {
        await using alicePage = await getPage(browser, 'Alice',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles_think")
        );
        await using bobPage = await getPage(browser, 'Bob',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles_think")
        );

        await expect(alicePage.getByText("Bob", { exact: true })).toBeVisible({ timeout: 20_000 });
        await Map.teleportToPosition(alicePage, 15*12, 15*12);

        await sendSay(alicePage, "Said out loud");
        await sendThink(alicePage, "Thought quietly");

        await expect(bobPage.locator(".say-bubble")).toHaveText(["Said out loud"]);
        await expect(bobPage.locator(".thinking-cloud")).toHaveText("Thought quietly");

        // Moving clears the Think only
        await Map.walkTo(alicePage, "ArrowRight", 300);

        await expect(alicePage.locator(".thinking-cloud")).toHaveCount(0);
        await expect(bobPage.locator(".thinking-cloud")).toHaveCount(0);
        await expect(alicePage.locator(".say-bubble")).toHaveText(["Said out loud"]);
        await expect(bobPage.locator(".say-bubble")).toHaveText(["Said out loud"]);

        await alicePage.context().close();
        await bobPage.context().close();
    });

    test("should display a Say and Think bubble via action menu", async ({ browser }) => {
        // Create two browser contexts for Alice and Bob
        await using alicePage = await getPage(browser, 'Alice',
            publicTestMapUrl("tests/E2E/empty.json", "say_bubbles")
        );

        // Click on the emoji button to open the action menu
        await menu.openEmoji(alicePage);
        // Open say popup
        await menu.clickOnSayBubble(alicePage);
        // Close the Say popup
        await menu.closeSayPopup(alicePage);
        // Open think popup
        await menu.clickOnThinkBubble(alicePage);

        await alicePage.context().close();
    });
});
