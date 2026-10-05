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
        editDeleteMarkStore,
        editHintSeenStore,
        editPlacingBarStore,
        editTouchPreviewStore,
        editUndoToastStore,
        hideUndoToast,
    } from "../../../Stores/EditModeStore";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import ConfigureMyRoom from "../WAMSettingsEditor.svelte";
    import EditPill from "./EditPill.svelte";
    import EditRail from "./EditRail.svelte";
    import EditPanel from "./EditPanel.svelte";
    import PlacingBar from "./PlacingBar.svelte";
    import ObjectActions from "./ObjectActions.svelte";
    import AreaDraft from "./AreaDraft.svelte";
    import { IconArrowBackUp, IconHandMove, IconTrash } from "@wa-icons";

    let rootWidth = 0;

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
    // Delete: a tap on a phone only marks the item (box and Remove chip); on a computer the mouse's outline is the mark.
    $: deleteMark = tool === EditorToolName.TrashEditor ? $editDeleteMarkStore : undefined;
    $: deleteMarkTapped = deleteMark?.tapped ? deleteMark : undefined;
    // The chip sits to the right of the box, or to its left when the box is near the right edge.
    $: chipOnLeft = deleteMarkTapped !== undefined && deleteMarkTapped.x + deleteMarkTapped.width + 130 > rootWidth;

    function undoLast() {
        hideUndoToast();
        gameManager.getCurrentGameScene().getMapEditorModeManager().undo();
    }
</script>

{#if tool === EditorToolName.WAMSettingsEditor}
    <!-- The main layout takes no pointer events itself; the window must. -->
    <div class="contents pointer-events-auto">
        <ConfigureMyRoom />
    </div>
{/if}
<div
    id="map-editor-container"
    class="em-root absolute inset-0 z-[100] pointer-events-none text-white"
    class:em-phone={$mobileLayoutStore}
    data-testid="edit-mode"
    bind:clientWidth={rootWidth}
>
    <EditPill />
    <EditRail />
    {#if panelShown}
        <EditPanel />
    {/if}
    {#if objectSelected && !placingObject && !($mobileLayoutStore && panelShown)}
        <!-- On a phone the panel covers the map, so the actions pinned to the object wait until it is tucked away. -->
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

    {#if deleteMarkTapped}
        {@const m = deleteMarkTapped}
        <div
            class="em-mark"
            style="left: {m.x}px; top: {m.y}px; width: {m.width}px; height: {m.height}px;"
            transition:fade={{ duration: 120 }}
            data-testid="delete-mark"
        />
        <button
            type="button"
            class="em-chip pointer-events-auto"
            class:em-chip-left={chipOnLeft}
            style="left: {chipOnLeft ? m.x - 8 : m.x + m.width + 8}px; top: {m.y}px;"
            transition:fade={{ duration: 120 }}
            data-testid="delete-mark-remove"
            on:click={m.remove}
        >
            <IconTrash font-size="16" />
            {$LL.mapEditor.edit.deleteTool.remove()}
        </button>
    {/if}

    {#if $editUndoToastStore}
        <!-- "Plant removed · Undo", for a few seconds, where the delete hints sit. -->
        <div
            class="em-toast u-surface pointer-events-auto"
            transition:fly={{ y: 16, duration: 160 }}
            data-testid="edit-undo-toast"
        >
            <span class="em-toast-text">{$editUndoToastStore.text}</span>
            <button type="button" class="em-toast-undo u-cta" data-testid="edit-undo-toast-undo" on:click={undoLast}>
                <IconArrowBackUp font-size="16" />
                {$LL.mapEditor.edit.undo()}
            </button>
        </div>
    {:else if deleteMarkTapped}
        <div class="em-hint em-hint-floor u-surface" transition:fade={{ duration: 150 }} data-testid="delete-mark-hint">
            {$LL.mapEditor.edit.deleteTool.tapAgain()}
        </div>
    {:else if deleteMark && !$mobileLayoutStore}
        <div
            class="em-hint em-hint-floor u-surface"
            transition:fade={{ duration: 150 }}
            data-testid="delete-hover-hint"
        >
            {$LL.mapEditor.edit.deleteTool.clickToRemove()}
        </div>
    {/if}

    {#if phoneHint}
        <div class="em-hint em-hint-bottom u-surface" transition:fly={{ y: 20, duration: 200 }}>
            <IconHandMove font-size="18" class="em-hint-icon" />
            <span>{$LL.mapEditor.edit.hint.phone()}</span>
        </div>
    {:else if $editPlacingBarStore?.hint}
        <div class="em-hint em-hint-top u-surface" transition:fade={{ duration: 150 }} data-testid="placing-bar-hint">
            <IconHandMove font-size="18" class="em-hint-icon" />
            <span>{$editPlacingBarStore.hint}</span>
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
        top: 64px;
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
    /* Delete: the "Tap again" / "Click to remove" hint and the Undo toast share the middle of the bottom edge. */
    .em-hint-floor,
    .em-toast {
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        white-space: nowrap;
        z-index: 5;
    }
    .em-hint-floor {
        padding: 8px 16px;
        font-size: 13px;
    }
    .em-phone .em-hint-floor,
    .em-phone .em-toast {
        bottom: calc(18px + env(safe-area-inset-bottom, 0px));
    }
    .em-toast {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 8px 8px 18px;
        border-radius: 999px;
        font-size: 14px;
    }
    .em-toast-text {
        font-weight: 600;
    }
    .em-toast-undo {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 16px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
    }
    /* The box around what a tap marked, in the editor's coral, with the Remove chip beside it. */
    .em-mark {
        position: absolute;
        border: 2px dashed #f7a48f;
        border-radius: 8px;
        box-shadow: 0 0 0 6px rgba(247, 164, 143, 0.18);
        z-index: 3;
    }
    .em-chip {
        position: absolute;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 16px;
        border: 0;
        border-radius: 999px;
        background: #e0533c;
        color: #fff;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
        box-shadow: 0 8px 24px -10px rgba(224, 83, 60, 0.9);
        cursor: pointer;
        z-index: 4;
    }
    .em-chip-left {
        transform: translateX(-100%);
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
