import { expect, test } from "@playwright/test";
import { publicTestMapUrl } from "./utils/urls";
import Map from "./utils/map";
import Menu from "./utils/menu";
import { getPage } from "./utils/auth"
import {isMobile} from "./utils/isMobile";

test.setTimeout(180_000);
test.describe("Connection @nomobile @nowebkit", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      isMobile(page) || browserName === "webkit",
      "Skip on mobile and WebKit due to limitations"
    );
  });
  test("can succeed even if WorkAdventure starts while pusher is down @slow",
      async ({ browser }) => {
    await using page = await getPage(browser, 'Alice', publicTestMapUrl("tests/mousewheel.json", "reconnect"));

    //Simulation of offline network
    await page.context().setOffline(true);

    // The calm reconnecting screen, never an error ("You're offline" once it has lasted a while offline).
    await expect(page.getByRole("heading", { name: /Reconnecting|You're offline/ })).toBeVisible({
        timeout: 180_000,
    });
    await expect(page.getByText("Unable to connect to the Universe")).toBeHidden();

    //Reconnect
    await page.context().setOffline(false);

    await Menu.waitForMapLoad(page, 180_000);
    /*await expect(page.locator("button#menuIcon")).toBeVisible({
      timeout: 180_000,
    });*/

    await page.context().close();
  });

  test("can succeed on WAM file even if WorkAdventure starts while pusher is down @slow",
      async ({ browser }) => {
    await using page = await getPage(browser, 'Alice', Map.url("empty"));

    //Simulation of offline network
    await page.context().setOffline(true);

    // The calm reconnecting screen, never an error ("You're offline" once it has lasted a while offline).
    await expect(page.getByRole("heading", { name: /Reconnecting|You're offline/ })).toBeVisible({
      timeout: 180_000,
    });
    await expect(page.getByText("Unable to connect to the Universe")).toBeHidden();

    //Reconnect
    await page.context().setOffline(false);

    await Menu.waitForMapLoad(page, 180_000);

    await page.context().close();
  });

  test("keeps the room, the bar and the chat on screen while it gets back in (#958)", async ({ browser }) => {
    // The game's connection, closed from the page side as a phone does to an app in the background.
    let dropConnection: (() => void) | undefined;
    await using page = await getPage(browser, "Alice", publicTestMapUrl("tests/mousewheel.json", "reconnect"), {
      // Set up before the page opens, so the first connection already goes through it.
      pageCreatedHook: async (page) => {
        await page.routeWebSocket(/\/ws\/room/, (ws) => {
          const server = ws.connectToServer();
          dropConnection = () => {
            void ws.close({ code: 4000, reason: "test drop" });
            void server.close();
          };
        });
      },
    });

    await page.getByTestId("chat-btn").click();
    await expect(page.locator("#chat")).toBeVisible();

    expect(dropConnection).toBeDefined();
    dropConnection?.();

    // The room as it was, with the chat still open over it: no full screen.
    await expect(page.getByTestId("reconnect-room-picture")).toBeVisible();
    await expect(page.locator("#chat")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reconnecting" })).toBeHidden();

    // Back in: the live game again, the chat still open.
    await expect(page.getByTestId("reconnect-room-picture")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("microphone-button")).toBeVisible();
    await expect(page.locator("#chat")).toBeVisible();

    await page.context().close();
  });
});
