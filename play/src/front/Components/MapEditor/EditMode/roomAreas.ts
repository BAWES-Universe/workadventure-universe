import type { AreaData } from "@workadventure/map-editor";
import { readable } from "svelte/store";
import { gameManager } from "../../../Phaser/Game/GameManager";
import type { AreaEditorTool } from "../../../Phaser/Game/MapEditor/Tools/AreaEditorTool";

/**
 * The areas of the room, each as the area tool holds it while the tool is open: the area's settings page reads that
 * copy, so a row always says what the page shows.
 */
function loadAreas(): AreaData[] {
    const scene = gameManager.tryGetCurrentGameScene();
    const all = scene?.getGameMapFrontWrapper().getAreas();
    if (!all) return [];
    const tool = scene?.getMapEditorModeManager()?.currentlyActiveTool as Partial<AreaEditorTool> | undefined;
    return [...all.values()].map((area) => tool?.getAreaPreviewConfig?.(area.id) ?? area);
}

/** What a row of the list shows of an area; the list only redraws when one of these changed. */
function keyOf(areas: AreaData[]): string {
    return areas
        .map((a) => {
            const settings = a.properties.map((p) =>
                p.type === "areaDescriptionProperties"
                    ? `listed=${p.searchable === true},about=${p.description ?? ""}`
                    : p.type
            );
            return `${a.id}:${a.name}:${settings.join(",")}`;
        })
        .join("|");
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
