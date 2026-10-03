import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import MatrixApi from "./matrixApi";

const DEFAULT_PASSPHRASE = "defaultPassphrase";

class ChatUtils {
  public async openChat(page: Page) {
    await page.getByTestId('chat-btn').click();
  }

  public async openCreateRoomDialog(page: Page, folderName = "") {
    await page
      .getByTestId(`openOptionToCreateRoomOrFolder${folderName}`)
      .click();
    await page.getByTestId(`openCreateRoomModalButton${folderName}`).click();
  }
  public async openCreateFolderDialog(page: Page, folderName = "") {
    await page
      .getByTestId(`openOptionToCreateRoomOrFolder${folderName}`)
      .click();
    await page.getByTestId(`openCreateFolderModalButton${folderName}`).click();
  }

  public getRandomName() {
    return `RoomTest_${Math.floor(Math.random() * 10000)}`;
  }

  public async resetMatrixDatabase() {
    await MatrixApi.resetMatrixUsers();
  }

  public async initEndToEndEncryption(
    roomName: string,
    page: Page,
    context: BrowserContext
  ) {
    // Here, sometimes, SSO redirection is required by the Synapse server, sometimes it is not.
    // It is not clear why, especially since it can change from one test run to another.

     
    // await page.waitForTimeout(1000);

    await page.getByText(roomName).click();

    // await page.getByTestId("VerifyWithPassphraseButton").click();

    //eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(1000);
    //eslint-disable-next-line playwright/no-element-handle
    const ssoButton = await page.$("text=Continue with SSO");

    if (ssoButton) {

      const oidcPagePromise = context.waitForEvent("page", {
        // Give ample time for the SSO redirection
        timeout: 2000,
      });

      await page.getByText("Continue with SSO").click({
        timeout: 1000,
      });

      const oidcPage = await oidcPagePromise;
      await oidcPage.getByText("Continue with OIDC Server Mock").click();
      await page.getByText("Finish").click();
      await oidcPage.close();
    }

    await page.getByTestId("passphraseInput").fill(DEFAULT_PASSPHRASE);
    await page.getByText("Generate").click();
    await page.getByTestId("downloadRecoveryKeyButton").click();
    await page.getByText("Continue").click();
  }

  public async cancelledContinueWithSSO(page: Page, context: BrowserContext) {
   // await page.getByTestId("VerifyWithPassphraseButton").click();
    await page.getByTestId("cancelSSO").click();
  }

  public async restoreEncryption(page: Page) {
   // await page.getByTestId("VerifyWithPassphraseButton").click();
    await page.getByTestId("passphraseInput").waitFor({
      state: "visible",
      timeout: 20_000,
    });
    //wait before filling the passphrase input because it fill too fast and the blur event is not triggered or not detected
    //eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(1000);
    await page.getByTestId("passphraseInput").fill(DEFAULT_PASSPHRASE);
    await page.getByTestId("passphraseInput").blur();
    await page.getByTestId("confirmAccessSecretStorageButton").click();
  }

  public async restoreEncryptionFromButton(page: Page) {
    await page.getByTestId("restoreEncryptionButton").click();
    await this.restoreEncryption(page);
  }

  public async closeChat(page: Page) {
    await page.getByTestId("closeChatButton").click();
  }

  public async isChatSidebarOpen(page: Page) {
    return page.getByTestId("closeChatButton").isVisible({
      timeout: 20_000,
    });
  }

  /**
   * Starts an action on a message the way the device offers it: the hover bar (and its "More" menu) with a mouse,
   * the press-and-hold menu on a touch screen, where a right-click opens the same menu.
   */
  public async messageAction(
    page: Page,
    messageText: string,
    action: "reply" | "react" | "edit" | "delete"
  ) {
    const message = page.getByText(messageText);
    const touchScreen = await page.evaluate(() => window.matchMedia("(hover: none)").matches);
    if (touchScreen) {
      await message.click({ button: "right" });
      const menu = page.getByTestId("messageActionMenu");
      await expect(menu).toBeVisible();
      const item = {
        reply: "menuReplyButton",
        react: "moreReactionsButton",
        edit: "menuEditButton",
        delete: "menuDeleteButton",
      }[action];
      await menu.getByTestId(item).click();
      return;
    }
    await message.hover();
    if (action === "reply") {
      await page.getByTestId("replyToMessageButton").click();
    } else if (action === "react") {
      await page.getByTestId("openEmojiPickerButton").click();
    } else {
      await page.getByTestId("messageMoreButton").click();
      await page.getByTestId(action === "edit" ? "editMessageButton" : "removeMessageButton").click();
    }
  }
}

export default new ChatUtils();
