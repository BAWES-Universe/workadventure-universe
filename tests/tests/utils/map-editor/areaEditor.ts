import path from "path";
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import Menu from "../menu";
import Map from "../map";

class AreaEditor {
  async selectMegaphoneItemInCMR(page: Page) {
    await page.locator('li:has-text("Megaphone")').click();
  }

  /** Draws an area between two points of the empty test map, measured from the map's top left corner (see Map.onScreen). */
  async drawArea(
    page: Page,
    topLeft: { x: number; y: number },
    bottomRight: { x: number; y: number }
  ) {
    await page.mouse.move(1, 1);
    let cameraTurnedOff = false;
    // If the area is towards the top of the screen, we turn off camera,
    if (bottomRight.y < 5 * 32 * 1.5 || topLeft.y < 5 * 32 * 1.5) {
      await Menu.turnOffCamera(page);
      cameraTurnedOff = true;
      await expect(page.getByText("You")).toBeHidden({
        timeout: 20_000,
      });
    }
    // The small test map sits in the middle of the screen, partly under the panel on the right: the panel is closed
    // while drawing and opened again on the new area, both by tapping the lit Areas tool.
    const areasTool = page.locator("section.side-bar-container .side-bar .tool-button button#AreaEditor").first();
    const panelOpen = await page.getByTestId("edit-panel").isVisible();
    if (panelOpen) {
      await areasTool.click();
      await expect(page.getByTestId("edit-panel")).toBeHidden();
    }
    const start = Map.onScreen(page, topLeft.x, topLeft.y);
    const end = Map.onScreen(page, bottomRight.x, bottomRight.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();
    if (panelOpen) {
      await areasTool.click();
      await expect(page.getByTestId("edit-panel")).toBeVisible();
    }

    if (cameraTurnedOff) {
      await Menu.turnOnCamera(page);
    }
  }

  // The area panel shows the area's rows, or one setting's page over them: this goes back to the rows.
  private async showAreaRows(page: Page) {
    await expect(
      page.getByTestId("area-rename").or(page.getByTestId("area-property-page"))
    ).toBeVisible();
    const propertyPage = page.getByTestId("area-property-page");
    if (await propertyPage.isVisible()) {
      await page.getByTestId("edit-panel-back").click();
      await expect(propertyPage).toBeHidden();
    }
  }

  // Adding a setting opens its page; the next add goes back to the rows first.
  async addProperty(page: Page, property: string) {
    await this.showAreaRows(page);
    // Web apps (Google Docs, Klaxoon…) are chips behind the "Add an app" row.
    if (property.startsWith("openWebsite") && property !== "openWebsite") {
      if (!(await page.getByTestId(property).isVisible())) {
        await page.getByTestId("area-add-app").click();
      }
    }
    await page.getByTestId(property).click();
  }

  async setPodiumNameProperty(page: Page, name: string, enableChat = false) {
    await page.getByPlaceholder("MainStage").click();
    await page.getByPlaceholder("MainStage").fill(name);
    await page.getByPlaceholder("MainStage").press("Enter");
    if (enableChat) {
      await page.getByTestId("chatEnabled").click();
    }
  }

  async setMatchingPodiumZoneProperty(
    page: Page,
    name: string,
    enableChat = false
  ) {
    await page
      .locator(
        ".map-editor .sidebar .properties-container select#speakerZoneSelector"
      )
      .selectOption({ label: name.toLowerCase() });
    if (enableChat) {
      await page.getByTestId("chatEnabled").click();
    }
  }

  // The name is the panel's title: tapping it turns it into a field.
  async setAreaName(page: Page, name: string) {
    await this.showAreaRows(page);
    await page.getByTestId("area-rename").click();
    const input = page.locator("#map-editor-right input#objectName");
    await input.fill(name);
    await input.press("Enter");
    await expect(page.getByTestId("area-rename")).toContainText(name);
  }

  async setAreaDescription(page: Page, Description: string) {
    await this.showAreaRows(page);
    const input = page.locator("#map-editor-right textarea#objectDescription");
    await input.fill(Description);
    await input.blur();
  }

  async setAreaSearcheable(page: Page, value: boolean) {
    await this.showAreaRows(page);
    await page.locator("#map-editor-right input#searchable").setChecked(value);
  }

  async setExitProperty(page: Page, mapName: string, startAreaName: string) {
    await page
      .locator(
        ".map-editor .sidebar .properties-container select#exitMapSelector"
      )
      .selectOption({ label: mapName });
    await page
      .locator(
        ".map-editor .sidebar .properties-container select#startAreaNameSelector"
      )
      .selectOption({ label: startAreaName });
  }

  async setAreaRightProperty(
    page: Page,
    writeRights: string[],
    readRights: string[]
  ) {
    await page.getByTestId("restrictedRightsPropertyData").click();
    const writeRightsInput = page.getByTestId("writeTags");
    for (const writeRight of writeRights) {
      await this.fullFillAreaRight(writeRightsInput, writeRight);
    }
    const readRightsInput = page.getByTestId("readTags");
    for (const readRight of readRights) {
      await this.fullFillAreaRight(readRightsInput, readRight);
    }
  }

  async setAreaLiveKitProperty(
    page: Page,
    startWithAudioMuted = false,
    startWithVideoMuted = false
  ) {
    await page.getByTestId("livekitRoomProperty").click();
    if (!startWithAudioMuted && !startWithVideoMuted) {
      return;
    }

    await page.getByTestId("livekitRoomMoreOptionsButton").click();

    if (startWithVideoMuted) {
      await page.getByTestId("startWithVideoMuted").check();
    }

    if (startWithAudioMuted) {
      await page.getByTestId("startWithAudioMuted").check();
    }

    await page.getByTestId("livekitRoomConfigValidateButton").click(); //close the more options
  }

  async setOpenLinkProperty(
    page: Page,
    link: string,
    option = "Show immediately on enter"
  ) {
    await page
      .locator(".map-editor .sidebar .properties-container select#trigger")
      .selectOption({ label: option });
    await page
      .locator(".map-editor .sidebar .properties-container input#tabLink")
      .fill(link, { timeout: 20_000 });
  }

  async setOpenFileProperty(page: Page, option = "Show immediately on enter") {
    await page
      .locator(".map-editor .sidebar .properties-container select#trigger")
      .selectOption({ label: option });
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page
      .locator(".map-editor .sidebar .properties-container span#chooseUpload")
      .click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(
      path.join(__dirname, `../../assets/lorem-ipsum.pdf`)
    );
  }

  async deleteFile(page: Page) {
    await page.getByTestId("closeFileUpload").click();
  }

  async setMatrixChatRoomProperty(
    page: Page,
    shouldOpenAutomatically: boolean,
    roomName?: string
  ) {
    //TODO : find a better way to wait for the room to be created
    //eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(4000);
    await page.getByTestId("shouldOpenAutomaticallyCheckbox").click();

    if (roomName) {
      await page.getByPlaceholder("My room").isEnabled({ timeout: 20_000 });
      await page
        .getByPlaceholder("My room")
        .fill(roomName, { timeout: 20_000 });
    }
    //TODO : find a better way to wait for the room to be created
    //eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(4000);
  }

  private async fullFillAreaRight(locator: Locator, right: string) {
    await locator.click();
    await locator.fill(right);
    await locator.press("Enter");
  }
}

export default new AreaEditor();
