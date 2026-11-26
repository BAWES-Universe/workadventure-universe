import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { resetWamMaps } from "../utils/map-editor/uploader";
import Map from "../utils/map";
import { oidcMatrixUserLogin } from "../utils/oidc";
import { getPage } from "../utils/auth";
import ChatUtils from "./chatUtils";

test.setTimeout(180000);

/**
 * A new Brick's chat opens at once, under the Brick's own name, and a message written while the chat is being made is
 * shown faded and sent once the chat server has it.
 *
 * Orbit and the bot server are not part of the end-to-end stack, so their answers are made up here with page routes:
 * the sign-in, the Bricks and the "ask for the direct chat" call. The chat server (Synapse) is the real one. The
 * bot's own reply is not part of this test, only what the person sees while the chat is being made.
 *
 * This runs only when the stack has the bots module on (BRICK_E2E=1): without it there is no Chats list with Bricks.
 */
test.describe("Brick chat opens at once @oidc @matrix @nowebkit", () => {
    test.skip(!process.env.BRICK_E2E, "Needs the bots module on in the end-to-end stack (BRICK_E2E=1)");

    test.beforeEach(async ({ request, browserName }) => {
        test.skip(browserName === "webkit", "WebKit has issues with camera/microphone");
        await resetWamMaps(request);
        await ChatUtils.resetMatrixDatabase();
    });

    test.afterAll(async () => {
        await ChatUtils.resetMatrixDatabase();
    });

    const brick = {
        id: "e2e-brick",
        name: "Pixel",
        description: null,
        characterTextureId: "brick-orange",
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        hello: null,
    };

    async function json(route: Route, body: unknown): Promise<void> {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }

    async function fakeOrbit(page: Page, holdDirectChat: Promise<void>): Promise<void> {
        let made = false;
        await page.route("**/api/auth/session", (route) =>
            json(route, {
                version: 2,
                sessionId: `orb_sess_v2_${"a".repeat(64)}`,
                expiresAt: Date.now() + 60 * 60 * 1000,
            })
        );
        await page.route("**/api/bricks/default", (route) => json(route, { deleted: true }));
        await page.route("**/api/bricks", async (route) => {
            if (route.request().method() === "POST") {
                made = true;
                await json(route, { brick });
                return;
            }
            await json(route, { bricks: made ? [brick] : [] });
        });
        await page.route("**/api/bots/dm-status**", (route) => json(route, { bots: { [brick.id]: "online" } }));
        await page.route("**/api/bots/*/direct-chat", async (route) => {
            // The chat is "being made" until the test lets it go: the person sees the chat screen in the meantime
            await holdDirectChat;
            await json(route, { result: "wait" });
        });
    }

    test("a new Brick opens its chat at once, with no raw bot address, and a message written meanwhile is faded", async ({
        browser,
    }) => {
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await using page = await getPage(browser, "Alice", Map.url("empty"));
        await fakeOrbit(page, held);
        await oidcMatrixUserLogin(page);
        await ChatUtils.openChat(page);

        // Nothing in Chats shows the Brick's chat address
        await expect(page.getByText(/@bot_/)).toHaveCount(0);

        // Make a Brick: its chat is open at once, under its name, not under a raw address
        await page.getByTestId("chatBricksButton").click();
        await page.getByTestId("bricksNew").click();
        await page.getByTestId("newBrickName").fill(brick.name);
        await page.getByTestId("newBrickCreate").click();
        await expect(page.getByTestId("messageInput")).toBeVisible();
        await expect(page.getByText(brick.name).first()).toBeVisible();
        await expect(page.getByText(/@bot_/)).toHaveCount(0);

        // A message written while the chat is being made is shown, faded (not confirmed by the chat server yet)
        await page.getByTestId("messageInput").fill("Hello Pixel");
        await page.getByTestId("sendMessageButton").click();
        const written = page.locator(".message.sending", { hasText: "Hello Pixel" });
        await expect(written).toBeVisible();
        await expect(page.getByText(/@bot_/)).toHaveCount(0);

        release();
        await page.context().close();
    });
});
