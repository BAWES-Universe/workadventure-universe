<script lang="ts">
    // The box of a new area: drawn over the map, with four round corners to resize and a size in tiles. Dragging inside
    // moves it; dragging outside moves around the map (the editor's drag-to-pan). It sizes freely, to the pixel, as
    // areas always have; holding Shift on a computer snaps it to the tile grid.
    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { screenSpace } from "../../../Phaser/Game/MapEditor/ScreenSpace";
    import { editAreaDraftStore, type AreaDraft } from "../../../Stores/EditModeStore";

    const TILE = 32;
    const MIN_SIZE = TILE;

    let box = { left: 0, top: 0, width: 0, height: 0 };
    let frame: number | undefined;
    let visible = false;
    let shiftHeld = false;

    function camera() {
        return gameManager.tryGetCurrentGameScene()?.cameras.main;
    }

    function toScreen(draft: AreaDraft) {
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene) return;
        const r = screenSpace(scene).rect(draft.x, draft.y, draft.width, draft.height);
        box = { left: r.x, top: r.y, width: r.width, height: r.height };
        visible = true;
    }

    function onKey(event: KeyboardEvent) {
        shiftHeld = event.shiftKey;
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
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);
    });
    onDestroy(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
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
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene) return;
        const scale = screenSpace(scene).scale;
        const dx = (event.clientX - dragging.startX) / scale;
        const dy = (event.clientY - dragging.startY) / scale;
        const s = dragging.start;
        const shift = shiftHeld || event.shiftKey;
        const snap = (v: number) => (shift ? Math.round(v / TILE) * TILE : Math.round(v));
        let next: AreaDraft;
        switch (dragging.corner) {
            case "move":
                next = { ...s, x: snap(s.x + dx), y: snap(s.y + dy) };
                break;
            case "nw": {
                const x = Math.min(snap(s.x + dx), s.x + s.width - MIN_SIZE);
                const y = Math.min(snap(s.y + dy), s.y + s.height - MIN_SIZE);
                next = { x, y, width: s.x + s.width - x, height: s.y + s.height - y };
                break;
            }
            case "ne": {
                const right = Math.max(snap(s.x + s.width + dx), s.x + MIN_SIZE);
                const y = Math.min(snap(s.y + dy), s.y + s.height - MIN_SIZE);
                next = { x: s.x, y, width: right - s.x, height: s.y + s.height - y };
                break;
            }
            case "sw": {
                const x = Math.min(snap(s.x + dx), s.x + s.width - MIN_SIZE);
                const bottom = Math.max(snap(s.y + s.height + dy), s.y + MIN_SIZE);
                next = { x, y: s.y, width: s.x + s.width - x, height: bottom - s.y };
                break;
            }
            default: {
                const right = Math.max(snap(s.x + s.width + dx), s.x + MIN_SIZE);
                const bottom = Math.max(snap(s.y + s.height + dy), s.y + MIN_SIZE);
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
    // The size in tiles, to a tenth when it is not whole tiles.
    const tiles = (px: number) => String(Math.round((px / TILE) * 10) / 10);
    $: tilesWide = draft ? tiles(draft.width) : "0";
    $: tilesHigh = draft ? tiles(draft.height) : "0";
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
