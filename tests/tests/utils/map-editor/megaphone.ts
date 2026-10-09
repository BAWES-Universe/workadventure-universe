import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import Menu from "../menu";

/** The Broadcast card's settings: who can go live in the room and how far they reach (admins only). */
class Megaphone {
  async openBroadcastSettings(page: Page) {
    await Menu.toggleMegaphoneButton(page);
    await page.getByTestId("broadcast-settings").click();
    await expect(page.getByTestId("broadcast-settings-save")).toBeVisible();
  }

  /** Picks who can go live and how far, saves (the card goes back to its first step), and closes the card. */
  async saveBroadcastSettings(
    page: Page,
    who: "admins" | "editors" | "members" | "everyone",
    reach: "ROOM" | "WORLD" | "UNIVERSE"
  ) {
    await page.getByTestId(`broadcast-settings-who-${who}`).click();
    await page.getByTestId(`broadcast-settings-reach-${reach}`).click();
    await page.getByTestId("broadcast-settings-save").click();
    await expect(page.getByTestId("broadcast-kind-live")).toBeVisible();
    await page.getByTestId("broadcast-close").click();
    await expect(page.getByTestId("broadcast-panel")).toBeHidden();
  }
}

export default new Megaphone();
