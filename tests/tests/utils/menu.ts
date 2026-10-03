import type { Page} from "@playwright/test";
import {expect} from "@playwright/test";
import {isMobile} from "./isMobile";

class Menu {

    async openChat(page: Page) {
        await page.click('button.chat-btn');
        await expect(page.locator('#chat.chatWindow')).toBeVisible();
    }

    async openMapEditor(page: Page) {
        await page.getByTestId('map-menu').click({timeout: 30_000});
        await page.getByRole('button', { name: 'Map editor' }).click();
        await expect(page.getByRole('button', { name: 'Map editor' })).toBeHidden();
    }

    async openMapExplorer(page: Page) {
        await page.keyboard.press('e');
        await expect(page.locator('section.side-bar-container')).toBeVisible();
    }

    async openMenu(page: Page) {
        await page.getByTestId('action-user').click({timeout: 30_000});
        await expect(page.getByTestId('profile-menu')).toBeVisible();
    }

    async openMenuIfMobile(page: Page) {
        if (isMobile(page)) {
            await this.openMenu(page);
        }
    }

    /*async openMenu(page: Page) {
        // 'button#burgerIcon' do not exist in the new graphic version !!
        await expect(page.locator('button#burgerIcon')).toBeVisible();
        const mobileMenuVisible = await page.locator('button#burgerIcon img.rotate-0').isVisible();
        if(mobileMenuVisible){
            await page.click('button#burgerIcon');
        }
        await page.getByTestId('action-user').click({timeout: 30_000});
        await expect(await page.getByTestId('profile-menu')).toHaveClass(/backdrop-blur/);
    }*/

    async openMapMenu(page: Page) {
        // await page.pause();
        await page.getByTestId('map-menu').click();
        await expect(page.getByTestId('map-sub-menu')).toBeVisible();
    }

    async closeMenu(page: Page) {
        await page.getByTestId('action-user').click({timeout: 30_000});
        await expect(page.getByTestId('profile-menu')).toBeHidden();
    }

    async closeMapMenu(page: Page) {
        await page.getByTestId('map-menu').click({timeout: 30_000});
        await expect(page.getByTestId('map-sub-menu')).toBeHidden();
    }

    async waitForMapLoad(page: Page, timeout = 30_000) {
        await expect(page.getByTestId('microphone-button')).toBeVisible({ timeout });
    }

    async closeMapEditor(page: Page) {
        //await page.locator('.map-editor .configure-my-room .close-window').click();
        await page.getByTestId('closeMapEditorButton').click();
        await expect(page.locator('#map-editor-container .configure-my-room .close-window')).toBeHidden();
    }

    /** Opens the Broadcast card from the Tools menu. */
    async toggleMegaphoneButton(page: Page) {
        await this.openMapMenu(page);
        await page.getByTestId('broadcast-menu').click();
        await expect(page.getByTestId('broadcast-panel')).toBeVisible();
    }

    /** The Broadcast card offers "Go live" to this player. */
    async isThereMegaphoneButton(page: Page) {
        await this.toggleMegaphoneButton(page);
        await expect(page.getByTestId('broadcast-kind-live')).toBeEnabled();
        await page.getByTestId('broadcast-close').click();
        await expect(page.getByTestId('broadcast-panel')).toBeHidden();
    }

    /** The Broadcast card shows "Go live" greyed out: this player may not go live here. */
    async isNotThereMegaphoneButton(page: Page) {
        await this.toggleMegaphoneButton(page);
        await expect(page.getByTestId('broadcast-kind-live')).toBeDisabled();
        await page.getByTestId('broadcast-close').click();
        await expect(page.getByTestId('broadcast-panel')).toBeHidden();
    }

    /**
     * Goes live from the Broadcast card (it must be open): picks "Go live", the world's reach when the card asks,
     * and presses Go live. The card closes and the Live pill shows.
     */
    async startLiveBroadcast(page: Page) {
        await page.getByTestId('broadcast-kind-live').click();
        const worldReach = page.getByTestId('broadcast-reach-WORLD');
        if (await worldReach.isVisible()) {
            await worldReach.click();
            await page.getByTestId('broadcast-next').click();
        }
        await expect(page.getByTestId('broadcast-go-live')).toBeEnabled({ timeout: 10_000 });
        await page.getByTestId('broadcast-go-live').click();
        await expect(page.getByTestId('broadcast-live-pill')).toBeVisible();
    }

