<script lang="ts">
    // The pill at the top while editing: Done leaves, the middle says what you edit, Undo and Redo on the right.
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorVisibilityStore } from "../../../Stores/MapEditorStore";
    import { editUndoRedoStore } from "../../../Stores/EditModeStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { IconArrowBackUp, IconCheck } from "@wa-icons";

    const roomName = gameManager.currentStartedRoom?.roomName ?? "";

    function done() {
        analyticsClient.toggleMapEditor(false);
        mapEditorVisibilityStore.set(false);
        gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager().equipTool(EditorToolName.CloseMapEditor);
    }
    function undo() {
        gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager().undo();
    }
    function redo() {
        gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager().redo();
    }
</script>

<div class="em-pill u-surface pointer-events-auto" data-testid="edit-pill">
    <button type="button" class="em-done u-cta" data-testid="closeMapEditorButton" on:click={done}>
        <IconCheck font-size="18" />
        {$LL.mapEditor.edit.done()}
    </button>
    <div class="em-mid">
        <span class="em-eyebrow">{$LL.mapEditor.edit.eyebrow()}</span>
        <b class="em-room">{roomName}</b>
    </div>
    <button
        type="button"
        class="em-circ"
        aria-label={$LL.mapEditor.edit.undo()}
        title={$LL.mapEditor.edit.undo()}
        disabled={!$editUndoRedoStore.canUndo}
        data-testid="edit-undo"
        on:click={undo}
    >
        <IconArrowBackUp font-size="20" />
    </button>
    <button
        type="button"
        class="em-circ em-redo"
        aria-label={$LL.mapEditor.edit.redo()}
        title={$LL.mapEditor.edit.redo()}
        disabled={!$editUndoRedoStore.canRedo}
        data-testid="edit-redo"
        on:click={redo}
    >
        <IconArrowBackUp font-size="20" />
    </button>
</div>

<style>
    .em-pill {
        position: absolute;
        top: var(--tiles-clear, 0px);
        left: 50%;
        transform: translateX(-50%);
        width: min(430px, calc(100% - 24px));
        height: 56px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 6px;
        border-radius: 999px;
        color: #fff;
        /* Over the actions pinned to what you tapped on the map, under the panel. */
        z-index: 2;
    }
    :global(.em-phone) .em-pill {
        top: calc(var(--tiles-clear, 0px) + 10px + env(safe-area-inset-top, 0px));
        left: 10px;
        right: 10px;
        width: auto;
        transform: none;
    }
    .em-done {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 44px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        flex: none;
    }
    .em-mid {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        line-height: 1.15;
    }
    .em-eyebrow {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #a78bfa;
    }
    .em-room {
        max-width: 100%;
        font-size: 15px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
        transition: background-color 150ms ease, opacity 150ms ease;
    }
    .em-circ:disabled {
        opacity: 0.35;
        cursor: default;
    }
    @media (hover: hover) {
        .em-circ:not(:disabled):hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .em-circ:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
    .em-redo :global(svg) {
        transform: scaleX(-1);
    }
</style>
