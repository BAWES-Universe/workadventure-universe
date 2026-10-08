<script lang="ts">
    // What is drawn over the map while looking around: a frame and a name tag on every area and a tag on every
    // object that does something (the same look as the Areas tool in the editor), the "You are here" tag over you,
    // and the "You" tab on the edge when you are off-screen.
    // The game camera does not report its moves while exploring, so this reads it every frame.
    import { onDestroy, onMount } from "svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import {
        mapExplorationAreasStore,
        mapExplorationEntitiesStore,
        mapExplorationObjectSelectedStore,
    } from "../../Stores/MapEditorStore";
    import { areaLook } from "../MapEditor/EditMode/areaLook";
    import { areaColour } from "../../Phaser/Components/MapEditor/AreaPreview";
    import { lookAroundBottomCoverStore } from "../../Stores/LookAroundStore";
    import { currentPlayerWokaStore } from "../../Stores/CurrentPlayerWokaStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { ExplorerTool } from "../../Phaser/Game/MapEditor/Tools/ExplorerTool";
    import { getPlaceMainProperty, getPlaceName, getPlaceRect, type Place } from "./placeInfo";
    import { IconChevronLeft, IconChevronRight, IconChevronUp, IconChevronDown } from "@wa-icons";

    interface AreaFrame {
        id: string;
        area: Place;
        name: string;
        look: string;
        pointed: boolean;
        people: number;
        x: number;
        y: number;
        width: number;
        height: number;
    }

    interface ObjectTag {
        id: string;
        object: Place;
        name: string;
        x: number;
        y: number;
    }

    /** People in every searchable area, by area id, recounted a few times a second (zeros included). */
    export let peopleByArea: Map<string, number> = new Map();

    let overlay: HTMLElement;
    let pin = { x: 0, y: 0 };
    // The pin has no place until the first frame has measured the map: showing it before would flash it in the corner.
    let pinPlaced = false;
    let youTab: { side: "left" | "right" | "top" | "bottom"; x: number; y: number } | undefined;
    let frames: AreaFrame[] = [];
    let tags: ObjectTag[] = [];
    // How much of the bottom of this layer the sheet covers (0 when it is not up).
    let coveredBottom = 0;
    let frame: number | undefined;
    let lastPeopleCount = 0;

    const EDGE_MARGIN = 24;

    function countPeopleIn(rect: { x: number; y: number; width: number; height: number }): number {
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene) return 0;
        const inside = (p: { x: number; y: number }) =>
            p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
        let count = inside(scene.CurrentPlayer) ? 1 : 0;
        for (const player of scene.MapPlayersByKey.values()) {
            if (inside(player)) count++;
        }
        return count;
    }

    function update(now: number) {
        frame = requestAnimationFrame(update);
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene || !overlay) return;
        const camera = scene.cameras.main;
        const view = camera.worldView;
        if (view.width === 0 || view.height === 0) return;
        const bounds = overlay.getBoundingClientRect();
        const canvas = scene.game.canvas.getBoundingClientRect();
        const scale = canvas.width / view.width;
        const toScreen = (wx: number, wy: number) => ({
            x: (wx - view.x) * scale + canvas.left - bounds.left,
            y: (wy - view.y) * scale + canvas.top - bounds.top,
        });

        const player = scene.CurrentPlayer;
        const centre = toScreen(player.x, player.y);
        pin = toScreen(player.x, player.y - 40);
        pinPlaced = true;
        // On a phone the sheet covers the bottom of the map: "off-screen" is measured above it.
        const cover = $lookAroundBottomCoverStore;
        const visibleHeight =
            cover > 0 ? Math.min(bounds.height, window.innerHeight - cover - bounds.top) : bounds.height;
        coveredBottom = bounds.height - visibleHeight;

        // The "You" tab: on the edge nearest to you, once you are off-screen.
        if (
            centre.x < -EDGE_MARGIN ||
            centre.x > bounds.width + EDGE_MARGIN ||
            centre.y < -EDGE_MARGIN ||
            centre.y > visibleHeight + EDGE_MARGIN
        ) {
            const clampedX = Math.min(Math.max(centre.x, 80), bounds.width - 80);
            const clampedY = Math.min(Math.max(centre.y, 120), visibleHeight - 160);
            // Off-screen in two directions at once (far above, a little to the left): the tab goes on the edge you
            // are furthest beyond, which is the direction the tab's arrow should point.
            const beyond = {
                left: -centre.x,
                right: centre.x - bounds.width,
                top: -centre.y,
                bottom: centre.y - visibleHeight,
            };
            const side = (Object.keys(beyond) as (keyof typeof beyond)[]).reduce((best, each) =>
                beyond[each] > beyond[best] ? each : best
            );
            youTab = side === "left" || side === "right" ? { side, x: 0, y: clampedY } : { side, x: clampedX, y: 0 };
        } else {
            youTab = undefined;
        }

        // Frames and tags on the named places, counted a few times a second, positioned every frame.
        const areas = $mapExplorationAreasStore;
        if (areas) {
            const recount = now - lastPeopleCount > 400;
            if (recount) lastPeopleCount = now;
            const counts = recount ? new Map<string, number>() : undefined;
            const nextFrames: AreaFrame[] = [];
            for (const [id, area] of areas) {
                const data = area.getAreaData();
                // Between recounts, the last count of every place, empty ones included.
                const people = recount ? countPeopleIn(data) : peopleByArea.get(id) ?? countPeopleIn(data);
                counts?.set(id, people);
                const from = toScreen(data.x, data.y);
                const to = toScreen(data.x + data.width, data.y + data.height);
                nextFrames.push({
                    id,
                    area,
                    // Its name in the list (an unnamed one by what it does, or "Area").
                    name: getPlaceName(area, $LL),
                    look: areaLook(areaColour(data.properties)),
                    pointed: area.pointedAt,
                    people,
                    x: from.x,
                    y: from.y,
                    width: to.x - from.x,
                    height: to.y - from.y,
                });
            }
            frames = nextFrames;
            if (counts) peopleByArea = counts;
        }
        const nextTags: ObjectTag[] = [];
        for (const [id, entity] of $mapExplorationEntitiesStore) {
            if (!getPlaceMainProperty(entity)) continue;
            const rect = getPlaceRect(entity);
            const top = toScreen(rect.x + rect.width / 2, rect.y);
            nextTags.push({ id, object: entity, name: getPlaceName(entity, $LL), x: top.x, y: top.y });
        }
        tags = nextTags;
    }

    function goHome() {
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene) return;
        // With the sheet up, "you" go in the middle of the part of the map that is not under it.
        const view = scene.cameras.main.worldView;
        const scale = scene.game.canvas.getBoundingClientRect().width / view.width;
        const lift = scale > 0 ? coveredBottom / 2 / scale : 0;
        scene.getCameraManager().centerCameraOn({ x: scene.CurrentPlayer.x, y: scene.CurrentPlayer.y + lift });
        (
            scene.getMapEditorModeManager().currentlyActiveTool as ExplorerTool | undefined
        )?.defineZoomToCenterCameraPosition?.();
    }

    function selectArea(area: Place) {
        mapExplorationObjectSelectedStore.set(area);
    }

    onMount(() => {
        frame = requestAnimationFrame(update);
    });
    onDestroy(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
    });
