<script lang="ts">
    // The areas on the map while the Areas tool is open, drawn like the "You are here" box of Look around: a rounded
    // frame in the area's own colour with its name on a label at the top left. The picked area fills with its colour
    // and gets eight round dots; while it moves or resizes, a faint dashed line shows where it was. A new area being
    // drawn has the same frame. Phaser still catches the pointer at the same places (AreaPreview.useMapFrame); this
    // only draws, and lets every tap through to the map. The camera does not report its moves, so this reads it
    // every frame.
    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { screenSpace } from "../../../Phaser/Game/MapEditor/ScreenSpace";
    import { areaColour } from "../../../Phaser/Components/MapEditor/AreaPreview";
    import type { AreaEditorTool } from "../../../Phaser/Game/MapEditor/Tools/AreaEditorTool";
    import { editAreaGhostStore, editAreaSketchStore } from "../../../Stores/EditModeStore";
    import { areaLook } from "./areaLook";

    interface Frame {
        id: string;
        name: string;
        look: string;
        x: number;
        y: number;
        width: number;
        height: number;
        picked: boolean;
    }
    interface Dot {
        x: number;
        y: number;
        dragged: boolean;
    }

    // The label sits 22px in from the frame's left; the top dot goes this far right of the label when it would
    // cover it, and stays this far in from the right corner.
    const LABEL_LEFT = 22;
    const DOT_GAP = 18;
    const DOT_CORNER_GAP = 30;

    let frames: Frame[] = [];
    let dots: Dot[] = [];
    let ghost: { look: string; x: number; y: number; width: number; height: number } | undefined;
    let sketch: { x: number; y: number; width: number; height: number } | undefined;
    let pickedLabel: HTMLElement | undefined;
    let dotLook = "";
    let frame: number | undefined;

    function tool(): AreaEditorTool | undefined {
        return gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager()?.currentlyActiveTool as
            | AreaEditorTool
            | undefined;
    }

    function update() {
        frame = requestAnimationFrame(update);
        const scene = gameManager.tryGetCurrentGameScene();
        const previews = tool()?.getAreaPreviews?.();
        if (!scene || !previews) {
            frames = [];
            dots = [];
            ghost = undefined;
            sketch = undefined;
            return;
        }
        const space = screenSpace(scene);
        const unnamed = get(LL).mapEditor.edit.areas.unnamed();
        const next: Frame[] = [];
        let nextDots: Dot[] = [];
        let pickedLook = "";
        for (const preview of previews) {
            if (!preview.visible) continue;
            const bounds = preview.getBounds();
            const r = space.rect(bounds.left, bounds.top, bounds.width, bounds.height);
            const data = preview.getAreaData();
            const picked = preview.isSelected();
            const look = areaLook(areaColour(data.properties));
            next.push({
                id: data.id,
                name: data.name.trim() || unnamed,
                look,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                picked,
            });
            if (picked) {
                pickedLook = look;
                nextDots = preview.getHandles().map((handle) => {
                    const { x, y } = space.toScreen(handle.x, handle.y);
                    return { x, y, dragged: handle.dragged };
                });
                // The top edge's dot moves right of the name label when the label reaches the middle.
                const labelRight = LABEL_LEFT + (pickedLabel?.offsetWidth ?? 0);
                const wanted = labelRight + DOT_GAP;
                const offset =
                    pickedLabel && wanted > r.width / 2
                        ? Math.max(r.width / 2, Math.min(wanted, r.width - DOT_CORNER_GAP)) / space.scale
                        : undefined;
                preview.setTopHandleOffset(offset);
            }
        }
        // The picked area is drawn last, over the others.
        next.sort((a, b) => Number(a.picked) - Number(b.picked));
        frames = next;
        dots = nextDots;
        dotLook = pickedLook;

        const was = get(editAreaGhostStore);
        ghost =
            was && pickedLook ? { look: pickedLook, ...space.rect(was.x, was.y, was.width, was.height) } : undefined;
        const drawing = get(editAreaSketchStore);
        sketch = drawing ? space.rect(drawing.x, drawing.y, drawing.width, drawing.height) : undefined;
    }

    onMount(() => {
        frame = requestAnimationFrame(update);
    });
    onDestroy(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
    });
</script>

<div class="af-root" data-testid="area-frames">
    {#if ghost}
        <i
            class="af-was"
            style="{ghost.look} left: {ghost.x}px; top: {ghost.y}px; width: {ghost.width}px; height: {ghost.height}px;"
        />
    {/if}
    {#each frames as area (area.id)}
        <div
            class="af-frame"
            class:af-pick={area.picked}
            style="{area.look} left: {area.x}px; top: {area.y}px; width: {area.width}px; height: {area.height}px;"
            data-testid="area-frame"
        >
            {#if area.picked}
                <span class="af-label u-surface" bind:this={pickedLabel}>{area.name}</span>
            {:else}
                <span class="af-label u-surface">{area.name}</span>
            {/if}
        </div>
    {/each}
    {#if sketch}
        <div
            class="af-frame"
            style="{areaLook()} left: {sketch.x}px; top: {sketch.y}px; width: {sketch.width}px; height: {sketch.height}px;"
            data-testid="area-sketch"
        >
            <span class="af-label u-surface">{$LL.mapEditor.edit.areas.newArea()}</span>
        </div>
    {/if}
    {#each dots as dot, index (index)}
        <i class="af-dot" class:af-dot-big={dot.dragged} style="{dotLook} left: {dot.x}px; top: {dot.y}px;" />
    {/each}
</div>

<style>
    .af-root {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        /* Under the panel, the bars and the actions: the map's own layer. */
        z-index: 0;
    }
    .af-frame {
        position: absolute;
        border-radius: 14px;
        box-shadow: 0 0 0 2px var(--af-c), 0 0 0 6px var(--af-halo);
    }
    .af-pick {
        background: var(--af-fill);
        box-shadow: 0 0 0 3px var(--af-c), 0 0 0 8px var(--af-halo);
    }
    .af-was {
        position: absolute;
        border-radius: 14px;
        outline: 2px dashed var(--af-c);
        opacity: 0.5;
    }
    .af-label {
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
    }
    .af-dot {
        position: absolute;
        width: 22px;
        height: 22px;
        margin: -11px 0 0 -11px;
        border-radius: 999px;
        background: #fff;
        box-shadow: 0 0 0 3px var(--af-c), 0 2px 6px rgba(0, 0, 0, 0.45);
    }
    .af-dot-big {
        width: 28px;
        height: 28px;
        margin: -14px 0 0 -14px;
        box-shadow: 0 0 0 4px var(--af-c), 0 0 0 12px var(--af-halo);
    }
</style>
