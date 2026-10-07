<script lang="ts">
    // The actions of an area you tapped on the map, pinned under it: Settings and Delete. Moving and resizing happen
    // on the area itself (drag inside it, drag its corners), so they need no button here.
    import { onDestroy, onMount } from "svelte";
    import { fade } from "svelte/transition";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { screenSpace } from "../../../Phaser/Game/MapEditor/ScreenSpace";
    import type { AreaEditorTool } from "../../../Phaser/Game/MapEditor/Tools/AreaEditorTool";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { mapEditorSelectedAreaPreviewStore, mapEditorVisibilityStore } from "../../../Stores/MapEditorStore";
    import { editAreaSettingsRequestStore } from "../../../Stores/EditModeStore";
    import { IconSettings, IconTrash } from "@wa-icons";

    let left = 0;
    let top = 0;
    let visible = false;
    let frame: number | undefined;
    let root: HTMLElement;

    function place() {
        // Every frame, also while there is nothing to place: during a map change the scene is gone for a moment.
        frame = requestAnimationFrame(place);
        const preview = $mapEditorSelectedAreaPreviewStore;
        const scene = gameManager.tryGetCurrentGameScene();
        if (!preview || !scene) {
            visible = false;
            return;
        }
        const bounds = preview.getBounds();
        const {
            x: screenLeft,
            y: screenTop,
            width: screenWidth,
            height: screenHeight,
        } = screenSpace(scene).rect(bounds.left, bounds.top, bounds.width, bounds.height);
        const width = root?.offsetWidth ?? 130;
        const height = root?.offsetHeight ?? 60;
        const parentWidth = root?.parentElement?.clientWidth ?? window.innerWidth;
        const parentHeight = root?.parentElement?.clientHeight ?? window.innerHeight;
        left = Math.min(Math.max(8, screenLeft + screenWidth / 2 - width / 2), parentWidth - width - 8);
        // Below the area, clear of its corner handles; above it when there is no room below.
        top = screenTop + screenHeight + 18;
        // Never under the edit pill at the top, so Done and Undo stay in reach.
        const minTop = editPillBottom();
        if (top + height > parentHeight - 90) top = screenTop - height - 18;
        top = Math.max(minTop, top);
        visible = true;
    }

    function editPillBottom(): number {
        const pill = root?.parentElement?.querySelector<HTMLElement>('[data-testid="edit-pill"]');
        const parent = root?.parentElement;
        if (!pill || !parent) return 8;
        return pill.getBoundingClientRect().bottom - parent.getBoundingClientRect().top + 8;
    }

    onMount(() => {
        frame = requestAnimationFrame(place);
    });
    onDestroy(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
    });

    function tool(): AreaEditorTool | undefined {
        return gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager()?.currentlyActiveTool as
            | AreaEditorTool
            | undefined;
    }

    function settings() {
        // The panel opens if it was tucked away, and an open setting page goes back to the area's own settings, so
        // the button always shows something.
        mapEditorVisibilityStore.set(true);
        editAreaSettingsRequestStore.update((n) => n + 1);
    }
    function remove() {
        const preview = $mapEditorSelectedAreaPreviewStore;
        if (!preview) return;
        tool()?.handleDeleteAreaFrontCommandExecution(preview.getId(), undefined, () => tool()?.deselectArea?.());
    }
</script>

<div
    bind:this={root}
    class="em-actions u-surface pointer-events-auto"
    class:em-hidden={!visible}
    class:phone={$mobileLayoutStore}
    style="left: {left}px; top: {top}px;"
    transition:fade={{ duration: 120 }}
    data-testid="area-actions"
>
    <div class="em-actions-row">
        <button type="button" class="em-act" data-testid="area-actions-settings" on:click={settings}>
            <IconSettings font-size="18" />{$LL.mapEditor.edit.objects.actions.settings()}
        </button>
        <button type="button" class="em-act em-act-del" data-testid="area-actions-delete" on:click={remove}>
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
</style>
