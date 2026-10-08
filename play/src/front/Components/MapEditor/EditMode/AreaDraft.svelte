<script lang="ts">
    // The box of a new area once it is drawn: the same frame and eight round dots as every picked area, named "New
    // area" until it has a name. Dragging inside moves it; dragging a dot resizes it; dragging outside moves around
    // the map (the editor's drag-to-pan). It sizes freely, to the pixel, as areas always have; holding Shift on a
    // computer snaps it to the tile grid.
    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { screenSpace } from "../../../Phaser/Game/MapEditor/ScreenSpace";
    import { editAreaDraftStore, type AreaDraft } from "../../../Stores/EditModeStore";
    import { areaLook } from "./areaLook";

    const TILE = 32;
    const MIN_SIZE = TILE;

    let box = { left: 0, top: 0, width: 0, height: 0 };
    let frame: number | undefined;
    let visible = false;
    let shiftHeld = false;

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
        frame = requestAnimationFrame(tick);
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);
    });
    onDestroy(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
    });

    // The eight dots: the corners and the middles of the edges. A dot resizes the edges it is on.
    type Handle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
    const HANDLES: Handle[] = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];
    let dragging: { handle: Handle | "move"; startX: number; startY: number; start: AreaDraft } | undefined;

    function down(handle: Handle | "move", event: PointerEvent) {
        const draft = get(editAreaDraftStore);
        if (!draft) return;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        dragging = { handle, startX: event.clientX, startY: event.clientY, start: { ...draft } };
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
        if (dragging.handle === "move") {
            next = { ...s, x: snap(s.x + dx), y: snap(s.y + dy) };
        } else {
            const h = dragging.handle;
            let left = s.x;
            let top = s.y;
            let right = s.x + s.width;
            let bottom = s.y + s.height;
            if (h.includes("w")) left = Math.min(snap(s.x + dx), right - MIN_SIZE);
            if (h.includes("e")) right = Math.max(snap(right + dx), left + MIN_SIZE);
            if (h.includes("n")) top = Math.min(snap(s.y + dy), bottom - MIN_SIZE);
            if (h.includes("s")) bottom = Math.max(snap(bottom + dy), top + MIN_SIZE);
            next = { x: left, y: top, width: right - left, height: bottom - top };
        }
        editAreaDraftStore.set(next);
        toScreen(next);
    }

    function up() {
        dragging = undefined;
    }

    $: draft = $editAreaDraftStore;
    // Where each dot sits on the box, as fractions of its width and height.
    const AT: Record<Handle, [number, number]> = {
        nw: [0, 0],
        n: [0.5, 0],
        ne: [1, 0],
        w: [0, 0.5],
        e: [1, 0.5],
        sw: [0, 1],
        s: [0.5, 1],
        se: [1, 1],
    };
    // The top edge's dot moves right of the label when the label reaches the middle, as on a picked area.
    let label: HTMLElement | undefined;
    $: labelRight = label ? 22 + label.offsetWidth + 18 : 0;
    $: topDotLeft =
        labelRight > box.width / 2 ? Math.max(box.width / 2, Math.min(labelRight, box.width - 30)) : box.width / 2;
    function dotStyle(handle: Handle, topLeft: number): string {
        const left = handle === "n" ? `${topLeft}px` : `${AT[handle][0] * 100}%`;
        return `left: ${left}; top: ${AT[handle][1] * 100}%;`;
    }
</script>

{#if draft && visible}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="em-draft pointer-events-auto"
        style="{areaLook()} left: {box.left}px; top: {box.top}px; width: {box.width}px; height: {box.height}px;"
        data-testid="area-draft"
        on:pointerdown={(e) => down("move", e)}
        on:pointermove={moveDrag}
        on:pointerup={up}
        on:pointercancel={up}
    >
        <span class="em-label u-surface" bind:this={label}>{$LL.mapEditor.edit.areas.newArea()}</span>
        {#each HANDLES as handle (handle)}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <i
                class="em-dot em-{handle}"
                class:em-dot-big={dragging?.handle === handle}
                style={dotStyle(handle, topDotLeft)}
                on:pointerdown={(e) => down(handle, e)}
                on:pointermove={moveDrag}
                on:pointerup={up}
                on:pointercancel={up}
            />
        {/each}
    </div>
{/if}

<style>
    /* The look of a picked area in AreaFrames.svelte: its colour fills it, and the dots have its colour round them. */
    .em-draft {
        position: absolute;
        border-radius: 14px;
        background: var(--af-fill);
        box-shadow: 0 0 0 3px var(--af-c), 0 0 0 8px var(--af-halo);
        cursor: move;
        touch-action: none;
        z-index: 3;
    }
    .em-label {
        position: absolute;
        left: 22px;
        top: -14px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        white-space: nowrap;
        line-height: 1.2;
        color: var(--af-t);
        pointer-events: none;
    }
    .em-dot {
        position: absolute;
        width: 22px;
        height: 22px;
        margin: -11px 0 0 -11px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0 0 3px var(--af-c), 0 2px 6px rgba(0, 0, 0, 0.45);
        touch-action: none;
    }
    /* A finger needs more than the dot to land on: the dot catches the pointer around it too. */
    .em-dot::after {
        content: "";
        position: absolute;
        inset: -11px;
    }
    .em-dot-big {
        width: 28px;
        height: 28px;
        margin: -14px 0 0 -14px;
        box-shadow: 0 0 0 4px var(--af-c), 0 0 0 12px var(--af-halo);
    }
    .em-nw,
    .em-se {
        cursor: nwse-resize;
    }
    .em-ne,
    .em-sw {
        cursor: nesw-resize;
    }
    .em-n,
    .em-s {
        cursor: ns-resize;
    }
    .em-w,
    .em-e {
        cursor: ew-resize;
    }
</style>
