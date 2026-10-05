import * as path from "path";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

class EntityEditor {
  async selectEntity(page: Page, nb: number, search?: string) {
    if (search != undefined) {
      await page.getByPlaceholder("Search").click();
      await page.getByPlaceholder("Search").fill(search);
    }

    // Wait for the entity to be displayed
    await expect(page.getByTestId("entity-item").nth(nb)).toHaveCount(1, { timeout: 30000 });
    // Click on the entity to select it
    await page.getByTestId("entity-item").nth(nb).click();

    // That's bad, but we need to wait a bit for the canvas to put the object.
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(1000);
  }

  async searchEntity(page: Page, search: string) {
    const startTime = Date.now();
    const timeout = 5000; // 5 seconds

    // Initial search
    await page.getByPlaceholder("Search").click();
    await page.getByPlaceholder("Search").fill(search);
    await this.wait2Frames(page);

    while (Date.now() - startTime < timeout) {
      // Check if we find at least one entity
      const count = await page.getByTestId("entity-item").count();
      if (count > 0) {
        return page.getByTestId("entity-item").nth(0);
      }

      // Nothing found? Maybe it's a race condition (we are after an upload and the entity list is not yet updated).
      // Let's wait a bit and try again.
      await page.getByPlaceholder("Search").click();
      await page.getByPlaceholder("Search").fill("");
      await this.wait2Frames(page);
      await page.getByPlaceholder("Search").fill(search);
      await this.wait2Frames(page);
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100); // Wait a bit before trying again
    }

    // If we arrive here, we had no success.
    return page.getByTestId("entity-item").nth(0);
  }

  async moveAndClick(page: Page, x: number, y: number) {
    await this.wait2Frames(page);
    await page.mouse.move(x, y);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "left" });
    await page.mouse.up({ button: "left" });
    await this.wait2Frames(page);
  }

  async moveAndRightClick(page: Page, x: number, y: number) {
    await this.wait2Frames(page);
    await page.mouse.move(x, y);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await this.wait2Frames(page);
  }

  // "Done" in the bar at the bottom stops placing the picked object.
  async clearEntitySelection(page: Page) {
    await page.getByTestId("placing-done").click();
    await expect(page.getByTestId("placing-done")).toHaveCount(0);
    await this.wait2Frames(page);
  }

  // The settings of the object you clicked on the map open from its "Settings" action.
  async openSettings(page: Page) {
    const settings = page.getByTestId("object-settings-page");
    if (await settings.isVisible()) return;
    await page.getByTestId("object-settings").click();
    await expect(settings).toBeVisible();
  }

  async addProperty(page: Page, property: string) {
    await this.openSettings(page);
    await page.getByTestId(property).click();
  }

  async setEntityName(page: Page, name: string) {
    await this.openSettings(page);
    await page.getByPlaceholder("MyObject").click();
    await page.getByPlaceholder("MyObject").fill(name);
    await page.getByPlaceholder("MyObject").press("Enter");
  }

  async setEntityDescription(page: Page, Description: string) {
    await this.openSettings(page);
    await page.getByText("+ Add description field").click();
    await page.getByPlaceholder("My object is a...").click();
    await page.getByPlaceholder("My object is a...").fill(Description);
    await page.getByPlaceholder("My object is a...").press("Enter");
  }

  async setEntitySearcheable(page: Page, value: boolean) {
    await this.openSettings(page);
    await expect(page.getByTestId('searchable')).toBeVisible();
    await page.getByTestId('searchable').click();
    await page.locator(".map-editor .sidebar input#searchable").setChecked(value);
  }

  // "Add your own" opens the upload guide, which holds the file input.
  private async openUploadGuide(page: Page) {
    if ((await page.getByTestId("uploadCustomAsset").count()) === 0) {
      await page.getByTestId("objects-add-your-own").click();
    }
    await expect(page.getByTestId("uploadCustomAsset")).toBeAttached();
  }

  async uploadTestAsset(page: Page) {
    await this.openUploadGuide(page);
    await page
      .getByTestId("uploadCustomAsset")
      .setInputFiles(path.join(__dirname, `../../assets/${this.getTestAssetFile()}`));
    await page.getByTestId("floatingObject").click();
    await this.applyEntityModifications(page);
  }

  async uploadTestAssetWithOddSize(page: Page) {
    await this.openUploadGuide(page);
    await page
      .getByTestId("uploadCustomAsset")
      .setInputFiles(path.join(__dirname, `../../assets/${this.getTestAssetFileWithOddSize()}`));
    await page.getByTestId("floatingObject").click();
    await this.applyEntityModifications(page);
  }

  async openEditEntityForm(page: Page) {
    await page.getByTestId("editEntity").click();
  }

  async applyEntityModifications(page: Page) {
    await page.getByTestId("applyEntityModifications").click();
    // Wait for a bit for the image to be uploaded.
    // TODO: find a way to be sure upload succeeded
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(1000);
    if(await page.getByTestId('entityImageLoader').isVisible({timeout: 2000})){
      // Check loader end
      await expect(page.getByTestId('entityImageLoader')).toHaveCount(0, { timeout: 30000 });
    }
    // Verify that there is no error message
    await expect(page.getByTestId("entityImageError")).toHaveCount(0);
    // Verify that the image uploaded is displayed in the list
    if(await page.getByTestId('clearCurrentSelection').isVisible()){
      // Back to the main list
      await page.getByTestId('clearCurrentSelection').click();
    }
  }

  async removeEntity(page: Page) {
    await page.getByTestId("removeEntity").click();
  }

  async setOpenLinkProperty(page: Page, link: string) {
    await this.openSettings(page);
    await page.locator(".map-editor .sidebar .properties-container input#tabLink").fill(link);
  }

  async setOpenFileProperty(page: Page) {
    await this.openSettings(page);
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.locator(".map-editor .sidebar .properties-container span#chooseUpload").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, `../../assets/ipsum-lorem.pdf`));
  }

  getTestAssetFile(){
    return `${this.getTestAssetName()}.png`;
  }

  getTestAssetFileWithOddSize(){
    return `${this.getTestAssetName()}OddSize.png`;
  }

  getTestAssetName() {
    return "testAsset";
  }

  private async wait2Frames(page: Page) {
    await page.evaluate(async () => {
      await window.e2eHooks.waitForNextFrame();
      await window.e2eHooks.waitForNextFrame();
    });
  }
}

export default new EntityEditor();
