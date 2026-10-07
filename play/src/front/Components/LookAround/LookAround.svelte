<script lang="ts">
    // "Look around the map": the simple mode you get by tapping the map button or zooming out past the normal zoom.
    // It is not the map editor: no toolbar, for anyone. A hint at the top shows you can drag and pinch until you first
    // drag, the map layer draws the labels and the "You are here" tag, and the sheet (Places, search, filters, and the X
    // that brings you back) and the place card open from here.
    import { onDestroy, onMount } from "svelte";
    import { fade } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { playersStore } from "../../Stores/PlayersStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import { mapExplorationObjectSelectedStore } from "../../Stores/MapEditorStore";
    import { cameraTilesClearStore } from "../../Stores/CameraTilesClearStore";
    import { lookAroundDraggedStore } from "../../Stores/LookAroundStore";
    import { leaveExploreTheRoom } from "../../Phaser/Game/MapEditor/ExploreTheRoom";
    import { AreaPreview } from "../../Phaser/Components/MapEditor/AreaPreview";
    import LookAroundMap from "./LookAroundMap.svelte";
    import PlacesPanel from "./PlacesPanel.svelte";
    import PlaceCard from "./PlaceCard.svelte";
    import { IconHandMove, IconMouse } from "@wa-icons";

    let peopleByArea: Map<string, number> = new Map();
    let root: HTMLElement;
    // How far this layer runs under the bar, if it does (the bar is below it in the layout, but a browser that sizes
    // the two differently can slide it underneath): the card, the Places panel and the "You" tab stay above the bar
    // by that much more. Measured, not assumed, so it holds on every phone.
    let barClear = 0;
    let barClearTimer: ReturnType<typeof setInterval> | undefined;

    function measureBarClear() {
        const bar = document.querySelector(".bp-menu");
        if (!root || !bar) {
            barClear = 0;
            return;
        }
        const overlap = root.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
        barClear = Math.max(0, Math.round(overlap));
    }
    onMount(() => {
        measureBarClear();
        barClearTimer = setInterval(measureBarClear, 500);
        window.addEventListener("resize", measureBarClear);
    });
    onDestroy(() => {
        if (barClearTimer) clearInterval(barClearTimer);
        window.removeEventListener("resize", measureBarClear);
    });

    const roomName = gameManager.currentStartedRoom?.roomName ?? "";
    $: peopleHere = $playersStore.size + 1;
    $: roomLine =
        (roomName ? roomName + " · " : "") +
        (peopleHere === 1
            ? $LL.mapEditor.lookAround.justYou()
            : $LL.mapEditor.lookAround.peopleHere({ count: peopleHere }));
    $: selected = $mapExplorationObjectSelectedStore;
    $: peopleInside = selected instanceof AreaPreview ? peopleByArea.get(selected.getAreaData().id) ?? 0 : 0;
    // The hint stays until the first real drag, and steps aside while something else is open on the map.
    $: hintVisible = !$lookAroundDraggedStore && !selected;

    function backToMe() {
        leaveExploreTheRoom();
    }
</script>

<div
    bind:this={root}
    class="look-around absolute inset-0 pointer-events-none"
    class:phone={$mobileLayoutStore}
    style="--bar-clear: {barClear}px; --tiles-clear: {$cameraTilesClearStore}px"
    data-testid="look-around"
>
    <LookAroundMap bind:peopleByArea />

    {#if hintVisible}
        <div class="la-hint u-surface" transition:fade={{ duration: 200 }} data-testid="look-around-hint">
            <span class="la-hint-icon" class:drag={$mobileLayoutStore}>
                {#if $mobileLayoutStore}<IconHandMove font-size="22" />{:else}<IconMouse font-size="20" />{/if}
            </span>
            <div>
                <div class="la-hint-title">{$LL.mapEditor.lookAround.hintDrag()}</div>
                <div class="la-hint-body">
                    {$mobileLayoutStore ? $LL.mapEditor.lookAround.hintPinch() : $LL.mapEditor.lookAround.hintScroll()}
                </div>
            </div>
        </div>
    {/if}

    <PlacesPanel {peopleByArea} {roomLine} onClose={backToMe} hidden={$mobileLayoutStore && Boolean(selected)} />

    <PlaceCard {peopleInside} />
</div>

<style>
    /* Above the camera tiles (z 20), below the zoom column and every window. */
    .look-around {
        color: #fff;
        z-index: 21;
    }
    /* On a phone the sheet covers the bar, like the chat does, so this layer goes above it (the bar is z 301). */
    .look-around.phone {
        z-index: 320;
    }
    /* The hint card, at the top. */
    .la-hint {
        position: absolute;
        top: calc(var(--tiles-clear, 0px) + 12px);
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-radius: 24px;
        white-space: nowrap;
    }
    .phone .la-hint {
        top: calc(var(--tiles-clear, 0px) + 12px + env(safe-area-inset-top, 0px));
        left: 40px;
        right: 40px;
        transform: none;
        padding: 14px;
        white-space: normal;
    }
    .la-hint-icon {
        display: grid;
        place-items: center;
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 6px 16px -6px rgba(134, 41, 252, 0.8);
    }
    .phone .la-hint-icon {
        width: 44px;
        height: 44px;
    }
    .la-hint-icon.drag {
        animation: la-drag 2.6s ease-in-out infinite;
    }
    @keyframes la-drag {
        0%,
        15% {
            transform: translate(0, 0);
        }
        55%,
        70% {
            transform: translate(-10px, 6px);
        }
        100% {
            transform: translate(0, 0);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .la-hint-icon.drag {
            animation: none;
        }
    }
    .la-hint-title {
        font-size: 15px;
        font-weight: 600;
    }
    .la-hint-body {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
