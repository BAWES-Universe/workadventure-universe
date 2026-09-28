<script lang="ts">
    import { onDestroy } from "svelte";
    import { get } from "svelte/store";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import type { Box, EdgeArrow } from "../QuestGeometry";
    import { edgeArrowPlacement, worldToSectionPoint } from "../QuestGeometry";
    import type { QuestPath } from "../QuestModel";
    import { questStateStore, questWorldStore } from "../QuestStore";
    import { sceneQuestTarget, targetPosition } from "../QuestTargets";

    /** Show me's quest, while its marker is up. */
    export let path: QuestPath | null;
    /** The layer the arrow is drawn in (covers the map section). */
    export let layer: HTMLElement | undefined;
    /** The dock's surface: the arrow stays out of it. */
    export let avoid: HTMLElement | undefined;

    const MARGIN = 20;
    /** Half the arrow chip (2.25rem). */
    const ARROW_HALF = 18;
    let arrow: EdgeArrow = { visible: false, x: 0, y: 0, angle: 0 };
    let frame: number | undefined;

    $: if (path) start();
    else stop();

    function start() {
        if (frame === undefined) frame = requestAnimationFrame(update);
    }

    function stop() {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        arrow = { ...arrow, visible: false };
    }

    /** The part of the map the person can actually see: minus the camera strip at the top and the dock. */
    function mapView(layerRect: DOMRect): Box {
        let top = MARGIN;
        let bottom = layerRect.height - MARGIN;
        const cameras = document.querySelector("[data-camera-block]")?.getBoundingClientRect();
        if (cameras && cameras.height > 0 && cameras.height < layerRect.height / 2) {
            top = Math.max(top, cameras.bottom - layerRect.top + MARGIN / 2);
        }
        const dock = avoid?.getBoundingClientRect();
        if (dock && dock.height > 0) bottom = Math.min(bottom, dock.top - layerRect.top - MARGIN / 2);
        return { left: MARGIN, top, width: layerRect.width - 2 * MARGIN, height: Math.max(0, bottom - top) };
    }

    /** The bottom-right column (zoom tools, Express), relative to the layer: drawn above the quest layer. */
    function rightColumn(layerRect: DOMRect): Box | undefined {
        let box: { left: number; top: number; right: number; bottom: number } | undefined;
        for (const id of ["actions-explorer", "express"]) {
            const rect = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) continue;
            box = box
                ? {
                      left: Math.min(box.left, rect.left),
                      top: Math.min(box.top, rect.top),
                      right: Math.max(box.right, rect.right),
                      bottom: Math.max(box.bottom, rect.bottom),
                  }
                : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        }
        if (!box) return undefined;
        return {
            left: box.left - layerRect.left,
            top: box.top - layerRect.top,
            width: box.right - box.left,
            height: box.bottom - box.top,
        };
    }

    function under(placed: EdgeArrow, box: Box): boolean {
        const pad = ARROW_HALF;
        return (
            placed.x >= box.left - pad &&
            placed.x <= box.left + box.width + pad &&
            placed.y >= box.top - pad &&
            placed.y <= box.top + box.height + pad
        );
    }

    // Per frame from the camera's view of the world: the arrow follows panning and zoom, and never moves the camera.
    function update() {
        frame = requestAnimationFrame(update);
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene || !layer || !path) {
            arrow = { ...arrow, visible: false };
            return;
        }
        try {
            const target = sceneQuestTarget(scene, path, get(questStateStore), get(questWorldStore));
            const position = target ? targetPosition(scene, target) : undefined;
            if (!position) {
                arrow = { ...arrow, visible: false };
                return;
            }
            const camera = scene.cameras.main;
            const layerRect = layer.getBoundingClientRect();
            const point = worldToSectionPoint(
                position,
                { worldViewX: camera.worldView.x, worldViewY: camera.worldView.y, zoom: camera.zoom },
                scene.game.canvas.getBoundingClientRect(),
                { width: scene.scale.width, height: scene.scale.height },
                layerRect
            );
            const view = mapView(layerRect);
            let placed = edgeArrowPlacement(point, view);
            // Under the zoom tools or Express it could not be seen: keep it left of that column.
            const column = rightColumn(layerRect);
            if (placed.visible && column && under(placed, column)) {
                const width = Math.max(0, column.left - MARGIN / 2 - ARROW_HALF - view.left);
                placed = edgeArrowPlacement(point, { ...view, width });
            }
            arrow = placed;
        } catch {
            arrow = { ...arrow, visible: false };
        }
    }

    onDestroy(stop);
</script>

<!-- Decorative: the Show me description in the card says where the target is. Geometry only, never mirrored. -->
<div
    class="quest-edge-arrow"
    class:visible={arrow.visible}
    style="transform: translate({arrow.x}px, {arrow.y}px) translate(-50%, -50%) rotate({arrow.angle}rad);"
    aria-hidden="true"
    data-testid="quest-edge-arrow"
>
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" focusable="false">
        <path d="M9 7l10 7-10 7" stroke="#c4b5fd" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
</div>

<style>
    .quest-edge-arrow {
        position: absolute;
        top: 0;
        left: 0;
        width: 2.25rem;
        height: 2.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(27, 42, 65, 0.9);
        box-shadow: 0 0 12px -2px rgba(167, 139, 250, 0.45);
        pointer-events: none;
        opacity: 0;
        transition: opacity 300ms ease;
    }
    .quest-edge-arrow.visible {
        opacity: 1;
    }
    @media (prefers-reduced-motion: reduce) {
        .quest-edge-arrow {
            transition: none;
        }
    }
</style>
