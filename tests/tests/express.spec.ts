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

    test("should open edit mode with a right-click and rename a phrase", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "express"));

        // Right-click (long-press on touch screens) goes straight to edit mode, without playing anything.
        await page.getByTestId("express-button").click({ button: "right" });
        await expect(page.getByTestId("express-edit-title")).toBeVisible();

        await page.getByTestId("express-phrase-0").click();
        await page.getByTestId("express-phrase-input-0").fill("Hey there");
        await page.getByTestId("express-phrase-input-0").press("Enter");
        await expect(page.getByTestId("express-phrase-0")).toHaveText("Hey there");

        // Done leaves edit mode; the phrase is kept after a reload.
        await page.getByTestId("express-edit").click();
        await expect(page.getByTestId("express-input")).toBeVisible();
        await page.reload();
        await page.getByTestId("express-button").click();
        await expect(page.getByTestId("express-phrase-0")).toHaveText("Hey there");
    });

    test("should toggle edit mode with the pencil and leave it with Escape", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "express"));

        await page.getByTestId("express-button").click();
        await page.getByTestId("express-edit").click();
        await expect(page.getByTestId("express-edit-title")).toBeVisible();

        // Tapping an emote in edit mode picks a replacement instead of playing it.
        await page.getByTestId("express-emote-1").click();
        await expect(page.locator("emoji-picker")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("emoji-picker")).toBeHidden();
        await expect(page.getByTestId("express-edit-title")).toBeVisible();

        await page.keyboard.press("Escape");
        await expect(page.getByTestId("express-edit-title")).toBeHidden();
        await expect(page.getByTestId("express-tray")).toBeVisible();
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
