<script lang="ts">
    import { onDestroy } from "svelte";
    import { get } from "svelte/store";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { PLAYER_NAME_Y } from "../../Phaser/Entity/CharacterLayout";
    import type { Box, Point, TargetMark } from "../QuestGeometry";
    import { edgeArrowPlacement, targetMark, worldToSectionPoint } from "../QuestGeometry";
    import type { QuestPath } from "../QuestModel";
    import { questStateStore, questWorldStore } from "../QuestStore";
    import { FEET_OFFSET_Y, sceneQuestTarget, targetPosition } from "../QuestTargets";

    /** The followed quest whose target is marked: the edge arrow off screen, a down arrow above it on screen. Amber, as
     the floor ring's edge: the world marks alone wear it. */
    export let path: QuestPath | null;
    /** The quest giver bot, marked with a "!" above its name while its offer is on screen. */
    export let giverUserId: number | undefined = undefined;
    /** The layer the marks are drawn in (covers the map section). */
    export let layer: HTMLElement | undefined;
    /** The dock's surface: the edge arrow stays out of it. */
    export let avoid: HTMLElement | undefined;
    /** Something covers the game (a menu, the map editor, the person card, the phone chat): no marks meanwhile. */
    export let suppressed = false;

    const MARGIN = 20;
    /** Half the arrow chip (2.25rem). */
    const ARROW_HALF = 18;
    /** The down arrow and the "!" are about this tall and wide (px): they are kept inside the visible map. */
    const MARK_SIZE = 34;
    /** A character's name label sits this far above its position; marks hover a little above it. */
    const NAME_LABEL_Y = -PLAYER_NAME_Y;
    const ABOVE_NAME = 14;
    /** The page is measured (layout reads) this often; the camera is read every frame. */
    const MEASURE_MS = 250;

    let mark: TargetMark | undefined;
    let giver: Point | undefined;
    let frame: number | undefined;
    let measuredAt = 0;
    let measured: { layer: DOMRect; canvas: DOMRect; view: Box; column: Box | undefined } | undefined;

    $: active = !suppressed && (path !== null || giverUserId !== undefined);
    $: if (active) start();
    else stop();

    function start() {
        if (frame === undefined) frame = requestAnimationFrame(update);
    }

    function stop() {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        mark = undefined;
        giver = undefined;
        measured = undefined;
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

    function under(placed: { x: number; y: number }, box: Box): boolean {
        const pad = ARROW_HALF;
        return (
            placed.x >= box.left - pad &&
            placed.x <= box.left + box.width + pad &&
            placed.y >= box.top - pad &&
            placed.y <= box.top + box.height + pad
        );
    }

    /** Whether a mark whose bottom centre is at `point` fits inside the visible map. */
    function markInside(point: Point, view: Box): boolean {
        return (
            point.x - MARK_SIZE / 2 >= view.left &&
            point.x + MARK_SIZE / 2 <= view.left + view.width &&
            point.y - MARK_SIZE >= view.top &&
            point.y <= view.top + view.height
        );
    }

    function samePoint(a: Point | undefined, b: Point | undefined): boolean {
        if (!a || !b) return a === b;
        return a.x === b.x && a.y === b.y;
    }

    function sameMark(a: TargetMark | undefined, b: TargetMark | undefined): boolean {
        if (!a || !b) return a === b;
        if (a.kind !== b.kind || a.x !== b.x || a.y !== b.y) return false;
        return a.kind === "edge" && b.kind === "edge" ? a.angle === b.angle : true;
    }

    /** To half a pixel: the marks only redraw when they have moved that much. */
    function rounded(point: Point): Point {
        return { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 };
    }

    // Per frame from the camera's view of the world: the marks follow panning, zoom and the people they sit on, and
    // never move the camera.
    function update() {
        frame = requestAnimationFrame(update);
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene || !layer) {
            mark = undefined;
            giver = undefined;
            return;
        }
        try {
            const now = performance.now();
            if (!measured || now - measuredAt >= MEASURE_MS) {
                const layerRect = layer.getBoundingClientRect();
                measured = {
                    layer: layerRect,
                    canvas: scene.game.canvas.getBoundingClientRect(),
                    view: mapView(layerRect),
                    column: rightColumn(layerRect),
                };
                measuredAt = now;
            }
            const { layer: layerRect, canvas, view, column } = measured;
            const camera = scene.cameras.main;
            const toScreen = (world: Point) =>
                worldToSectionPoint(
                    world,
                    { worldViewX: camera.worldView.x, worldViewY: camera.worldView.y, zoom: camera.zoom },
                    canvas,
                    { width: scene.scale.width, height: scene.scale.height },
                    layerRect
                );

            let nextMark: TargetMark | undefined;
            if (path) {
                const target = sceneQuestTarget(scene, path, get(questStateStore), get(questWorldStore));
                const feet = target ? targetPosition(scene, target) : undefined;
                if (target && feet) {
                    const above =
                        target.kind === "player"
                            ? { x: feet.x, y: feet.y - FEET_OFFSET_Y - NAME_LABEL_Y - ABOVE_NAME }
                            : { x: feet.x, y: feet.y - target.radius / 2 - ABOVE_NAME };
                    let placed = targetMark(toScreen(feet), toScreen(above), view, MARK_SIZE);
                    // Under the zoom tools or Express it could not be seen: keep it left of that column.
                    if (placed.kind === "edge" && column && under(placed, column)) {
                        const width = Math.max(0, column.left - MARGIN / 2 - ARROW_HALF - view.left);
                        const edge = edgeArrowPlacement(toScreen(feet), { ...view, width });
                        placed = { kind: "edge", x: edge.x, y: edge.y, angle: edge.angle };
                    }
                    nextMark = { ...placed, ...rounded(placed) };
                }
            }
            // The camera is read every frame; the page is only touched when a mark has moved.
            if (!sameMark(mark, nextMark)) mark = nextMark;

            let nextGiver: Point | undefined;
            if (giverUserId !== undefined) {
                const person = scene.MapPlayersByKey.get(giverUserId);
                if (person) {
                    // Only over the visible map: never over the cameras or the dock.
                    const point = rounded(toScreen({ x: person.x, y: person.y - NAME_LABEL_Y - ABOVE_NAME }));
                    nextGiver = markInside(point, view) ? point : undefined;
                }
            }
            if (!samePoint(giver, nextGiver)) giver = nextGiver;
        } catch {
            mark = undefined;
            giver = undefined;
        }
    }

    onDestroy(stop);
