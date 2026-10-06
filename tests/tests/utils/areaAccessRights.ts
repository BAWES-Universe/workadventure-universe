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

  // Objects are placed in the middle of a tile: on a tile's edge, the tile they land on (and so the click that
  // finds them) depends on rounding.
  public entityPositionInArea: Coordinates = { x: 4.5 * 32 * 1.5, y: 4.5 * 32 * 1.5 };
  // Below the area, left of the editor's panel, which covers the right of the small map.
  public entityPositionOutsideArea: Coordinates = { x: 5.5 * 32 * 1.5, y: 8.5 * 32 * 1.5 };

  // On the table's top, half a tile above where it was placed: lower down is beside its leg, where a click in play
  // finds nothing (objects there are hit on their visible pixels).
  public mouseCoordinatesToClickOnEntityInsideArea = {
    x: this.entityPositionInArea.x,
    y: this.entityPositionInArea.y - 16 * 1.5,
  };

  public mouseCoordinatesToClickOnEntityOutsideArea = {
    x: this.entityPositionOutsideArea.x,
    y: this.entityPositionOutsideArea.y - 16 * 1.5,
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
