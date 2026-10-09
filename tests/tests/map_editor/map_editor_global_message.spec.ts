import {expect, test} from "@playwright/test";
import Map from "../utils/map";
import Megaphone from "../utils/map-editor/megaphone";
import {resetWamMaps} from "../utils/map-editor/uploader";
import Menu from "../utils/menu";
import {map_storage_url} from "../utils/urls";
import {getPage} from "../utils/auth";
import {isMobile} from "../utils/isMobile";

test.setTimeout(240_000); // Fix Webkit that can take more than 60s
test.use({
    baseURL: map_storage_url,
});

test.describe("Map editor @oidc @nomobile @nowebkit", () => {
    test.beforeEach(
        "Ignore tests on mobile because map editor not available for mobile devices",
        ({ page }) => {
            // Map Editor not available on mobile
            test.skip(isMobile(page), 'Map editor is not available on mobile');
        }
    );

    test.beforeEach("Ignore tests on webkit because of issue with camera and microphone", ({ browserName }) => {
        // WebKit has issue with camera
        test.skip(browserName === 'webkit', 'WebKit has issues with camera/microphone');
    });

    test("Successfully test global message text and sound feature", async ({ browser, request }) => {
        await resetWamMaps(request);
        await using page = await getPage(browser, "Admin1", Map.url("empty"));

        // Move user and not create discussion with the second user
        await Map.teleportToPosition(page, 5 * 32, 5 * 32);

        // Second browser
        await using page2 = await getPage(browser, "Bob", Map.url("empty"));

        // A room nobody has set up: the admin has the Broadcast card, Bob has nothing to broadcast with
        await Menu.isThereMegaphoneButton(page);
        await expect(page2.getByTestId("map-menu")).toBeHidden();

        // Letting everyone go live gives Bob the Broadcast card too
        await Megaphone.openBroadcastSettings(page);
        await Megaphone.saveBroadcastSettings(page, "everyone", "ROOM");
        await Menu.isThereMegaphoneButton(page2);

        // TODO : create this test in admin part (global message and text audio message if an admin feature)

        await page2.context().close();
        await page.close();
        await page.context().close();
        // TODO IN THE FUTURE (PlayWright doesn't support it) : Add test if sound is correctly played
    });

});
