<script lang="ts">
    // The panel beside the rail: the contents of the open tool. On phones it spans the width left of the rail; on a
    // computer it floats on the right with a drag edge to resize. Tapping the lit tool on the rail closes it.
    // "#map-editor-right > .sidebar" and the header row stay for the bots module, which puts its own page inside the
    // sidebar after that row.
    import { fly } from "svelte/transition";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { windowSize } from "../../../Stores/CoWebsiteStore";
    import { EditorToolName } from "../../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorSelectedToolStore } from "../../../Stores/MapEditorStore";
    import { editToolsStore } from "../../../Stores/EditModeStore";
    import MapEditorResizeHandle from "../MapEditorResizeHandle.svelte";
    import { mapEditorSideBarWidthStore } from "../MapEditorSideBarWidthStore";
    import ObjectsPanel from "./ObjectsPanel.svelte";
    import AreasPanel from "./AreasPanel.svelte";
    import PanelHeader from "./PanelHeader.svelte";

    $: tool = $mapEditorSelectedToolStore;
    $: external = $editToolsStore.find((t) => t.id === tool);
    $: width = Math.min(Math.max(300, $mapEditorSideBarWidthStore), Math.max(300, $windowSize.width - 140));

    function onResize(newWidth: number) {
        mapEditorSideBarWidthStore.set(newWidth);
    }
</script>

<!-- The panel slides in but closes at once (in:, not transition:). While a panel slides out, Svelte treats every
     update inside it as a full redraw, and the area's tag inputs then feed each other values without end. -->
<div
    id="map-editor-right"
    class="map-editor em-panel u-surface pointer-events-auto {tool}"
    style={$mobileLayoutStore ? "" : `width: ${width}px`}
    in:fly={{ x: 40, duration: 200 }}
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
        top: 64px;
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
