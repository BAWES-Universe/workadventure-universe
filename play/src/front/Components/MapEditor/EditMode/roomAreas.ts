import type { AreaData } from "@workadventure/map-editor";
import { readable } from "svelte/store";
import { gameManager } from "../../../Phaser/Game/GameManager";

function loadAreas(): AreaData[] {
    const all = gameManager.tryGetCurrentGameScene()?.getGameMapFrontWrapper().getAreas();
    return all ? [...all.values()] : [];
}

/** What a row of the list shows of an area; the list only redraws when one of these changed. */
function keyOf(areas: AreaData[]): string {
    return areas.map((a) => `${a.id}:${a.name}:${a.properties.map((p) => p.type).join(",")}`).join("|");
}

/** The areas of the room for the Areas lists, reread every second while a list is shown. */
export const roomAreasStore = readable<AreaData[]>([], (set) => {
    let key = "";
    const refresh = () => {
        const next = loadAreas();
        const nextKey = keyOf(next);
        if (nextKey !== key) {
            key = nextKey;
            set(next);
        }
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
});
