import type {Page, TestInfo} from "@playwright/test";

/**
 * Brings the n-th item (1 based) of the "Open here" window to the front: its tab on a desktop, and on an upright phone
 * the entry of the sheet's list, behind the "N open" chip.
 */
export async function openHereItem(page: Page, testInfo: TestInfo, n: number): Promise<void> {
    if (testInfo.project.name.startsWith('mobile')) {
        // Every item keeps its own row (loaded, hidden when not shown): only the shown row's chip counts.
        await page.locator('[data-testid="openHereList"]:visible').click();
        await page.getByTestId(`openHereListItem${n}`).click();
        return;
    }
    await page.getByTestId(`tab${n}`).click();
}
