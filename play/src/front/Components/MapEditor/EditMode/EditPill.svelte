<script lang="ts">
    // The pill at the top while editing: Done leaves, the middle says what you edit, Undo and Redo on the right.
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorVisibilityStore } from "../../../Stores/MapEditorStore";
    import { editPillStore, editUndoRedoStore } from "../../../Stores/EditModeStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { IconArrowBackUp, IconCheck } from "@wa-icons";

    const roomName = gameManager.currentStartedRoom?.roomName ?? "";

    // A module's own job (a bot's route) takes the pill over: its title, and Done, Undo and Redo do its job
    $: job = $editPillStore;
    $: canUndo = job ? job.canUndo : $editUndoRedoStore.canUndo;
    $: canRedo = job ? job.canRedo : $editUndoRedoStore.canRedo;

    function done() {
        if (job) {
            job.onDone();
            return;
        }
        analyticsClient.toggleMapEditor(false);
        mapEditorVisibilityStore.set(false);
        gameManager.getCurrentGameScene().getMapEditorModeManager().equipTool(EditorToolName.CloseMapEditor);
    }
    function undo() {
        if (job) {
            job.onUndo();
            return;
        }
        gameManager.getCurrentGameScene().getMapEditorModeManager().undo();
    }
    function redo() {
        if (job) {
            job.onRedo();
            return;
        }
        gameManager.getCurrentGameScene().getMapEditorModeManager().redo();
    }
</script>

<div class="em-pill u-surface pointer-events-auto" data-testid="edit-pill">
    <button type="button" class="em-done u-cta" data-testid={job?.doneTestId ?? "closeMapEditorButton"} on:click={done}>
        <IconCheck font-size="18" />
        {$LL.mapEditor.edit.done()}
    </button>
    <div class="em-mid">
        {#if job}
            <b class="em-room">{job.title}</b>
            {#if job.subtitle}
                <span class="em-sub">{job.subtitle}</span>
            {/if}
        {:else}
            <span class="em-eyebrow">{$LL.mapEditor.edit.eyebrow()}</span>
            <b class="em-room">{roomName}</b>
        {/if}
    </div>
    <button
        type="button"
        class="em-circ"
        aria-label={$LL.mapEditor.edit.undo()}
        title={$LL.mapEditor.edit.undo()}
        disabled={!canUndo}
        data-testid={job?.undoTestId ?? "edit-undo"}
        on:click={undo}
    >
        <IconArrowBackUp font-size="20" />
    </button>
    <button
        type="button"
        class="em-circ em-redo"
        aria-label={$LL.mapEditor.edit.redo()}
        title={$LL.mapEditor.edit.redo()}
        disabled={!canRedo}
        data-testid={job?.redoTestId ?? "edit-redo"}
        on:click={redo}
    >
        <IconArrowBackUp font-size="20" />
    </button>
</div>

<style>
    .em-pill {
        position: absolute;
        top: 0;
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
    }
    :global(.em-phone) .em-pill {
        top: calc(10px + env(safe-area-inset-top, 0px));
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
    .em-sub {
        max-width: 100%;
        font-size: 12.5px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.6);
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
