import {expect, test} from '@playwright/test';
import {maps_domain, play_url, publicTestMapUrl} from "./utils/urls";
import { getPage} from "./utils/auth";
import {evaluateScript} from "./utils/scripting";
import {getCoWebsiteIframe} from "./utils/iframe";

test.describe('Scripting WA.nav.openCoWebsite function', () => {
    test('one can open several tabs that stay loaded', async ({ browser }, testInfo) => {
        await using page = await getPage(browser, 'Alice', publicTestMapUrl("tests/E2E/empty.json", "scripting_open_cowebsite"));

        // On an upright phone the items are in the sheet's list, behind the "N open" chip, not in a tab strip
        const openTab = async (n: number) => {
            if (testInfo.project.name.startsWith('mobile')) {
                await page.getByTestId('openHereList').click();
                await page.getByTestId(`openHereListItem${n}`).click();
            } else {
                await page.getByTestId(`tab${n}`).click();
            }
        };

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

        await openTab(1);
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toHaveValue('tab1');
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toBeVisible();
        await expect(page.locator('iframe[title="Cowebsite"]').nth(1)).toBeHidden();

        await openTab(2);
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toHaveValue('tab2');
        await expect(getCoWebsiteIframe(page).locator('[id="\\#text_input"]')).toBeVisible();


        await page.context().close();
    });
});
