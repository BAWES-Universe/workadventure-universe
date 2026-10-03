<script lang="ts">
    import { fly } from "svelte/transition";
    import { onMount } from "svelte";
    import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorSelectedToolStore, mapEditorVisibilityStore } from "../../Stores/MapEditorStore";
    import Explorer from "../Exploration/Explorer.svelte";
    import ArrowBarRight from "../Icons/ArrowBarRight.svelte";
    import { windowSize } from "../../Stores/CoWebsiteStore";
    import ButtonClose from "../Input/ButtonClose.svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL } from "../../../i18n/i18n-svelte";
    import AreaEditor from "./AreaEditor/AreaEditor.svelte";
    import EntityEditor from "./EntityEditor/EntityEditor.svelte";
    import MapEditorSideBar from "./MapEditorSideBar.svelte";
    import TrashEditor from "./TrashEditor.svelte";
    import ConfigureMyRoom from "./WAMSettingsEditor.svelte";
    import MapEditorResizeHandle from "./MapEditorResizeHandle.svelte";
    import MapEditorSheetHandle from "./MapEditorSheetHandle.svelte";
    import MapEditorPlacingBar from "./MapEditorPlacingBar.svelte";
    import { mapEditorSideBarWidthStore } from "./MapEditorSideBarWidthStore";
    import { getMapEditorToolLabel, mapEditorIsMobileLayoutStore, mapEditorSheetSnapStore } from "./MapEditorTools";
    import { clampSheetHeight, getSheetSnapHeights, nearestSheetSnap, nextSheetSnap } from "./MapEditorSheet";

    const direction = document.documentElement.getAttribute("dir") || "ltr";

    let mapEditor: HTMLElement;

    function hideMapEditor() {
        mapEditorVisibilityStore.set(false);
    }

    $: isMobile = $mapEditorIsMobileLayoutStore;

    $: panelVisible = $mapEditorVisibilityStore && $mapEditorSelectedToolStore !== EditorToolName.WAMSettingsEditor;

    $: mapEditorSideBarWidth = panelVisible ? $mapEditorSideBarWidthStore : 0;

    function onResize(width: number) {
        mapEditorSideBarWidthStore.set(width);
    }

    $: if (mapEditor) {
        // On mobile the panel is a full-width bottom sheet; its height comes from the snap point.
        mapEditor.style.width = isMobile ? "100%" : `${mapEditorSideBarWidth}px`;
    }

    // Height while the user drags the handle; undefined when resting on a snap point.
    let dragHeight: number | undefined;

    // Closing the panel mid-drag unmounts the handle before it can release; drop the drag so it reopens on a snap.
    $: if (!panelVisible) dragHeight = undefined;

    $: sheetHeight = dragHeight ?? getSheetSnapHeights($windowSize.height)[$mapEditorSheetSnapStore];

    function onSheetDrag(height: number) {
        dragHeight = clampSheetHeight(height, $windowSize.height);
    }

    function onSheetRelease(height: number) {
        dragHeight = undefined;
        mapEditorSheetSnapStore.set(nearestSheetSnap(height, $windowSize.height));
    }

    function onSheetTap() {
        mapEditorSheetSnapStore.set(nextSheetSnap($mapEditorSheetSnapStore));
    }

    $: sheetTitle = getMapEditorToolLabel($LL, $mapEditorSelectedToolStore);

    // Exploring is about the map: on mobile it opens with the sheet at peek so the list does not cover it.
    let lastSelectedTool: EditorToolName | undefined;
    $: onSelectedToolChange($mapEditorSelectedToolStore);

    function onSelectedToolChange(tool: EditorToolName | undefined) {
        if (tool === lastSelectedTool) return;
        lastSelectedTool = tool;
        if (tool === EditorToolName.ExploreTheRoom && $mapEditorIsMobileLayoutStore) {
            mapEditorSheetSnapStore.set("peek");
        }
    }

    $: flyParams = isMobile ? { y: 100 } : { x: 100 };

    function closeMapEditor() {
        mapEditorVisibilityStore.set(false);
        gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(EditorToolName.CloseMapEditor);
    }

    onMount(() => {
        if (isMobile) return;
        const width = Math.min($windowSize.width / 2, Math.max(200, $mapEditorSideBarWidthStore));
        mapEditor.style.width = `${width}px`;
    });
</script>

{#if $mapEditorSelectedToolStore === EditorToolName.WAMSettingsEditor}
    <ConfigureMyRoom />
{/if}
<MapEditorPlacingBar />
<div
    id="map-editor-container"
    class="z-[500] absolute pointer-events-none {isMobile
        ? 'inset-0 flex flex-col items-stretch justify-end gap-2'
        : 'flex flex-row items-start justify-end gap-4 h-full max-w-full md:max-w-[calc(100%-18px)] top-0 end-0'}"
