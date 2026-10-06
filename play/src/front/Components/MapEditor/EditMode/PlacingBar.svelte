<script lang="ts">
    // The bar at the bottom while placing an object, drawing a new area, or while a module places something.
    // It shows what is being placed, its colour when it has more than one, Turn when it has other sides, and Done.
    import { fly } from "svelte/transition";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { EntityEditorTool } from "../../../Phaser/Game/MapEditor/Tools/EntityEditorTool";
    import type { AreaEditorTool } from "../../../Phaser/Game/MapEditor/Tools/AreaEditorTool";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { mapEditorSelectedEntityPrefabStore, mapEditorVisibilityStore } from "../../../Stores/MapEditorStore";
    import {
        editAreaDraftStore,
        editPickedVariantStore,
        editPlacingBarStore,
        editTouchPreviewStore,
        recolorPlacingPreview,
        turnPlacingPreview,
    } from "../../../Stores/EditModeStore";
    import { IconRefresh, IconTexture } from "@wa-icons";

    export let placingObject = false;
    export let drawingArea = false;

    $: prefab = $mapEditorSelectedEntityPrefabStore;
    $: picked = $editPickedVariantStore;
    $: colors = picked?.variant.colors ?? [];
    $: sides = picked ? picked.variant.getEntityPrefabsPositions(picked.color).length : 1;
    $: external = $editPlacingBarStore;

    function tool() {
        return gameManager.getCurrentGameScene().getMapEditorModeManager().currentlyActiveTool;
    }

    function doneObject() {
        const entityTool = tool() as EntityEditorTool | undefined;
        if ($editTouchPreviewStore) {
            // A waiting preview is placed by Done, then placing stops.
            entityTool?.placeWaitingPreview?.();
        }
        entityTool?.stopPlacing?.();
        // On a phone the panel stays tucked so the placed object is in view; Objects on the rail reopens it.
    }

    function cancelArea() {
        editAreaDraftStore.set(undefined);
        if ($mobileLayoutStore) mapEditorVisibilityStore.set(true);
    }

    function nextArea() {
        const draft = $editAreaDraftStore;
        if (!draft) return;
        (tool() as AreaEditorTool | undefined)?.createNewAreaFromDraft?.(draft);
        editAreaDraftStore.set(undefined);
        mapEditorVisibilityStore.set(true);
    }
</script>

<!-- On a phone, an object with colours or sides puts its buttons on a second row, so its name and the hint
     are not cut off. -->
<div
    class="em-bar u-surface pointer-events-auto"
    class:em-bar-stack={$mobileLayoutStore && !external && !drawingArea && (colors.length > 1 || sides > 1)}
    transition:fly={{ y: 40, duration: 200 }}
    data-testid="placing-bar"
>
    {#if external}
        {#if external.image}
            <i class="em-thumb" style="background-image: url({external.image})" />
        {:else if external.icon}
            <span class="em-thumb em-thumb-icon"><svelte:component this={external.icon} font-size="22" /></span>
        {/if}
        <div class="em-text">
            <div class="em-t">{external.title}</div>
            {#if external.subtitle}<div class="em-m">{external.subtitle}</div>{/if}
        </div>
        {#each external.actions as action (action.label)}
            <button
                type="button"
                class="em-btn"
                class:u-cta={action.kind === "primary"}
                class:em-btn-q={action.kind === "secondary"}
                data-testid={action.testId}
                on:click={action.onClick}>{action.label}</button
            >
        {/each}
    {:else if drawingArea}
        <span class="em-thumb em-thumb-icon"><IconTexture font-size="22" /></span>
        <div class="em-text">
            <div class="em-t">{$LL.mapEditor.edit.areas.newArea()}</div>
            <div class="em-m">{$LL.mapEditor.edit.areas.draftSubtitle()}</div>
        </div>
        <button type="button" class="em-btn em-btn-q" data-testid="area-draft-cancel" on:click={cancelArea}
            >{$LL.mapEditor.edit.areas.cancel()}</button
        >
        <button type="button" class="em-btn u-cta" data-testid="area-draft-next" on:click={nextArea}
            >{$LL.mapEditor.edit.areas.next()}</button
        >
    {:else if placingObject && prefab}
        <i class="em-thumb" style="background-image: url({prefab.imagePath})" />
        <div class="em-text">
            <div class="em-t">{picked?.variant.defaultPrefab.name ?? prefab.name}</div>
            <div class="em-m">
                {$mobileLayoutStore
                    ? $LL.mapEditor.edit.objects.placingPhone()
                    : $LL.mapEditor.edit.objects.placingDesktop()}
            </div>
        </div>
        {#if colors.length > 1}
            <div class="em-colors" role="group" aria-label={$LL.mapEditor.edit.objects.colour()}>
                {#each colors as color (color)}
                    <button
                        type="button"
                        class="em-dot"
                        class:on={picked?.color === color}
                        style="background: {color}"
                        aria-label={color}
                        aria-pressed={picked?.color === color}
                        on:click={() => recolorPlacingPreview(color)}
                    />
                {/each}
            </div>
        {/if}
        {#if sides > 1}
            <button
                type="button"
                class="em-circ"
                aria-label={$LL.mapEditor.edit.objects.turn()}
                title={$LL.mapEditor.edit.objects.turn()}
                data-testid="placing-turn"
                on:click={turnPlacingPreview}
            >
                <IconRefresh font-size="18" />
            </button>
        {/if}
        <button type="button" class="em-btn u-cta" data-testid="placing-done" on:click={doneObject}
            >{$LL.mapEditor.edit.done()}</button
        >
    {/if}
</div>

<style>
    .em-bar {
        position: absolute;
        left: 50%;
        bottom: 14px;
        transform: translateX(-50%);
        width: min(560px, calc(100% - 24px));
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px;
        border-radius: 24px;
        color: #fff;
        z-index: 5;
    }
    :global(.em-phone) .em-bar {
        left: 10px;
        right: 10px;
        bottom: calc(14px + env(safe-area-inset-bottom, 0px));
        width: auto;
        transform: none;
    }
    .em-bar-stack {
        flex-wrap: wrap;
        row-gap: 8px;
    }
    .em-bar-stack .em-text {
        flex-basis: calc(100% - 58px);
    }
    :global(.em-phone) .em-m {
        white-space: normal;
    }
    .em-bar-stack .em-text + * {
        margin-left: auto;
    }
    .em-thumb {
        display: grid;
        place-items: center;
        flex: none;
        width: 48px;
        height: 48px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06) center / contain no-repeat;
        background-size: auto 70%;
        image-rendering: pixelated;
        color: #fff;
    }
    .em-thumb-icon {
        background-size: 0;
    }
    .em-text {
        flex: 1;
        min-width: 0;
    }
    .em-t {
        font-size: 15px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .em-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .em-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        height: 44px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .em-btn-q {
        background: rgba(255, 255, 255, 0.08);
    }
    @media (hover: hover) {
        .em-btn-q:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .em-circ {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        border: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .em-circ:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .em-colors {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
    }
    .em-dot {
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.25);
        cursor: pointer;
    }
    .em-dot.on {
        box-shadow: inset 0 0 0 2px #fff, 0 0 0 2px rgba(167, 139, 250, 0.6);
    }
</style>
