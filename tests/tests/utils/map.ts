import type {Page} from "@playwright/test";
import {evaluateScript} from "./scripting";
import { RENDERER_MODE } from "./environment";
import {e2e_wam_directory, play_url} from "./urls";

class Map {
    async walkTo(page: Page, key: string, delay = 0){
        await page.keyboard.press(key, {delay});
    }

    async rightClickToPosition(page: Page, x: number, y: number, delay = 0){
        await page.mouse.click(x, y, {delay, button: 'right'});
    }

    async walkToPosition(page: Page, x: number, y: number){
        await evaluateScript(page, async ({x, y}) => {
            await WA.player.moveTo(x, y, 3);
            return;
        }, {
            x,
            y,
        });
    }

    async teleportToPosition(page: Page, x: number, y: number){
        await evaluateScript(page, async ({x, y}) => {
            await WA.player.teleport(x, y);
            return;
        }, {
            x,
            y,
        });
    }

    async goToRoom(page: Page, room: string){
        await evaluateScript(page, async ({ room }) => {
            WA.nav.goToRoom(room);
        }, {
            room,
        });
    }

    async getPosition(page: Page){
        return await evaluateScript(page, async () => {
            await WA.onInit();
            return await WA.player.getPosition();
        });
    }

    /**
     * A point of the empty test maps (10 x 10 tiles, shown at 1.5x), measured from the map's top left corner, on the
     * screen. The map is smaller than the screen, so it sits in the middle of it, while playing and while editing.
     */
    onScreen(page: Page, x: number, y: number): { x: number; y: number } {
        const mapSize = 10 * 32 * 1.5;
        const viewport = page.viewportSize() ?? { width: mapSize, height: mapSize };
        return {
            x: x + Math.max(0, (viewport.width - mapSize) / 2),
            y: y + Math.max(0, (viewport.height - mapSize) / 2),
        };
    }

    url(end: string){
        return `${play_url}/~/${e2e_wam_directory}/maps/${end}.wam?phaserMode=${RENDERER_MODE}`;
    }
}

export default new Map();