>
    <!-- On mobile the toolbar is always visible, docked above the sheet. -->
    <div
        in:fly={{ ...flyParams, duration: 250, delay: 300 }}
        out:fly={{ ...flyParams, duration: 200, delay: 100 }}
        class={isMobile ? "flex justify-center px-2 max-w-full" : "hidden md:block"}
        class:!block={!isMobile && $mapEditorVisibilityStore == false}
    >
        <MapEditorSideBar />
    </div>
    <div
        id="map-editor-right"
        bind:this={mapEditor}
        class={`map-editor relative max-w-full pointer-events-auto ${$mapEditorSelectedToolStore} ${
            isMobile
                ? `flex flex-col rounded-t-2xl overflow-hidden ${panelVisible ? "bg-contrast/80 backdrop-blur-md" : ""}`
                : "h-dvh md:max-w-[calc(100%-64px)]"
        }`}
        style:height={isMobile ? (panelVisible ? `${sheetHeight}px` : "0px") : null}
        style:transition={isMobile && dragHeight === undefined ? "height 200ms ease-out" : null}
        data-testid="mapEditorPanel"
    >
        {#if panelVisible}
            {#if isMobile}
                <MapEditorSheetHandle
                    title={sheetTitle}
                    {sheetHeight}
                    onDrag={onSheetDrag}
                    onRelease={onSheetRelease}
                    onTap={onSheetTap}
                />
            {:else}
                <div class="absolute h-dvh -start-0.5 top-0 flex flex-col z-[2000]">
                    <MapEditorResizeHandle
                        minWidth={200}
                        maxWidth={$windowSize.width / 1.5}
                        currentWidth={$mapEditorSideBarWidthStore}
                        onResize={(width) => onResize(width)}
                    />
                </div>
            {/if}
            <div
                class="sidebar p-2 md:p-4 {isMobile
                    ? 'flex-1 min-h-0 overflow-y-auto pt-0'
                    : 'h-dvh bg-contrast/80 backdrop-blur-md'}"
                in:fly={{ ...flyParams, duration: 200, delay: 200 }}
                out:fly={{ ...flyParams, duration: 200 }}
            >
                <!-- On mobile, closing lives in the toolbar and the sheet handle replaces collapse. -->
                <div
                    class="flex flex-row justify-end w-full md:w-fit md:absolute md:top-4 md:right-2"
                    class:!hidden={isMobile}
                >
                    <button
                        class="h-8 w-8 rounded flex items-center justify-center hover:bg-white/20 transition-all aspect-square cursor-pointer text-2xl opacity-50 hover:opacity-100"
                        class:right-4={direction === "ltr"}
                        class:left-4={direction === "rtl"}
                        on:click={hideMapEditor}
                    >
                        <ArrowBarRight
                            height="h-5"
                            width="w-5"
                            strokeColor="stroke-white"
                            fillColor="fill-transparent"
                            classList={`aspect-ratio transition-all ${direction === "rtl" ? "rotate-180" : ""}`}
                        />
                    </button>
                    <ButtonClose
                        extraButtonClasses="backdrop-blur-0 backdrop-filter-none opacity-50 hover:opacity-100"
                        bgColor="bg-transparent"
                        size="sm"
                        dataTestId="closeVisitCardButton"
                        on:click={closeMapEditor}
                    />
                </div>

                {#if $mapEditorSelectedToolStore === EditorToolName.TrashEditor}
                    <TrashEditor />
                {/if}
                {#if $mapEditorSelectedToolStore === EditorToolName.EntityEditor}
                    <EntityEditor />
                {/if}
                {#if $mapEditorSelectedToolStore === EditorToolName.AreaEditor}
                    {#if $mapEditorIsMobileLayoutStore}
                        <p class="m-0 rounded bg-white/10 px-3 py-2 text-sm" data-testid="worksBestOnDesktopNotice">
                            {$LL.mapEditor.sideBar.worksBestOnDesktop()}
                        </p>
                    {/if}
                    <AreaEditor />
                {/if}
                {#if $mapEditorSelectedToolStore === EditorToolName.ExploreTheRoom}
                    <Explorer />
                {/if}
            </div>
        {/if}
    </div>
</div>

<style lang="scss">
    .map-editor {
        top: 0;
        inset-inline-end: 0;
        width: fit-content;
        z-index: 1999;
        pointer-events: auto;
        color: whitesmoke;

        button.close-window {
            inset-inline-end: 0.5rem;
        }

        &.WAMSettingsEditor {
            width: 80% !important;
            inset-inline-start: 10%;
            height: 0 !important;
        }

        .sidebar {
            position: relative !important;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
    }
</style>
