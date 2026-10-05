<script lang="ts">
    // What is drawn over the map while looking around: the glowing box of what you normally see, with you in it,
    // the "You" tab on the edge when you are off-screen, and a small label on every place that has people in it.
    // The game camera does not report its moves while exploring, so this reads it every frame.
    import { onDestroy, onMount } from "svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { waScaleManager } from "../../Phaser/Services/WaScaleManager";
    import { mapExplorationAreasStore, mapExplorationObjectSelectedStore } from "../../Stores/MapEditorStore";
    import { lookAroundNormalZoomStore } from "../../Stores/LookAroundStore";
    import { currentPlayerWokaStore } from "../../Stores/CurrentPlayerWokaStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import type { AreaPreview } from "../../Phaser/Components/MapEditor/AreaPreview";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { ExplorerTool } from "../../Phaser/Game/MapEditor/Tools/ExplorerTool";
    import { IconChevronLeft, IconChevronRight, IconChevronUp, IconChevronDown } from "@wa-icons";

    interface AreaLabel {
        id: string;
        area: AreaPreview;
        name: string;
        people: number;
        x: number;
        y: number;
    }

    /** People in every searchable area, by area id, recounted a few times a second (zeros included). */
    export let peopleByArea: Map<string, number> = new Map();

    let overlay: HTMLElement;
    let box = { x: 0, y: 0, width: 0, height: 0, visible: false };
    let youTab: { side: "left" | "right" | "top" | "bottom"; x: number; y: number } | undefined;
    let areaLabels: AreaLabel[] = [];
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

        // The box: what the usual zoom shows, centred on you. Only drawn once the camera is further out than that.
        const player = scene.CurrentPlayer;
        const normalZoom = $lookAroundNormalZoomStore ?? waScaleManager.zoomModifier;
        const ratio = waScaleManager.zoomModifier / normalZoom;
        const boxWidth = canvas.width * ratio;
        const boxHeight = canvas.height * ratio;
        const centre = toScreen(player.x, player.y);
        box = {
            x: centre.x - boxWidth / 2,
            y: centre.y - boxHeight / 2,
            width: boxWidth,
            height: boxHeight,
            visible: ratio < 0.92,
        };

        // The "You" tab: on the edge nearest to you, once you are off-screen.
        if (
            centre.x < -EDGE_MARGIN ||
            centre.x > bounds.width + EDGE_MARGIN ||
            centre.y < -EDGE_MARGIN ||
            centre.y > bounds.height + EDGE_MARGIN
        ) {
            const clampedX = Math.min(Math.max(centre.x, 80), bounds.width - 80);
            const clampedY = Math.min(Math.max(centre.y, 120), bounds.height - 160);
            // Off-screen in two directions at once (far above, a little to the left): the tab goes on the edge you
            // are furthest beyond, which is the direction the tab's arrow should point.
            const beyond = {
                left: -centre.x,
                right: centre.x - bounds.width,
                top: -centre.y,
                bottom: centre.y - bounds.height,
            };
            const side = (Object.keys(beyond) as (keyof typeof beyond)[]).reduce((best, each) =>
                beyond[each] > beyond[best] ? each : best
            );
            youTab = side === "left" || side === "right" ? { side, x: 0, y: clampedY } : { side, x: clampedX, y: 0 };
        } else {
            youTab = undefined;
        }

        // Labels on the places that have people: counted a few times a second, positioned every frame.
        const areas = $mapExplorationAreasStore;
        if (areas) {
            const recount = now - lastPeopleCount > 400;
            if (recount) lastPeopleCount = now;
            const labels: AreaLabel[] = [];
            const counts = recount ? new Map<string, number>() : undefined;
            for (const [id, area] of areas) {
                const data = area.getAreaData();
                const people = recount
                    ? countPeopleIn(data)
                    : areaLabels.find((label) => label.id === id)?.people ?? countPeopleIn(data);
                counts?.set(id, people);
                if (people === 0) continue;
                const top = toScreen(data.x + data.width / 2, data.y);
                labels.push({ id, area, name: data.name || area.nameFromProperties, people, x: top.x, y: top.y });
            }
            areaLabels = labels;
            if (counts) peopleByArea = counts;
        }
    }

    function goHome() {
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene) return;
        scene.getCameraManager().centerCameraOn({ x: scene.CurrentPlayer.x, y: scene.CurrentPlayer.y });
        (
            scene.getMapEditorModeManager().currentlyActiveTool as ExplorerTool | undefined
        )?.defineZoomToCenterCameraPosition?.();
    }

    function selectArea(area: AreaPreview) {
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
    {#if box.visible}
        <div
            class="you-box"
            style="left:{box.x}px;top:{box.y}px;width:{box.width}px;height:{box.height}px"
            data-testid="look-around-you-box"
        >
            <span class="you-box-label u-surface">{$LL.mapEditor.lookAround.youAreHere()}</span>
        </div>
    {/if}

    {#each areaLabels as label (label.id)}
        <button
            type="button"
            class="area-label u-surface pointer-events-auto"
            style="left:{label.x}px;top:{label.y}px"
            on:click={() => selectArea(label.area)}
        >
            <span class="area-label-name">{label.name}</span>
            <span class="area-label-people"
                >{label.people === 1
                    ? $LL.mapEditor.lookAround.onePerson()
                    : $LL.mapEditor.lookAround.people({ count: label.people })}</span
            >
        </button>
    {/each}

    {#if youTab}
        <button
            type="button"
            class="you-tab you-tab-{youTab.side} u-surface pointer-events-auto"
            style={youTab.side === "left" || youTab.side === "right" ? `top:${youTab.y}px` : `left:${youTab.x}px`}
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
    /* The box glows lavender and dims the rest of the map a little, so what you normally see stands out. */
    .you-box {
        position: absolute;
        border-radius: 16px;
        box-shadow: 0 0 0 2px rgba(196, 181, 253, 0.95), 0 0 0 6px rgba(167, 139, 250, 0.22),
            0 0 0 4000px rgba(10, 8, 20, 0.34);
        transition: width 120ms ease, height 120ms ease;
    }
    .you-box-label {
        position: absolute;
        left: 8px;
        top: -14px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        white-space: nowrap;
        background-image: linear-gradient(90deg, #c4b5fd, #f5c451);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
    }
    .area-label {
        position: absolute;
        transform: translate(-50%, -100%) translateY(-6px);
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
        padding: 6px 10px;
        border: 0;
        border-radius: 12px;
        color: #fff;
        font: inherit;
        line-height: 1.2;
        text-align: start;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .area-label-name {
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
    }
    .area-label-people {
        font-size: 11.5px;
        color: rgba(244, 242, 250, 0.64);
        white-space: nowrap;
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
    /* The top tab hangs under the pill; on a phone the bottom one sits above the bar. */
    .you-tab-top {
        top: 72px;
        border-radius: 0 0 26px 26px;
        transform: translateX(-50%);
    }
    .phone .you-tab-top {
        top: calc(76px + env(safe-area-inset-top, 0px));
    }
    .you-tab-bottom {
        bottom: 0;
        border-radius: 26px 26px 0 0;
        transform: translateX(-50%);
    }
    .phone .you-tab-bottom {
        bottom: calc(72px + env(safe-area-inset-bottom, 0px));
    }
    .you-tab-woka {
        width: 30px;
        height: 30px;
        object-fit: contain;
        image-rendering: pixelated;
    }
</style>
