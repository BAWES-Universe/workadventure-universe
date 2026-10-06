<script lang="ts">
    // The areas of the room as rows: the area's mark in its own colour, its name, and what it does. Tapping one glides
    // the map to that area and picks it, as a tap on it would.
    import type { AreaData } from "@workadventure/map-editor";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { areaColour } from "../../../Phaser/Components/MapEditor/AreaPreview";
    import type { AreaEditorTool } from "../../../Phaser/Game/MapEditor/Tools/AreaEditorTool";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { editAreaSheetOpenStore } from "../../../Stores/EditModeStore";
    import { IconChevronRight, IconTexture } from "@wa-icons";

    export let areas: AreaData[] = [];

    function tool(): AreaEditorTool | undefined {
        return gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager()?.currentlyActiveTool as
            | AreaEditorTool
            | undefined;
    }

    /** The part of the canvas the area should be seen in: under the pill, left of the rail or the panel. */
    function freeSpace(): { left: number; top: number; right: number; bottom: number } | undefined {
        const canvas = gameManager.tryGetCurrentGameScene()?.game.canvas.getBoundingClientRect();
        const root = document.getElementById("map-editor-container");
        if (!canvas || !root) return undefined;
        const pill = root.querySelector('[data-testid="edit-pill"]')?.getBoundingClientRect();
        const rail = root.querySelector('[data-testid="edit-rail"]')?.getBoundingClientRect();
        const panel = $mobileLayoutStore ? undefined : root.querySelector('[data-testid="edit-panel"]');
        const right = (panel?.getBoundingClientRect().left ?? rail?.left ?? canvas.right) - 12;
        // On a phone the sheet goes away and the hint sits at the bottom instead.
        const bottom = canvas.bottom - ($mobileLayoutStore ? 80 : 12);
        return {
            left: 12,
            top: (pill?.bottom ?? canvas.top) - canvas.top + 12,
            right: right - canvas.left,
            bottom: bottom - canvas.top,
        };
    }

    function go(area: AreaData) {
        // Measured before the sheet goes: picking the area puts it away on a phone.
        const free = freeSpace();
        editAreaSheetOpenStore.set(false);
        tool()?.glideToArea?.(area.id, free);
    }

    function nameOf(area: AreaData): string {
        return area.name.trim() || $LL.mapEditor.edit.areas.unnamed();
    }

    function whatOf(area: AreaData): string {
        const titles = area.properties
            .filter((p) => p.type !== "areaDescriptionProperties")
            .map((p) => {
                const entry = ($LL.mapEditor.edit.properties as Record<string, { title?: () => string } | undefined>)[
                    p.type
                ];
                return entry?.title?.() ?? "";
            })
            .filter((title) => title !== "");
        return titles.length > 0 ? titles.join(" · ") : $LL.mapEditor.edit.areas.noSettings();
    }
</script>

{#each areas as area (area.id)}
    <button type="button" class="ar-row" data-testid="area-row" on:click={() => go(area)}>
        <span class="ar-mark" style="color: #{areaColour(area.properties)}"><IconTexture font-size="22" /></span>
        <span class="ar-tx">
            <span class="ar-t">{nameOf(area)}</span>
            <span class="ar-m">{whatOf(area)}</span>
        </span>
        <IconChevronRight font-size="18" class="ar-chev" />
    </button>
{/each}

<style>
    .ar-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 0 10px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    @media (hover: hover) {
        .ar-row:hover {
            background: rgba(255, 255, 255, 0.06);
        }
    }
    .ar-mark {
        display: grid;
        place-items: center;
        flex: none;
        width: 24px;
    }
    .ar-tx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .ar-t {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .ar-m {
        font-size: 13px;
        color: rgba(244, 242, 250, 0.64);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .ar-row :global(.ar-chev) {
        flex: none;
        margin-left: auto;
        color: rgba(244, 242, 250, 0.5);
    }
</style>
