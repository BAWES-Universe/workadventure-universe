<script lang="ts">
    // "Editing a room": the pill at the top (Done, Undo, Redo), the rail of tools on the right edge, the panel beside
    // it, and the bar at the bottom while something is being placed or drawn. The map stays in view; on phones the
    // action bar is hidden until Done. The editor engine (MapEditorModeManager and its tools) is unchanged.
    import { fade, fly } from "svelte/transition";
    import { onMount } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { EditorToolName } from "../../../Phaser/Game/MapEditor/MapEditorModeManager";
    import {
        mapEditorAreaModeStore,
        mapEditorEntityModeStore,
        mapEditorSelectedEntityPrefabStore,
        mapEditorSelectedEntityStore,
        mapEditorSelectedToolStore,
        mapEditorVisibilityStore,
    } from "../../../Stores/MapEditorStore";
    import {
        editAreaDraftStore,
        editHintSeenStore,
        editPlacingBarStore,
        editTouchPreviewStore,
    } from "../../../Stores/EditModeStore";
    import ConfigureMyRoom from "../WAMSettingsEditor.svelte";
    import EditPill from "./EditPill.svelte";
    import EditRail from "./EditRail.svelte";
    import EditPanel from "./EditPanel.svelte";
    import PlacingBar from "./PlacingBar.svelte";
    import ObjectActions from "./ObjectActions.svelte";
    import AreaDraft from "./AreaDraft.svelte";
    import { IconHandMove, IconTrash } from "@wa-icons";

    // On a phone, edit mode opens on the whole map: the panel comes out when a tool on the rail is tapped.
    onMount(() => {
        if ($mobileLayoutStore) mapEditorVisibilityStore.set(false);
    });

    $: tool = $mapEditorSelectedToolStore;
    $: placingObject = tool === EditorToolName.EntityEditor && $mapEditorSelectedEntityPrefabStore !== undefined;
    $: drawingArea = tool === EditorToolName.AreaEditor && $editAreaDraftStore !== undefined;
    $: barShown = placingObject || drawingArea || $editPlacingBarStore !== undefined;
    // The panel is not for every tool: Delete only needs the map, and Room settings is a window of its own.
    $: panelShown =
        $mapEditorVisibilityStore &&
        tool !== undefined &&
        tool !== EditorToolName.TrashEditor &&
        tool !== EditorToolName.WAMSettingsEditor &&
        tool !== EditorToolName.CloseMapEditor;
    $: objectSelected =
        tool === EditorToolName.EntityEditor &&
        $mapEditorEntityModeStore === "EDIT" &&
        $mapEditorSelectedEntityStore !== undefined;
    $: phoneHint = $mobileLayoutStore && !$editHintSeenStore && !panelShown && !barShown;
    $: desktopHint = !$mobileLayoutStore && placingObject;
    $: deleteHint = tool === EditorToolName.TrashEditor;
    $: areaDraftHint = drawingArea && $mapEditorAreaModeStore === "ADD";
</script>

{#if tool === EditorToolName.WAMSettingsEditor}
    <ConfigureMyRoom />
{/if}
<div
    id="map-editor-container"
    class="em-root absolute inset-0 z-[500] pointer-events-none text-white"
    class:em-phone={$mobileLayoutStore}
    data-testid="edit-mode"
>
    <EditPill />
    <EditRail />
    {#if panelShown}
        <EditPanel />
    {/if}
    {#if objectSelected && !placingObject}
        <ObjectActions />
    {/if}
    {#if drawingArea}
        <AreaDraft />
    {/if}
    {#if barShown}
        <PlacingBar {placingObject} {drawingArea} />
    {/if}

    {#if $editTouchPreviewStore}
        {@const p = $editTouchPreviewStore}
        <div
            class="em-tap u-surface"
            style="left: {p.x + p.width / 2}px; top: {Math.max(8, p.y - 40)}px;"
            transition:fade={{ duration: 120 }}
        >
            {$LL.mapEditor.edit.objects.tapAgain()}
        </div>
    {/if}

    {#if phoneHint}
        <div class="em-hint em-hint-bottom u-surface" transition:fly={{ y: 20, duration: 200 }}>
            <IconHandMove font-size="18" class="em-hint-icon" />
            <span>{$LL.mapEditor.edit.hint.phone()}</span>
        </div>
    {:else if deleteHint}
        <div class="em-hint em-hint-top u-surface" transition:fade={{ duration: 150 }} data-testid="edit-delete-hint">
            <IconTrash font-size="18" class="em-hint-icon em-hint-coral" />
            <span>{$LL.mapEditor.edit.deleteTool.subtitle()}</span>
        </div>
    {:else if areaDraftHint}
        <div class="em-hint em-hint-top u-surface" transition:fade={{ duration: 150 }}>
            <IconHandMove font-size="18" class="em-hint-icon" />
            <span>{$LL.mapEditor.edit.areas.draftHint()}</span>
        </div>
    {:else if desktopHint}
        <div class="em-hint em-hint-keys u-surface" transition:fade={{ duration: 150 }}>
            {$LL.mapEditor.edit.hint.desktop()}
        </div>
    {/if}
</div>

<style>
    .em-root {
        font-family: inherit;
    }
    .em-tap {
        position: absolute;
        transform: translateX(-50%);
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        z-index: 4;
    }
    .em-hint {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 10px 16px;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 500;
        text-align: center;
        line-height: 1.3;
        z-index: 4;
    }
    .em-hint :global(.em-hint-icon) {
        flex: none;
        color: #a78bfa;
    }
    .em-hint :global(.em-hint-coral) {
        color: #f7a48f;
    }
    .em-hint-bottom {
        left: 14px;
        right: 14px;
        bottom: calc(18px + env(safe-area-inset-bottom, 0px));
    }
    .em-hint-top {
        top: 160px;
        left: 50%;
        transform: translateX(-50%);
        width: max-content;
        max-width: min(480px, calc(100% - 120px));
    }
    .em-phone .em-hint-top {
        top: calc(80px + env(safe-area-inset-top, 0px));
        left: 14px;
        right: 84px;
        width: auto;
        max-width: none;
        transform: none;
    }
    .em-hint-keys {
        left: 50%;
        bottom: 76px;
        transform: translateX(-50%);
        padding: 8px 14px;
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.8);
        white-space: nowrap;
    }
</style>
