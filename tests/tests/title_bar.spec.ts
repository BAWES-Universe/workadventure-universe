import { test, expect, type Page } from "@playwright/test";
import { getPage } from "./utils/auth";
import { publicTestMapUrl } from "./utils/urls";

/**
 * The installed computer app's own title bar (#1019). A browser tab is not an installed app, so what Chrome gives
 * one (navigator.windowControlsOverlay and its media query) is stood in for before the page loads: a 33px strip with
 * Chrome's own buttons taking the last 138px.
 */
const CHROME_BUTTONS_WIDTH = 138;
const STRIP_HEIGHT = 33;

async function installOverlay(page: Page): Promise<void> {
    // "Copy" writes to the clipboard; a headless browser asks for the right first.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(
        ({ buttons, height }) => {
            const listeners = new Set<() => void>();
            const overlay = {
                visible: true,
                getTitlebarAreaRect: () => ({ x: 0, y: 0, width: window.innerWidth - buttons, height }),
                addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
                removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
            };
            Object.defineProperty(navigator, "windowControlsOverlay", { value: overlay, configurable: true });
            const realMatchMedia = window.matchMedia.bind(window);
            window.matchMedia = (query: string) =>
                /display-mode:\s*window-controls-overlay/.test(query)
                    ? ({
                          matches: true,
                          media: query,
                          onchange: null,
                          addEventListener() {},
                          removeEventListener() {},
                          addListener() {},
                          removeListener() {},
                          dispatchEvent: () => false,
                      } as unknown as MediaQueryList)
                    : realMatchMedia(query);
            window.addEventListener("resize", () => listeners.forEach((listener) => listener()));
            (window as unknown as { __wco: unknown }).__wco = {
                setVisible: (visible: boolean) => {
                    overlay.visible = visible;
                    listeners.forEach((listener) => listener());
                },
            };
        },
        { buttons: CHROME_BUTTONS_WIDTH, height: STRIP_HEIGHT }
    );
}

test.describe("Universe title bar @nomobile @nowebkit @nofirefox", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("shows the strip, moves the page under it and opens People and the invite card", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "title_bar"), {
            pageCreatedHook: installOverlay,
        });

        const strip = page.getByTestId("titleBar");
        await expect(strip).toBeVisible();
        const box = await strip.boundingBox();
        expect(box).toMatchObject({ x: 0, y: 0, height: STRIP_HEIGHT, width: 1280 });

        // The whole page starts under the strip and ends at the window's bottom.
        const body = await page.evaluate(() => {
            const rect = document.body.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: window.innerHeight };
        });
        expect(body.top).toBe(STRIP_HEIGHT);
        expect(body.bottom).toBe(body.height);

        // "N here" is the People tab's count, and opens the tab.
        const here = page.getByTestId("titleBarHere");
        await expect(here).toHaveText(/1 here/);
        await here.click();
        await expect(page.getByTestId("chatInviteFooter")).toBeVisible();

        // Invite opens the same card as chat's, under its button, with the same words.
        const invite = page.getByTestId("titleBarInvite");
        await expect(invite).toContainText("Invite someone to join");
        await invite.click();
        const card = page.getByTestId("titleBarInviteCard");
        await expect(card).toBeVisible();
        await expect(card.getByTestId("chatInviteLink")).toHaveValue(/title_bar|empty/);
        await card.getByTestId("chatInviteCopy").click();
        await expect(card.getByTestId("chatInviteCopy")).toContainText("Copied");

        // Esc closes it.
        await page.keyboard.press("Escape");
        await expect(card).toBeHidden();
    });

    test("keeps its words while they fit and drops them to icons when they do not", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "title_bar"), {
            pageCreatedHook: installOverlay,
        });
        await expect(page.getByTestId("titleBar")).toBeVisible();

        await page.setViewportSize({ width: 820, height: 640 });
        await expect(page.getByTestId("titleBarInvite")).toContainText("Invite someone to join");
        await expect(page.getByTestId("titleBarFullscreen")).toContainText("Full screen");

        await page.setViewportSize({ width: 420, height: 640 });
        await expect(page.getByTestId("titleBarInvite")).not.toContainText("Invite someone to join");
        await expect(page.getByTestId("titleBarInvite")).toHaveAttribute("aria-label", "Invite someone to join");
        await expect(page.getByTestId("titleBarFullscreen")).not.toContainText("Full screen");
    });

    test("steps aside when the browser takes the bar back (full screen, or Chrome's bar switched on)", async ({
        browser,
    }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "title_bar"), {
            pageCreatedHook: installOverlay,
        });
        await expect(page.getByTestId("titleBar")).toBeVisible();

        await page.evaluate(() => (window as unknown as { __wco: { setVisible(v: boolean): void } }).__wco.setVisible(false));
        await expect(page.getByTestId("titleBar")).toBeHidden();
        const top = await page.evaluate(() => document.body.getBoundingClientRect().top);
        expect(top).toBe(0);
    });
});

test.describe("Without an installed app's title bar @nomobile", () => {
    test("a browser tab shows no strip and the page starts at the top", async ({ browser }) => {
        await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/E2E/empty.json", "title_bar"));
        await expect(page.getByTestId("titleBar")).toHaveCount(0);
        const top = await page.evaluate(() => document.body.getBoundingClientRect().top);
        expect(top).toBe(0);
    });
});
