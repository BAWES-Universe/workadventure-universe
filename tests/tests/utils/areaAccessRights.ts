import type { Page} from "@playwright/test";
import {expect} from "@playwright/test";
import AreaEditor from "./map-editor/areaEditor";
import EntityEditor from "./map-editor/entityEditor";
import MapEditor from "./mapeditor";
import Menu from "./menu";

interface Coordinates {
  x: number;
  y: number;
}

class AreaAccessRights {
  private areaSize: { topLeft: Coordinates; bottomRight: Coordinates } = {
    topLeft: { x: 1 * 32 * 1.5, y: 2 * 32 * 1.5 },
    bottomRight: { x: 9 * 32 * 1.5, y: 7 * 32 * 1.5 },
  };

  public entityPositionInArea: Coordinates = { x: 4 * 32 * 1.5, y: 4 * 32 * 1.5 };
  public entityPositionOutsideArea: Coordinates = { x: 8 * 32 * 1.5, y: 8 * 32 * 1.5 };

  public mouseCoordinatesToClickOnEntityInsideArea = {
    x: this.entityPositionInArea.x + 10,
    y: this.entityPositionInArea.y,
  };

  /**
   * The same point of the map, on the screen of someone playing (not editing) who just joined. The empty test map
   * (10 x 10 tiles, shown at 1.5x) is smaller than the screen: while playing it sits in the middle of the screen,
   * while editing in its top left corner, where the coordinates above are measured.
   */
  whilePlaying(page: Page, point: Coordinates): Coordinates {
    const mapSize = 10 * 32 * 1.5;
    const viewport = page.viewportSize() ?? { width: mapSize, height: mapSize };
    return {
      x: point.x + Math.max(0, (viewport.width - mapSize) / 2),
      y: point.y + Math.max(0, (viewport.height - mapSize) / 2),
    };
  }

  public mouseCoordinatesToClickOnEntityOutsideArea = {
    x: this.entityPositionOutsideArea.x + 10,
    y: this.entityPositionOutsideArea.y,
  };

  async openAreaEditorAndAddAreaWithRights(
    page: Page,
    writeRights: string[] = [],
    readRights: string[] = []
  ) {
    await MapEditor.openAreaEditor(page);
    await AreaEditor.drawArea(
      page,
      this.areaSize.topLeft,
      this.areaSize.bottomRight
    );
    await AreaEditor.setAreaRightProperty(page, writeRights, readRights);
  }

  async openAreaEditorAndAddArea(page: Page, topLeft?: Coordinates, bottomRight?: Coordinates) {
    await MapEditor.openAreaEditor(page);
    await AreaEditor.drawArea(
      page,
      topLeft || this.areaSize.topLeft,
      bottomRight || this.areaSize.bottomRight
    );
  }

  async openEntityEditorAndAddEntityWithOpenLinkPropertyOutsideArea(page: Page) {
    await MapEditor.openEntityEditor(page);
    await EntityEditor.selectEntity(page, 0, "small table");
    await EntityEditor.moveAndClick(
      page,
      this.entityPositionOutsideArea.x,
      this.entityPositionOutsideArea.y
    );
    await EntityEditor.clearEntitySelection(page);
    await EntityEditor.moveAndClick(
      page,
      this.mouseCoordinatesToClickOnEntityOutsideArea.x,
      this.mouseCoordinatesToClickOnEntityOutsideArea.y
    );
    await EntityEditor.addProperty(page, "openWebsite");
    await page
      .getByPlaceholder("https://workadventu.re")
      .first()
      .fill("https://workadventu.re");
    await Menu.closeMapEditor(page);
    await EntityEditor.moveAndClick(
      page,
      this.mouseCoordinatesToClickOnEntityOutsideArea.x,
      this.mouseCoordinatesToClickOnEntityOutsideArea.y
    );
    // Check that the cowebsite is opened
    await expect(page.locator('#cowebsites-container')).toBeVisible();
    // Check that the url of website is visible
    await expect(page.locator('#cowebsites-container')).toContainText('https://workadventu.re');
    // Check that the iframe is visible with src https://workadventu.re/
    expect(page.locator('iframe[src="https://workadventu.re/"]').contentFrame()).toBeTruthy();
  }

  async openEntityEditorAndAddEntityWithOpenLinkPropertyInsideArea(page: Page) {
    await MapEditor.openEntityEditor(page);
    await EntityEditor.selectEntity(page, 0, "small table");
    await EntityEditor.moveAndClick(
      page,
      this.entityPositionInArea.x,
      this.entityPositionInArea.y
    );
    await EntityEditor.clearEntitySelection(page);
    await EntityEditor.moveAndClick(
      page,
      this.mouseCoordinatesToClickOnEntityInsideArea.x,
      this.mouseCoordinatesToClickOnEntityInsideArea.y
    );
    await EntityEditor.addProperty(page, "openWebsite");
    await page
      .getByPlaceholder("https://workadventu.re")
      .first()
      .fill("https://workadventu.re");
    await Menu.closeMapEditor(page);
    await EntityEditor.moveAndClick(
      page,
      this.mouseCoordinatesToClickOnEntityInsideArea.x,
      this.mouseCoordinatesToClickOnEntityInsideArea.y
    );
    // Check that the cowebsite is opened
    await expect(page.locator('#cowebsites-container')).toBeVisible();
    // Check that the url of website is visible
    await expect(page.locator('#cowebsites-container')).toContainText('https://workadventu.re');
    // Check that the iframe is visible with src https://workadventu.re/
    expect(page.locator('iframe[src="https://workadventu.re/"]').contentFrame()).toBeTruthy();
  }
}

export default new AreaAccessRights();
