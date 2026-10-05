<script lang="ts">
    // The Areas panel: "New area" and the areas of the room as rows; tapping one opens its settings.
    import { onDestroy, onMount } from "svelte";
    import type { AreaData } from "@workadventure/map-editor";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { AreaEditorTool } from "../../../Phaser/Game/MapEditor/Tools/AreaEditorTool";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { mapEditorSelectedAreaPreviewStore, mapEditorVisibilityStore } from "../../../Stores/MapEditorStore";
    import { editAreaDraftStore } from "../../../Stores/EditModeStore";
    import PanelHeader from "./PanelHeader.svelte";
    import AreaSettings from "./AreaSettings.svelte";
    import { IconChevronRight, IconPlus, IconTexture } from "@wa-icons";

    const TILE = 32;
    let areas: AreaData[] = [];
    let refresh: ReturnType<typeof setInterval> | undefined;

    function loadAreas() {
        const scene = gameManager.tryGetCurrentGameScene();
        const all = scene?.getGameMapFrontWrapper().getAreas();
        const next = all ? [...all.values()] : [];
        // Only redraw when something changed: the list refreshes on a timer.
        const key = next.map((a) => `${a.id}:${a.name}:${a.width}x${a.height}`).join("|");
        if (key !== areasKey) {
            areasKey = key;
            areas = next;
        }
    }
    let areasKey = "";

    onMount(() => {
        loadAreas();
        refresh = setInterval(loadAreas, 1000);
    });
    onDestroy(() => {
        if (refresh) clearInterval(refresh);
    });

    function tool(): AreaEditorTool | undefined {
        return gameManager.getCurrentGameScene().getMapEditorModeManager().currentlyActiveTool as
            | AreaEditorTool
            | undefined;
    }

    function startDraft() {
        const cam = gameManager.tryGetCurrentGameScene()?.cameras.main;
        if (!cam) return;
        const width = 6 * TILE;
        const height = 5 * TILE;
        const centerX = cam.worldView.x + cam.worldView.width / 2;
        const centerY = cam.worldView.y + cam.worldView.height / 2;
        editAreaDraftStore.set({
            x: Math.round((centerX - width / 2) / TILE) * TILE,
            y: Math.round((centerY - height / 2) / TILE) * TILE,
            width,
            height,
        });
        if ($mobileLayoutStore) mapEditorVisibilityStore.set(false);
    }

    function open(area: AreaData) {
        tool()?.selectArea?.(area.id);
    }

    function nameOf(area: AreaData): string {
        return area.name.trim() || $LL.mapEditor.edit.areas.unnamed();
    }
    function sizeOf(area: AreaData): string {
        return $LL.mapEditor.edit.areas.tiles({
            width: Math.max(1, Math.round(area.width / TILE)),
            height: Math.max(1, Math.round(area.height / TILE)),
        });
    }
</script>

{#if $mapEditorSelectedAreaPreviewStore}
    <AreaSettings />
{:else}
    <PanelHeader
        title={$LL.mapEditor.edit.areas.title()}
        subtitle={$mobileLayoutStore
            ? $LL.mapEditor.edit.areas.subtitlePhone()
            : $LL.mapEditor.edit.areas.subtitleDesktop()}
    />
    <button type="button" class="em-new u-cta" data-testid="area-new" on:click={startDraft}>
        <IconPlus font-size="18" />{$LL.mapEditor.edit.areas.newArea()}
    </button>
    <div class="em-ebi">{$LL.mapEditor.edit.areas.inThisRoom()}</div>
    <div class="em-scroll">
        {#if areas.length === 0}
            <p class="em-empty">{$LL.mapEditor.edit.areas.noAreas()}</p>
        {/if}
        {#each areas as area (area.id)}
            <button type="button" class="em-row" data-testid="area-row" on:click={() => open(area)}>
                <span class="em-tile"><IconTexture font-size="18" /></span>
                <span class="em-tx">
                    <span class="em-t">{nameOf(area)}</span>
                    <span class="em-m">{sizeOf(area)}</span>
                </span>
                <IconChevronRight font-size="16" class="em-chev" />
            </button>
        {/each}
    </div>
{/if}

<style>
    .em-new {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex: none;
        height: 44px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
    }
    .em-ebi {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 8px 0 0;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #a78bfa;
    }
    .em-ebi::before {
        content: "";
        width: 12px;
        height: 1px;
        background: currentColor;
    }
    .em-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .em-row {
        display: flex;
        align-items: center;
        gap: 11px;
        width: 100%;
        margin: 0;
        padding: 9px 6px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    @media (hover: hover) {
        .em-row:hover {
            background: rgba(255, 255, 255, 0.06);
        }
    }
    .em-tile {
        display: grid;
        place-items: center;
        flex: none;
        width: 24px;
        color: #fff;
    }
    .em-tx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .em-t {
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .em-m {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-row :global(.em-chev) {
        flex: none;
        color: rgba(244, 242, 250, 0.5);
    }
    .em-empty {
        margin: 8px 0;
        font-size: 13px;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
