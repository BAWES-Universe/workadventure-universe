import { expect, type Page } from "@playwright/test";
import { expectInViewport } from "./viewport";

class MapEditor {
  async openConfigureMyRoom(page: Page) {
    // Room settings left the rail: the "4" key still opens it.
    await page
      .locator("canvas")
      .first()
      .click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("4");
    await expectInViewport(".configure-my-room", page);
  }

  async openAreaEditor(page: Page) {
    await page
      .locator(
        "section.side-bar-container .side-bar .tool-button button#AreaEditor"
      )
      .first()
      .click();
    await expect(page.getByTestId("edit-panel")).toBeVisible();
  }

  async openEntityEditor(page: Page) {
    await page
      .locator(
        "section.side-bar-container .side-bar .tool-button button#EntityEditor"
      )
      .first()
      .click(/*{force: true}*/);
    // note: set click force to true because sometimes a property tooltip is overlapping the button
    await expect(page.getByTestId("edit-panel")).toBeVisible();
  }

  async openExploration(page: Page) {
    // "Look around" lives in the zoom column, for everyone, not on the editor's rail.
    await page.getByTestId("map-overview-button").first().click();
    await expect(page.getByTestId("look-around")).toBeVisible();
  }

  async openPlaces(page: Page) {
    await page.getByTestId("look-around-places-button").click();
    await expect(page.getByTestId("look-around-places")).toBeVisible();
  }

  async openTrashEditor(page: Page) {
    await page
      .locator(
        "section.side-bar-container .side-bar .tool-button button#TrashEditor"
      )
      .first()
      .click();
  }
}

export default new MapEditor();
