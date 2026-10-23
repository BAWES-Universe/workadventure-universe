import {expect, test, type Page} from '@playwright/test';
import {maps_domain, play_url, publicTestMapUrl} from "./utils/urls";
import { getPage} from "./utils/auth";
import {evaluateScript} from "./utils/scripting";
import {getCoWebsiteIframe} from "./utils/iframe";

// On an upright phone the items sit in a sheet without tabs: the "N open" list picks one.
async function pickItem(page: Page, position: number) {
    const tab = page.getByTestId(`tab${position}`);
    if (await tab.isVisible()) {
        await tab.click();
        return;
    }
    // Each item has its own row with the chip, only the picked one's is showing.
    await page.locator('[data-testid="openHereList"]:visible').click();
    await page.getByTestId('openHereListMenu').getByRole('menuitem').nth(position - 1).click();
}

test.describe('Scripting WA.nav.openCoWebsite function', () => {
    test('one can open several tabs that stay loaded', async ({ browser}) => {
        await using page = await getPage(browser, 'Alice', publicTestMapUrl("tests/E2E/empty.json", "scripting_open_cowebsite"));

        const url = new URL(
            `//${maps_domain}/tests/CoWebsite/page_with_input.html`,
            play_url
        ).toString();

        await evaluateScript(page, async ({url}) => {
            await WA.nav.openCoWebSite(url);
            return;
        }, {
            url
        });

        await page.locator('iframe[title="Cowebsite"]').contentFrame().locator('[id="\\#text_input"]').click();
        await page.locator('iframe[title="Cowebsite"]').contentFrame().locator('[id="\\#text_input"]').fill('tab1');
        await page.locator('iframe[title="Cowebsite"]').contentFrame().locator('html').click();

        // Open a second tab
        await evaluateScript(page, async ({url}) => {
            await WA.nav.openCoWebSite(url);
            return;
        }, {
            url: url
        });

        // Check that the input field is empty
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toHaveValue('');
        await getCoWebsiteIframe(page).locator('[id="\\#text_input"]').fill('tab2');

        await pickItem(page, 1);
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toHaveValue('tab1');
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toBeVisible();
        await expect(page.locator('iframe[title="Cowebsite"]').nth(1)).toBeHidden();

        await pickItem(page, 2);
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toHaveValue('tab2');
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toBeVisible();


        await page.context().close();
    });
});
