import { test, expect } from "@playwright/test";
import { getPage } from "./utils/auth";
import { publicTestMapUrl } from "./utils/urls";
import Map from "./utils/map";

test.describe("Express button @nowebkit", () => {
    test("should send a say bubble from the Express tray", async ({ browser }) => {
        await using alicePage = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "express"));
        await using bobPage = await getPage(browser, "Bob", publicTestMapUrl("tests/E2E/empty.json", "express"));

        await expect(alicePage.getByText("Bob", { exact: true })).toBeVisible({ timeout: 20_000 });
        await Map.teleportToPosition(alicePage, 15 * 12, 15 * 12);

        await alicePage.getByTestId("express-button").click();
        await expect(alicePage.getByTestId("express-tray")).toBeVisible();

        await alicePage.getByTestId("express-input").fill("Hello from Express!");
        await alicePage.getByTestId("express-send").click();

        // Sending closes the tray and shows the bubble to everyone nearby
        await expect(alicePage.getByTestId("express-tray")).toBeHidden();
        await expect(alicePage.locator(".say-bubble")).toHaveText("Hello from Express!");
        await expect(bobPage.locator(".say-bubble")).toHaveText("Hello from Express!");
    });

    test("should send a think bubble with Enter", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "express"));

        await page.getByTestId("express-button").click();
        await page.getByTestId("express-think-toggle").click();
        await page.getByTestId("express-input").fill("Hmm...");
        await page.getByTestId("express-input").press("Enter");

        await expect(page.locator(".thinking-cloud")).toHaveText("Hmm...");
    });

    test("should play an emote and close the tray", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "express"));

        await page.getByTestId("express-button").click();
        await page.getByTestId("express-emotes").getByRole("button").first().click();

        await expect(page.getByTestId("express-tray")).toBeHidden();
    });

    test("should send a quick phrase as a say bubble", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "express"));

        await page.getByTestId("express-button").click();
        await expect(page.getByTestId("express-phrases")).toBeVisible();
        await page.getByTestId("express-phrase-2").click();

        await expect(page.getByTestId("express-tray")).toBeHidden();
        await expect(page.locator(".say-bubble")).toHaveText("Thanks");
    });

    test("should hide the phrases when custom ones don't fit on one line", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "express"));

        await page.evaluate(() => {
            const long = { text: "A rather long phrase!!!" };
            localStorage.setItem("quickPhrases", JSON.stringify([long, long, long, long]));
        });
        await page.reload();

        await page.getByTestId("express-button").click();
        await expect(page.getByTestId("express-tray")).toBeVisible();
        await expect(page.getByTestId("express-phrases")).toBeHidden();
    });

    test("should hide the Express button while the chat is open", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "express"));

        await expect(page.getByTestId("express-button")).toBeVisible();
        await page.getByTestId("chat-btn").click();
        await expect(page.getByTestId("express-button")).toBeHidden();
        await page.getByTestId("chat-btn").click();
        await expect(page.getByTestId("express-button")).toBeVisible();
    });
});