    /** Ends the live broadcast from the Live pill. */
    async stopLiveBroadcast(page: Page) {
        await page.getByTestId('broadcast-end-live').click();
        await expect(page.getByTestId('broadcast-live-pill')).toBeHidden();
    }

    async clickOnStatus(page:Page, status: string){
        await expect(page.getByText(status)).toBeVisible();
        await page.getByText(status).click();
        //eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(500);
    }

    async turnOnCamera(page:Page){
        // If the camera is already on, do nothing
        const cameraButton = page.getByTestId('camera-button');
        await expect(cameraButton).toBeVisible();
        if (await cameraButton.getAttribute("data-state") !== "forbidden") return;

        await page.getByTestId('camera-button').click();
        await this.expectButtonState(page, "camera-button", "normal");
    }
    async turnOffCamera(page:Page){
        // If the camera is already off, do nothing
        const cameraButton = page.getByTestId('camera-button');
        await expect(cameraButton).toBeVisible();
        if (await cameraButton.getAttribute("data-state") === "forbidden") return;

        await page.getByTestId('camera-button').click();
        await this.expectButtonState(page, "camera-button", "forbidden");
    }
    async turnOnMicrophone(page:Page){
        // If the microphone is already on, do nothing
        const microphoneButton = page.getByTestId('microphone-button');
        await expect(microphoneButton).toBeVisible();
        if (await microphoneButton.getAttribute("data-state") !== "forbidden") return;

        await page.getByTestId('microphone-button').click();
        await this.expectButtonState(page, "microphone-button", "normal");
    }
    async turnOffMicrophone(page:Page){
        // If the microphone is already off, do nothing
        const microphoneButton = page.getByTestId('microphone-button');
        await expect(microphoneButton).toBeVisible();
        if (await microphoneButton.getAttribute("data-state") === "forbidden") return;

        await page.getByTestId('microphone-button').click();
        await this.expectButtonState(page, "microphone-button", "forbidden");
    }

    async expectCameraOn(page: Page) {
        await this.expectButtonState(page, 'camera-button', 'normal');
    }

    async expectCameraOff(page: Page) {
        await this.expectButtonState(page, 'camera-button', 'forbidden');
    }

    async expectCameraDisabled(page: Page) {
        await this.expectButtonState(page, 'camera-button', 'disabled');
    }

    async expectMicrophoneOn(page: Page) {
        await this.expectButtonState(page, 'microphone-button', 'normal');
    }

    async expectMicrophoneOff(page: Page) {
        await this.expectButtonState(page, 'microphone-button', 'forbidden');
    }

    async expectMicrophoneDisabled(page: Page) {
        await this.expectButtonState(page, 'microphone-button', 'disabled');
    }

    // The action bar buttons carry their state in data-state (the look is a colour on a layer inside them).
    async expectButtonState(page: Page, buttonTestId: string, state: "normal" | "active" | "forbidden" | "disabled") {
        const button = page.getByTestId(buttonTestId);
        switch (state) {
            case "normal":
            case "active":
            case "forbidden":
            case "disabled":
                await expect(button).toHaveAttribute("data-state", state);
                break;
            default: {
                const _exhaustiveCheck: never = state;
            }
        }
    }

    async expectStatus(page: Page, status: string) {
        await expect(page.getByText(status).first()).toBeVisible();
    }

    // The "Turn on notifications?" card shows the first time you go Busy without having answered the browser.
    // Where the test browser already granted notifications it never shows, so this only acts when it is there.
    async dismissNotificationAsk(page: Page) {
        const notNow = page.getByRole('button', { name: 'Not now' });
        try {
            // Give the card a moment to appear: it opens right after the status changes.
            await notNow.waitFor({ state: 'visible', timeout: 3000 });
        } catch {
            return;
        }
        await notNow.click();
    }
    async closeNotificationPopUp(page:Page){
        if(await page.getByRole('button',{name:'Continue without notification'}).isHidden())return;
        await page.getByRole('button',{name:'Continue without notification'}).click();
        await expect(page.getByRole('button',{name:'Continue without notification'})).toBeVisible();

    }
    async closeCameraPopUp(page:Page){
        if(await page.getByRole('button',{name:'Continue without webcam'}).isHidden())return;
        await page.getByRole('button',{name:'Continue without webcam'}).click();
        await expect(page.getByRole('button',{name:'Continue without webcam'})).toBeVisible();

    }

    async closeMapEditorConfigureMyRoomPopUp(page:Page){
        await page.locator('.configure-my-room button.close-window').first().click();
    }
}

export default new Menu();