</script>

<!-- Decorative, all of it: the card's description says where the target is. Geometry only, never mirrored. -->
<div
    class="quest-mark quest-edge-arrow"
    class:visible={mark?.kind === "edge"}
    style="transform: translate({mark?.kind === 'edge' ? mark.x : 0}px, {mark?.kind === 'edge'
        ? mark.y
        : 0}px) translate(-50%, -50%) rotate({mark?.kind === 'edge' ? mark.angle : 0}rad);"
    aria-hidden="true"
    data-testid="quest-edge-arrow"
>
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" focusable="false">
        <path
            d="M9 7l10 7-10 7"
            stroke="#1b2a41"
            stroke-width="6"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-opacity=".7"
        />
        <path d="M9 7l10 7-10 7" stroke="#f5a623" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
</div>

<!-- An amber arrow hovering above the target while it is on screen, pointing down at it. -->
<div
    class="quest-mark"
    class:visible={mark?.kind === "above"}
    style="transform: translate({mark?.kind === 'above' ? mark.x : 0}px, {mark?.kind === 'above'
        ? mark.y
        : 0}px) translate(-50%, -100%);"
    aria-hidden="true"
    data-testid="quest-target-arrow"
>
    <div class="quest-bob">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" focusable="false">
            <path
                d="M7 9l7 8 7-8"
                stroke="#1b2a41"
                stroke-width="7"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-opacity=".7"
            />
            <path d="M7 9l7 8 7-8" stroke="#f5a623" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    </div>
</div>

<!-- The quest giver: an amber "!" above its name while its offer is on screen. -->
<div
    class="quest-mark"
    class:visible={giver !== undefined}
    style="transform: translate({giver?.x ?? 0}px, {giver?.y ?? 0}px) translate(-50%, -100%);"
    aria-hidden="true"
    data-testid="quest-giver-mark"
>
    <div class="quest-bob quest-bang">!</div>
</div>

<style>
    .quest-mark {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
        opacity: 0;
        transition: opacity 300ms ease;
        will-change: transform;
    }
    .quest-mark.visible {
        opacity: 1;
    }
    .quest-edge-arrow {
        width: 2.25rem;
        height: 2.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(27, 42, 65, 0.9);
        box-shadow: 0 0 12px -2px rgba(245, 166, 35, 0.45);
    }
    .quest-bob {
        display: flex;
        align-items: center;
        justify-content: center;
        animation: quest-bob 900ms ease-in-out infinite alternate;
        filter: drop-shadow(0 0 6px rgba(245, 166, 35, 0.55));
    }
    .quest-bang {
        font-family: "Press Start 2P", ui-monospace, monospace;
        font-size: 1.375rem;
        line-height: 1;
        font-weight: 900;
        color: #f5a623;
        text-shadow: 2px 0 #1b2a41, -2px 0 #1b2a41, 0 2px #1b2a41, 0 -2px #1b2a41, 1px 1px #1b2a41, -1px -1px #1b2a41,
            1px -1px #1b2a41, -1px 1px #1b2a41;
        padding: 0 0.25rem 0.25rem;
    }
    @keyframes quest-bob {
        from {
            transform: translateY(0);
        }
        to {
            transform: translateY(-6px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .quest-mark {
            transition: none;
        }
        .quest-bob {
            animation: none;
        }
    }
</style>
