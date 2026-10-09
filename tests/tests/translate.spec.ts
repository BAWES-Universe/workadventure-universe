import { expect, test } from '@playwright/test';
import {publicTestMapUrl} from "./utils/urls";
import { getPage } from "./utils/auth";
import {isMobile} from "./utils/isMobile";

test.describe('Translation @nomobile', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isMobile(page), 'Skip on mobile devices');
  });
  test('can be switched to French', async ({ browser }) => {
    await using page = await getPage(browser, 'Alice', publicTestMapUrl("tests/mousewheel.json", "translate"))

    await page.getByTestId('action-user').click();         // new way
    await page.click('button:has-text("Settings")');
    // Language is a choice row in General: open it, then pick French
    await page.getByTestId('language').locator('button[aria-expanded]').click();
    await page.getByTestId('language').getByRole('option', { name: /^Français/ }).click();

    await page.reload();
    await page.getByTestId('action-user').click();         // new way
    await expect(page.locator('button:has-text("Paramètres")')).toBeVisible();


    await page.context().close();
  });
});
