<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
    import {
        mapEditorAreaModeStore,
        mapEditorSelectedAreaPreviewStore,
        mapEditorSelectedEntityPrefabStore,
        mapEditorSelectedToolStore,
    } from "../../Stores/MapEditorStore";
    import {
        botEditorModeStore,
        cancelPlacement,
        placingBotStore,
        stopWaypointEditing,
    } from "../../external-modules/bots/stores/BotEditorStore";
    import type { MapEditorPlacingState } from "./MapEditorPlacing";
    import { getMapEditorPlacingState } from "./MapEditorPlacing";
    import type { MapEditorSheetSnap } from "./MapEditorSheet";
    import { mapEditorIsMobileLayoutStore, mapEditorSheetSnapStore } from "./MapEditorTools";

    $: placing = getMapEditorPlacingState({
        selectedTool: $mapEditorSelectedToolStore,
        entityPrefabName: $mapEditorSelectedEntityPrefabStore?.name,
        areaMode: $mapEditorAreaModeStore,
        areaSelected: $mapEditorSelectedAreaPreviewStore !== undefined,
        botEditorMode: $botEditorModeStore,
        placingBotName: $placingBotStore?.name,
    });

    // Snap the sheet down to peek while placing on mobile, and put it back afterwards
    // unless the user moved it in the meantime. Switching from one placing state to another
    // (say entity to trash from the toolbar) drops back to peek and keeps the original snap.
    let snapBeforePlacing: MapEditorSheetSnap | undefined;

    $: onPlacingChange(placing?.kind);

    function onPlacingChange(kind: MapEditorPlacingState["kind"] | undefined) {
        if (kind !== undefined) {
            if (!$mapEditorIsMobileLayoutStore) return;
            if (snapBeforePlacing === undefined) {
                snapBeforePlacing = $mapEditorSheetSnapStore;
            }
            mapEditorSheetSnapStore.set("peek");
        } else if (snapBeforePlacing !== undefined) {
            if ($mapEditorSheetSnapStore === "peek") {
                mapEditorSheetSnapStore.set(snapBeforePlacing);
            }
            snapBeforePlacing = undefined;
        }
    }

    function hint(state: MapEditorPlacingState): string {
        switch (state.kind) {
            case "entity":
                return $LL.mapEditor.placing.entity({ name: state.name ?? "" });
            case "bot":
                return state.name
                    ? $LL.mapEditor.placing.bot({ name: state.name })
                    : $LL.mapEditor.placing.botUnnamed();
            case "waypoint":
                return $LL.mapEditor.placing.waypoint();
            case "area":
                return $LL.mapEditor.placing.area();
            case "trash":
                return $LL.mapEditor.placing.trash();
        }
    }

    // Each placement is saved as soon as the map is tapped, so most states only need a way out.
    // Placing a bot has not saved anything yet, so it offers Cancel instead.
    function finish(state: MapEditorPlacingState) {
        switch (state.kind) {
            case "entity":
                mapEditorSelectedEntityPrefabStore.set(undefined);
                break;
            case "waypoint":
                stopWaypointEditing();
                break;
            case "trash":
                gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(EditorToolName.EntityEditor);
                break;
        }
    }
</script>

{#if placing}
    <div
        class="fixed top-4 inset-x-0 mx-auto w-fit max-w-[calc(100%-2rem)] z-[1999] pointer-events-auto flex items-center gap-3 rounded-2xl bg-contrast/90 backdrop-blur-md px-4 py-2 text-white"
        role="status"
        data-testid="mapEditorPlacingBar"
    >
        <span class="text-sm md:text-base">{hint(placing)}</span>
        {#if placing.kind === "bot"}
            <button
                type="button"
                class="btn btn-light btn-ghost min-h-[44px] m-0 shrink-0"
                data-testid="mapEditorPlacingCancel"
                on:click={cancelPlacement}
            >
                {$LL.mapEditor.placing.cancel()}
            </button>
        {:else if placing.kind !== "area"}
            <button
                type="button"
                class="btn btn-secondary min-h-[44px] m-0 shrink-0"
                data-testid="mapEditorPlacingDone"
                on:click={() => placing && finish(placing)}
            >
                {$LL.mapEditor.placing.done()}
            </button>
        {/if}
    </div>
{/if}
