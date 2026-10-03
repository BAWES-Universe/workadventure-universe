<script lang="ts">
    // The panel beside the rail: the contents of the open tool. On phones it spans the width left of the rail; on a
    // computer it floats on the right with a drag edge to resize. The chevron on its edge tucks it away; picking the
    // tool again brings it back. "#map-editor-right > .sidebar" and the header row stay for the bots module, which
    // puts its own page inside the sidebar after that row.
    import { fly } from "svelte/transition";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { windowSize } from "../../../Stores/CoWebsiteStore";
    import { EditorToolName } from "../../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorSelectedToolStore, mapEditorVisibilityStore } from "../../../Stores/MapEditorStore";
    import { editToolsStore } from "../../../Stores/EditModeStore";
    import MapEditorResizeHandle from "../MapEditorResizeHandle.svelte";
    import { mapEditorSideBarWidthStore } from "../MapEditorSideBarWidthStore";
    import ObjectsPanel from "./ObjectsPanel.svelte";
    import AreasPanel from "./AreasPanel.svelte";
    import PanelHeader from "./PanelHeader.svelte";
    import { IconChevronRight } from "@wa-icons";

    $: tool = $mapEditorSelectedToolStore;
    $: external = $editToolsStore.find((t) => t.id === tool);
    $: width = Math.min(Math.max(300, $mapEditorSideBarWidthStore), Math.max(300, $windowSize.width - 140));

    function tuck() {
        mapEditorVisibilityStore.set(false);
    }
    function onResize(newWidth: number) {
        mapEditorSideBarWidthStore.set(newWidth);
    }
</script>

<div
    id="map-editor-right"
    class="map-editor em-panel u-surface pointer-events-auto {tool}"
    style={$mobileLayoutStore ? "" : `width: ${width}px`}
    transition:fly={{ x: 40, duration: 200 }}
    data-testid="edit-panel"
>
    {#if !$mobileLayoutStore}
        <div class="em-resize">
            <MapEditorResizeHandle
                minWidth={300}
                maxWidth={Math.max(300, $windowSize.width - 140)}
                currentWidth={width}
                onResize={(w) => onResize(w)}
            />
        </div>
    {/if}
    <button
        type="button"
        class="em-grab"
        aria-label={$LL.mapEditor.edit.hint.tuck()}
        title={$LL.mapEditor.edit.hint.tuck()}
        data-testid="closeVisitCardButton"
        on:click={tuck}
    >
        <IconChevronRight font-size="18" />
    </button>
    <div class="sidebar em-sidebar">
        <div class="flex flex-row justify-end em-bots-anchor" />
        {#if tool === EditorToolName.EntityEditor}
            <ObjectsPanel />
        {:else if tool === EditorToolName.AreaEditor}
            <AreasPanel />
        {:else if external}
            <PanelHeader title={external.label} subtitle={external.subtitle} />
        {/if}
    </div>
</div>

<style>
    .em-panel {
        position: absolute;
        top: 160px;
        bottom: 14px;
        right: 92px;
        border-radius: 24px;
        padding: 14px 14px 14px 22px;
        color: #fff;
        z-index: 2;
    }
    :global(.em-phone) .em-panel {
        top: calc(78px + env(safe-area-inset-top, 0px));
        bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        left: 10px;
        right: 80px;
        width: auto !important;
    }
    .em-resize {
        position: absolute;
        top: 0;
        bottom: 0;
        left: -2px;
        display: flex;
        flex-direction: column;
        z-index: 3;
    }
    .em-grab {
        position: absolute;
        left: -1px;
        top: 50%;
        width: 22px;
        height: 56px;
        margin: -28px 0 0;
        padding: 0;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 0 12px 12px 0;
        background: transparent;
        color: rgba(244, 242, 250, 0.64);
        cursor: pointer;
        z-index: 2;
    }
    @media (hover: hover) {
        .em-grab:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.06);
        }
    }
    .em-sidebar {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
        min-height: 0;
    }
    .em-bots-anchor {
        display: none;
    }
    /* The bots module shows the anchor row when it puts its page in; then it must take no room. */
    .em-sidebar :global(#bot-editor-container) {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }
</style>
