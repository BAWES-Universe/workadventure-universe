<script lang="ts">
    // The box of a new area: drawn over the map, with four round corners to resize and a size in tiles. Dragging inside
    // moves it; dragging outside moves around the map (the editor's drag-to-pan). It snaps to the tile grid.
    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { editAreaDraftStore, type AreaDraft } from "../../../Stores/EditModeStore";

    const TILE = 32;
    const MIN_TILES = 1;

    let box = { left: 0, top: 0, width: 0, height: 0 };
    let frame: number | undefined;
    let visible = false;

    function camera() {
        return gameManager.tryGetCurrentGameScene()?.cameras.main;
    }

    function toScreen(draft: AreaDraft) {
        const cam = camera();
        if (!cam) return;
        const zoom = cam.zoom;
        box = {
            left: (draft.x - cam.worldView.x) * zoom,
            top: (draft.y - cam.worldView.y) * zoom,
            width: draft.width * zoom,
            height: draft.height * zoom,
        };
        visible = true;
    }

    function tick() {
        const draft = get(editAreaDraftStore);
        if (draft) toScreen(draft);
        frame = requestAnimationFrame(tick);
    }

    onMount(() => {
        if (!get(editAreaDraftStore)) {
            // Start in the middle of the screen, 6 × 5 tiles, on the grid.
            const cam = camera();
            if (cam) {
                const centerX = cam.worldView.x + cam.worldView.width / 2;
                const centerY = cam.worldView.y + cam.worldView.height / 2;
                const width = 6 * TILE;
                const height = 5 * TILE;
                editAreaDraftStore.set({
                    x: Math.round((centerX - width / 2) / TILE) * TILE,
                    y: Math.round((centerY - height / 2) / TILE) * TILE,
                    width,
                    height,
                });
            }
        }
        frame = requestAnimationFrame(tick);
    });
    onDestroy(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
    });

    type Corner = "nw" | "ne" | "sw" | "se" | "move";
    let dragging: { corner: Corner; startX: number; startY: number; start: AreaDraft } | undefined;

    function down(corner: Corner, event: PointerEvent) {
        const draft = get(editAreaDraftStore);
        if (!draft) return;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        dragging = { corner, startX: event.clientX, startY: event.clientY, start: { ...draft } };
        event.preventDefault();
        event.stopPropagation();
    }

    function moveDrag(event: PointerEvent) {
        if (!dragging) return;
        const cam = camera();
        if (!cam) return;
        const dx = (event.clientX - dragging.startX) / cam.zoom;
        const dy = (event.clientY - dragging.startY) / cam.zoom;
        const s = dragging.start;
        const snap = (v: number) => Math.round(v / TILE) * TILE;
        let next: AreaDraft;
        switch (dragging.corner) {
            case "move":
                next = { ...s, x: snap(s.x + dx), y: snap(s.y + dy) };
                break;
            case "nw": {
                const x = Math.min(snap(s.x + dx), s.x + s.width - MIN_TILES * TILE);
                const y = Math.min(snap(s.y + dy), s.y + s.height - MIN_TILES * TILE);
                next = { x, y, width: s.x + s.width - x, height: s.y + s.height - y };
                break;
            }
            case "ne": {
                const right = Math.max(snap(s.x + s.width + dx), s.x + MIN_TILES * TILE);
                const y = Math.min(snap(s.y + dy), s.y + s.height - MIN_TILES * TILE);
                next = { x: s.x, y, width: right - s.x, height: s.y + s.height - y };
                break;
            }
            case "sw": {
                const x = Math.min(snap(s.x + dx), s.x + s.width - MIN_TILES * TILE);
                const bottom = Math.max(snap(s.y + s.height + dy), s.y + MIN_TILES * TILE);
                next = { x, y: s.y, width: s.x + s.width - x, height: bottom - s.y };
                break;
            }
            default: {
                const right = Math.max(snap(s.x + s.width + dx), s.x + MIN_TILES * TILE);
                const bottom = Math.max(snap(s.y + s.height + dy), s.y + MIN_TILES * TILE);
                next = { x: s.x, y: s.y, width: right - s.x, height: bottom - s.y };
            }
        }
        editAreaDraftStore.set(next);
        toScreen(next);
    }

    function up() {
        dragging = undefined;
    }

    $: draft = $editAreaDraftStore;
    $: tilesWide = draft ? Math.round(draft.width / TILE) : 0;
    $: tilesHigh = draft ? Math.round(draft.height / TILE) : 0;
</script>

{#if draft && visible}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="em-draft pointer-events-auto"
        style="left: {box.left}px; top: {box.top}px; width: {box.width}px; height: {box.height}px;"
        data-testid="area-draft"
        on:pointerdown={(e) => down("move", e)}
        on:pointermove={moveDrag}
        on:pointerup={up}
        on:pointercancel={up}
    >
        <span class="em-size u-surface">{$LL.mapEditor.edit.areas.tiles({ width: tilesWide, height: tilesHigh })}</span>
        {#each ["nw", "ne", "sw", "se"] as corner (corner)}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <i
                class="em-corner em-{corner}"
                on:pointerdown={(e) => down(corner === "nw" || corner === "ne" || corner === "sw" ? corner : "se", e)}
                on:pointermove={moveDrag}
                on:pointerup={up}
                on:pointercancel={up}
            />
        {/each}
    </div>
{/if}

<style>
    .em-draft {
        position: absolute;
        border-radius: 6px;
        background: rgba(134, 41, 252, 0.2);
        outline: 2px solid rgba(196, 181, 253, 0.95);
        cursor: move;
        touch-action: none;
        z-index: 3;
    }
    .em-size {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
    }
    .em-corner {
        position: absolute;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0 0 3px #8b5cf6;
        touch-action: none;
    }
    .em-nw {
        left: -11px;
        top: -11px;
        cursor: nwse-resize;
    }
    .em-ne {
        right: -11px;
        top: -11px;
        cursor: nesw-resize;
    }
    .em-sw {
        left: -11px;
        bottom: -11px;
        cursor: nesw-resize;
    }
    .em-se {
        right: -11px;
        bottom: -11px;
        cursor: nwse-resize;
    }
</style>
