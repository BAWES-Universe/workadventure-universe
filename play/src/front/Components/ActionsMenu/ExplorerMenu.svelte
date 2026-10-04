<script lang="ts">
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { mapEditorModeStore, mapExplorationModeStore } from "../../Stores/MapEditorStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
    import LL from "../../../i18n/i18n-svelte";
    import { roomListActivated } from "../../Stores/MenuStore";
    import { roomListVisibilityStore } from "../../Stores/ModalStore";
    import { universeNameStore } from "../../Stores/ExploreStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import { displayName } from "../Exploration/exploreText";
    import { toggleExploreList } from "../Exploration/toggleExploreList";
    import { IconFocusCentered, IconMinus, IconPlanet, IconPlus, IconZoomOutArea } from "@wa-icons";

    function zoomIn() {
        analyticsClient.clickToZoomIn();

        const cameraManager = gameManager.getCurrentGameScene().getCameraManager();
        cameraManager.zoomByFactor(1.2, true);
    }

    function zoomOut() {
        analyticsClient.clickToZoomOut();

        const cameraManager = gameManager.getCurrentGameScene().getCameraManager();
        cameraManager.zoomByFactor(0.8, true);
    }

    function openMapExplorer() {
        analyticsClient.clickTopOpenMapExplorer();

        mapEditorModeStore.switchMode(true);
        gameManager.getCurrentGameScene().getMapEditorModeManager().equipTool(EditorToolName.ExploreTheRoom);
    }

    function centerToUser() {
        analyticsClient.clickCenterToUser();

        mapEditorModeStore.switchMode(false);
        gameManager.getCurrentGameScene().getMapEditorModeManager().equipTool(EditorToolName.CloseMapEditor);
    }
</script>

<!-- The zoom column, in the bar's ink: + and − (desktops and tablets; phones pinch), then the map overview. It is always
     smaller than Express below it, so Express stays the main button. On a phone it holds "Explore {Universe}" on top,
     which has no room in the phone's bar. Tooltips show on hover and keyboard focus, to the left. -->
<div class="explorer-pill pointer-events-auto" data-testid="actions-explorer">
    {#if $mobileLayoutStore && $roomListActivated}
        <button
            type="button"
            class="explorer-btn group"
            class:open={$roomListVisibilityStore}
            aria-label={$universeNameStore
                ? $LL.actionbar.explore.button({ universe: displayName($universeNameStore) })
                : $LL.actionbar.explore.buttonWithoutName()}
            aria-pressed={$roomListVisibilityStore}
            data-testid="explore-tile"
            on:click={toggleExploreList}
        >
            <IconPlanet font-size="20" />
        </button>
        <span class="explorer-divider" aria-hidden="true" />
    {/if}
    {#if !$mobileLayoutStore}
        <button type="button" class="explorer-btn group" aria-label={$LL.mapEditor.explorer.zoomIn()} on:click={zoomIn}>
            <IconPlus font-size="20" />
            <span class="explorer-tip" aria-hidden="true">{$LL.mapEditor.explorer.zoomIn()}</span>
        </button>
        <button
            type="button"
            class="explorer-btn group"
            aria-label={$LL.mapEditor.explorer.zoomOut()}
            on:click={zoomOut}
        >
            <IconMinus font-size="20" />
            <span class="explorer-tip" aria-hidden="true">{$LL.mapEditor.explorer.zoomOut()}</span>
        </button>
        <span class="explorer-divider" aria-hidden="true" />
    {/if}
    {#if $mapExplorationModeStore === false}
        <button
            type="button"
            class="explorer-btn group"
            aria-label={$LL.mapEditor.explorer.title()}
            data-testid="map-overview-button"
            on:click={openMapExplorer}
        >
            <IconZoomOutArea font-size="20" />
            <span class="explorer-tip" aria-hidden="true">{$LL.mapEditor.explorer.title()}</span>
        </button>
    {:else}
        <button
            type="button"
            class="explorer-btn group"
            aria-label={$LL.mapEditor.explorer.showMyLocation()}
            on:click={centerToUser}
        >
            <IconFocusCentered font-size="20" />
            <span class="explorer-tip" aria-hidden="true">{$LL.mapEditor.explorer.showMyLocation()}</span>
        </button>
    {/if}
</div>

<style>
    /* The bar's ink pill (u-surface-flat), round, with its violet edge. It is sized from Express below it, on every
       screen: the buttons are 5/8 of Express and the pill 3/4, so Express always stays the bigger, main button.
       Express is 64px, 56px between 640px and 1280px wide on a computer, and 64px on any touch screen. */
    .explorer-pill {
        --explorer-btn: 40px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 4px;
        /* Held 8px further up off Express than the column's gap. */
        margin-bottom: 8px;
        border-radius: 9999px;
        background: linear-gradient(180deg, rgb(31 28 47 / 0.92), rgb(20 18 30 / 0.94));
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
    }
    @media (min-width: 640px) and (max-width: 1279.98px) {
        .explorer-pill {
            --explorer-btn: 35px;
        }
    }
    @media (pointer: coarse) {
        .explorer-pill {
            --explorer-btn: 40px;
        }
    }
    .explorer-btn {
        position: relative;
        display: grid;
        place-items: center;
        width: var(--explorer-btn);
        height: var(--explorer-btn);
        padding: 0;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: #fff;
        cursor: pointer;
        transition: background-color 150ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    .explorer-btn :global(svg) {
        width: 18px;
        height: 18px;
    }
    @media (hover: hover) {
        .explorer-btn:hover {
            background-color: rgba(255, 255, 255, 0.08);
        }
    }
    .explorer-btn:active {
        background-color: rgba(255, 255, 255, 0.12);
    }
    .explorer-btn.open {
        background-color: rgba(255, 255, 255, 0.14);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .explorer-btn:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px #fff;
    }
    .explorer-divider {
        width: 22px;
        height: 1px;
        margin: 2px 0;
        background: rgba(255, 255, 255, 0.1);
    }
    /* The ink tooltip, to the left of the button. */
    .explorer-tip {
        position: absolute;
        top: 50%;
        right: calc(var(--explorer-btn) + 12px);
        transform: translateY(-50%);
        padding: 6px 10px;
        border-radius: 10px;
        background: linear-gradient(180deg, rgb(31 28 47 / 0.96), rgb(20 18 30 / 0.97));
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: #fff;
        font-size: 0.875rem;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
        opacity: 0;
        transition: opacity 150ms ease;
    }
    @media (hover: hover) {
        .explorer-btn:hover .explorer-tip {
            opacity: 1;
        }
    }
    .explorer-btn:focus-visible .explorer-tip {
        opacity: 1;
    }
</style>
