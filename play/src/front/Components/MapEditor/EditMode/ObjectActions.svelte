<script lang="ts">
    // The actions of an object you tapped, right next to it: Move, Copy, Settings, Delete. (Turning a placed object
    // is not something the engine can do yet: it keeps the picture it was placed with.)
    import { onDestroy, onMount } from "svelte";
    import { fade } from "svelte/transition";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { screenSpace } from "../../../Phaser/Game/MapEditor/ScreenSpace";
    import type { EntityEditorTool } from "../../../Phaser/Game/MapEditor/Tools/EntityEditorTool";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import {
        mapEditorEntityModeStore,
        mapEditorSelectedEntityStore,
        mapEditorVisibilityStore,
    } from "../../../Stores/MapEditorStore";
    import { editObjectsViewStore, showUndoToast } from "../../../Stores/EditModeStore";
    import { IconCopy, IconHandMove, IconSettings, IconTrash } from "@wa-icons";

    let left = 0;
    let top = 0;
    let visible = false;
    let moveHint = false;
    let moveHintTimeout: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    let root: HTMLElement;

    function place() {
        const entity = $mapEditorSelectedEntityStore;
        const scene = gameManager.tryGetCurrentGameScene();
        if (!entity || !scene) {
            visible = false;
            return;
        }
        const bounds = entity.getBounds();
        const {
            x: screenLeft,
            y: screenTop,
            width: screenWidth,
            height: screenHeight,
        } = screenSpace(scene).rect(bounds.left, bounds.top, bounds.width, bounds.height);
        const width = root?.offsetWidth ?? 260;
        const height = root?.offsetHeight ?? 60;
        const parentWidth = root?.parentElement?.clientWidth ?? window.innerWidth;
        const parentHeight = root?.parentElement?.clientHeight ?? window.innerHeight;
        left = Math.min(Math.max(8, screenLeft + screenWidth / 2 - width / 2), parentWidth - width - 8);
        // Below the object; above it when there is no room below.
        top = screenTop + screenHeight + 10;
        if (top + height > parentHeight - 90) top = Math.max(8, screenTop - height - 10);
        visible = true;
        frame = requestAnimationFrame(place);
    }

    onMount(() => {
        frame = requestAnimationFrame(place);
    });
    onDestroy(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        if (moveHintTimeout) clearTimeout(moveHintTimeout);
    });

    function tool(): EntityEditorTool | undefined {
        return gameManager.getCurrentGameScene().getMapEditorModeManager().currentlyActiveTool as
            | EntityEditorTool
            | undefined;
    }

    function move() {
        moveHint = true;
        if (moveHintTimeout) clearTimeout(moveHintTimeout);
        moveHintTimeout = setTimeout(() => (moveHint = false), 2500);
    }
    function copy() {
        const entity = $mapEditorSelectedEntityStore;
        if (!entity) return;
        tool()?.duplicateEntity?.(entity);
    }
    function settings() {
        editObjectsViewStore.set("settings");
        mapEditorVisibilityStore.set(true);
    }
    function remove() {
        const entity = $mapEditorSelectedEntityStore;
        if (!entity) return;
        const name = entity.getEntityData().name || entity.getPrefab().name || $LL.mapEditor.edit.tools.objects();
        entity.delete();
        mapEditorSelectedEntityStore.set(undefined);
        mapEditorEntityModeStore.set("ADD");
        showUndoToast($LL.mapEditor.edit.deleteTool.removed({ name }));
    }
</script>

<div
    bind:this={root}
    class="em-actions u-surface pointer-events-auto"
    class:em-hidden={!visible}
    class:phone={$mobileLayoutStore}
    style="left: {left}px; top: {top}px;"
    transition:fade={{ duration: 120 }}
    data-testid="object-actions"
>
    {#if moveHint}
        <div class="em-move-hint">
            {$LL.mapEditor.edit.objects.actions.move()}: {$LL.mapEditor.edit.areas.draftSubtitle()}
        </div>
    {/if}
    <div class="em-actions-row">
        <button type="button" class="em-act" on:click={move}>
            <IconHandMove font-size="18" />{$LL.mapEditor.edit.objects.actions.move()}
        </button>
        <button type="button" class="em-act" data-testid="object-copy" on:click={copy}>
            <IconCopy font-size="18" />{$LL.mapEditor.edit.objects.actions.copy()}
        </button>
        <button type="button" class="em-act" data-testid="object-settings" on:click={settings}>
            <IconSettings font-size="18" />{$LL.mapEditor.edit.objects.actions.settings()}
        </button>
        <button type="button" class="em-act em-act-del" data-testid="object-delete" on:click={remove}>
            <IconTrash font-size="18" />{$LL.mapEditor.edit.objects.actions.delete()}
        </button>
    </div>
</div>

<style>
    .em-actions {
        position: absolute;
        padding: 5px;
        border-radius: 999px;
        color: #fff;
        /* Under the panel and the rail: a panel opened over the map covers what is on the map. */
        z-index: 1;
    }
    .em-hidden {
        visibility: hidden;
    }
    .em-actions-row {
        display: flex;
        gap: 2px;
    }
    .em-act {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        width: 54px;
        padding: 5px 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        font: inherit;
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .em-act:hover {
            background: rgba(255, 255, 255, 0.08);
        }
    }
    .em-act-del {
        color: #f7a48f;
    }
    .em-move-hint {
        padding: 4px 10px 6px;
        font-size: 12px;
        color: rgba(244, 242, 250, 0.8);
        text-align: center;
    }
</style>