</script>

<div class="absolute inset-0 overflow-hidden pointer-events-none" class:phone={$mobileLayoutStore} bind:this={overlay}>
    {#each frames as f (f.id)}
        <div
            class="la-frame"
            class:la-pointed={f.pointed}
            style="{f.look} left:{f.x}px;top:{f.y}px;width:{f.width}px;height:{f.height}px"
            data-testid="look-around-area-frame"
        >
            <button type="button" class="la-tag u-surface pointer-events-auto" on:click={() => selectArea(f.area)}
                >{f.name}{#if f.people > 0}<em
                        >· {f.people === 1
                            ? $LL.mapEditor.lookAround.onePerson()
                            : $LL.mapEditor.lookAround.people({ count: f.people })}</em
                    >{/if}</button
            >
        </div>
    {/each}
    {#each tags as t (t.id)}
        <button
            type="button"
            class="la-tag la-tag-obj u-surface pointer-events-auto"
            style="{areaLook()} left:{t.x}px;top:{t.y}px"
            on:click={() => selectArea(t.object)}>{t.name}</button
        >
    {/each}

    {#if pinPlaced}
        <span class="you-pin u-surface" style="transform:translate({pin.x}px,{pin.y}px) translate(-50%,-100%)"
            ><b>{$LL.mapEditor.lookAround.youAreHere()}</b></span
        >
    {/if}

    {#if youTab}
        <button
            type="button"
            class="you-tab you-tab-{youTab.side} u-surface pointer-events-auto"
            style={youTab.side === "left" || youTab.side === "right"
                ? `top:${youTab.y}px`
                : youTab.side === "bottom" && $lookAroundBottomCoverStore > 0
                ? `left:${youTab.x}px;bottom:${coveredBottom + 12}px`
                : `left:${youTab.x}px`}
            aria-label={$LL.mapEditor.lookAround.backToMe()}
            data-testid="look-around-you-tab"
            on:click={goHome}
        >
            {#if youTab.side === "left"}<IconChevronLeft font-size="18" />{/if}
            {#if youTab.side === "top"}<IconChevronUp font-size="18" />{/if}
            {#if $currentPlayerWokaStore}
                <img class="you-tab-woka" src={$currentPlayerWokaStore} alt="" draggable="false" />
            {/if}
            <b>{$LL.mapEditor.lookAround.you()}</b>
            {#if youTab.side === "right"}<IconChevronRight font-size="18" />{/if}
            {#if youTab.side === "bottom"}<IconChevronDown font-size="18" />{/if}
        </button>
    {/if}
</div>

<style>
    .la-frame {
        position: absolute;
        border-radius: 14px;
        box-shadow: 0 0 0 2px var(--af-c), 0 0 0 6px var(--af-halo);
    }
    /* Pointed at with the mouse: its colour fills it, like a picked area in the Areas tool. */
    .la-pointed {
        background: var(--af-fill);
    }
    .la-tag {
        position: absolute;
        left: 22px;
        top: -14px;
        padding: 4px 10px;
        border: 0;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        white-space: nowrap;
        line-height: 1.2;
        color: var(--af-t);
        cursor: pointer;
    }
    .la-tag em {
        font-style: normal;
        margin-left: 6px;
        opacity: 0.8;
    }
    .la-tag-obj {
        transform: translate(-50%, -100%) translateY(-6px);
        top: 0;
    }
    .you-pin {
        position: absolute;
        left: 0;
        top: 0;
        padding: 4px 10px;
        border-radius: 999px;
        box-shadow: 0 0 0 2px rgba(196, 181, 253, 0.95), 0 0 0 6px rgba(167, 139, 250, 0.22);
        white-space: nowrap;
    }
    .you-pin b {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        background-image: linear-gradient(90deg, #c4b5fd, #f5c451);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
    }
    .you-tab {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 6px;
        height: 52px;
        padding: 0 10px;
        border: 0;
        color: #fff;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .you-tab-right {
        right: 0;
        border-radius: 26px 0 0 26px;
        transform: translateY(-50%);
    }
    .you-tab-left {
        left: 0;
        border-radius: 0 26px 26px 0;
        transform: translateY(-50%);
    }
    /* The top tab hangs from the top edge; on a phone the bottom one sits above the bar (above the sheet while it is up). */
    .you-tab-top {
        top: calc(var(--tiles-clear, 0px) + 12px);
        border-radius: 0 0 26px 26px;
        transform: translateX(-50%);
    }
    .phone .you-tab-top {
        top: calc(var(--tiles-clear, 0px) + 12px + env(safe-area-inset-top, 0px));
    }
    .you-tab-bottom {
        bottom: 0;
        border-radius: 26px 26px 0 0;
        transform: translateX(-50%);
    }
    .phone .you-tab-bottom {
        bottom: calc(var(--bar-clear, 0px) + 72px + env(safe-area-inset-bottom, 0px));
    }
    .you-tab-woka {
        width: 30px;
        height: 30px;
        object-fit: contain;
        image-rendering: pixelated;
    }
</style>
