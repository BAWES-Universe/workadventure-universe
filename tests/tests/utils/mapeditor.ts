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
    await this.pickTool(page, "AreaEditor");
    await expect(page.getByTestId("edit-panel")).toBeVisible();
  }

  async openEntityEditor(page: Page) {
    await this.pickTool(page, "EntityEditor");
    await expect(page.getByTestId("edit-panel")).toBeVisible();
  }

  /**
   * Lights a tool on the rail. The editor opens with Objects already lit and its panel open, and tapping the lit
   * tool closes its panel, so a tool that is already lit with its panel open is left as it is.
   */
  private async pickTool(page: Page, tool: string) {
    const button = page
      .locator(
        `section.side-bar-container .side-bar .tool-button button#${tool}`
      )
      .first();
    await button.waitFor({ state: "visible" });
    const lit = (await button.getAttribute("aria-pressed")) === "true";
    const panelOpen = await page.getByTestId("edit-panel").isVisible();
    if (lit && panelOpen) {
      return;
    }
    await button.click();
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
    const button = page
      .locator(
        "section.side-bar-container .side-bar .tool-button button#TrashEditor"
      )
      .first();
    await button.waitFor({ state: "visible" });
    // Delete has no panel: tapping it while lit puts it down, so it is only tapped when it is not lit yet.
    if ((await button.getAttribute("aria-pressed")) === "true") {
      return;
    }
    await button.click();
  }
}

export default new MapEditor();
