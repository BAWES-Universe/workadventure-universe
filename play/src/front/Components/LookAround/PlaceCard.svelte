<script lang="ts">
    // The card of the place you tapped while looking around: its name, what it is, "Walk there", and for an object
    // that opens a link, a file or a sound, a button that does it right here. The X of the sheet leaves Look around,
    // so the card has no second Back.
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import { mapExplorationObjectSelectedStore } from "../../Stores/MapEditorStore";
    import { Entity } from "../../Phaser/ECS/Entity";
    import { AreaPreview } from "../../Phaser/Components/MapEditor/AreaPreview";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { WOKA_SPEED } from "../../Enum/EnvironmentVariable";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import { leaveExploreTheRoom } from "../../Phaser/Game/MapEditor/ExploreTheRoom";
    import type { ExplorerTool } from "../../Phaser/Game/MapEditor/Tools/ExplorerTool";
    import { getPlaceIcon, getPlaceName, getPlacePropertyLabel, type Place } from "./placeInfo";
    import { IconX, IconWalk } from "@wa-icons";

    export let peopleInside = 0;

    const SELECTED_COLOR = 0xc4b5fd;
    let highlighted: Place | undefined;

    function highlight(place: Place | undefined) {
        if (highlighted === place) return;
        unhighlight();
        highlighted = place;
        if (!place) return;
        if (place instanceof Entity) place.setPointedToEditColor(SELECTED_COLOR);
        if (place instanceof AreaPreview) place.setStrokeStyle(2, SELECTED_COLOR);
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene) return;
        scene.getCameraManager().centerCameraOn(place);
        (
            scene.getMapEditorModeManager().currentlyActiveTool as ExplorerTool | undefined
        )?.defineZoomToCenterCameraPosition?.();
        scene.markDirty();
    }

    function unhighlight() {
        if (!highlighted) return;
        // Leaving Look around destroys the areas it drew before this runs: a destroyed object has no scene, leave it be.
        if (!highlighted.scene) {
            highlighted = undefined;
            return;
        }
        if (highlighted instanceof Entity) {
            if (highlighted.searchable) highlighted.setPointedToEditColor(0x000000);
            else highlighted.removePointedToEditColor();
        }
        if (highlighted instanceof AreaPreview) highlighted.setStrokeStyle(2, 0x000000);
        gameManager.tryGetCurrentGameScene()?.markDirty();
        highlighted = undefined;
    }

    $: highlight($mapExplorationObjectSelectedStore);
    onDestroy(unhighlight);

    function close() {
        mapExplorationObjectSelectedStore.set(undefined);
    }

    function walkThere() {
        const place = $mapExplorationObjectSelectedStore;
        if (!place) return;
        // The card can still be tapped while the map is changing; then there is no scene to walk in.
        const scene = gameManager.tryGetCurrentGameScene();
        if (!scene) {
            mapExplorationObjectSelectedStore.set(undefined);
            return;
        }
        scene.moveTo({ x: place.x, y: place.y }, true, WOKA_SPEED * 2.5).catch((error) => {
            console.warn("Error while moving to the entity or area", error);
            warningMessageStore.addWarningMessage($LL.mapEditor.explorer.details.errorMovingToObject(), {
                closable: true,
            });
        });
        analyticsClient.toggleMapEditor(false);
        mapExplorationObjectSelectedStore.set(undefined);
        leaveExploreTheRoom();
    }

    // What the object does when you use it: open its link or file, play its sound.
    const DOES_SOMETHING = ["openWebsite", "openFile", "playAudio"];
    function doIt() {
        const place = $mapExplorationObjectSelectedStore;
        if (!(place instanceof Entity)) return;
        place.runAction(DOES_SOMETHING);
        mapExplorationObjectSelectedStore.set(undefined);
        leaveExploreTheRoom();
    }

    $: place = $mapExplorationObjectSelectedStore;
    $: name = place ? getPlaceName(place, $LL) : "";
    $: propertyLabel = place ? getPlacePropertyLabel(place, $LL) : undefined;
    $: subtitle = (() => {
        const parts: string[] = [];
        if (propertyLabel) parts.push(propertyLabel);
        if (place instanceof AreaPreview) {
            if (peopleInside > 0)
                parts.push(
                    peopleInside === 1
                        ? $LL.mapEditor.lookAround.onePerson()
                        : $LL.mapEditor.lookAround.people({ count: peopleInside })
                );
        }
        return parts.join(" · ");
    })();
</script>

{#if place}
    <div
        class="place-card object-menu u-surface pointer-events-auto"
        class:phone={$mobileLayoutStore}
        transition:fly={{ y: 80, duration: 250 }}
        data-testid="look-around-place-card"
    >
        <div class="place-card-head">
            {#if place instanceof Entity}
                <span class="place-card-tile place-card-image">
                    <img src={place.getPrefab().imagePath} alt="" draggable="false" />
                </span>
            {:else}
                <span class="place-card-tile"><svelte:component this={getPlaceIcon(place)} font-size="22" /></span>
            {/if}
            <div class="place-card-text">
                <h1 class="place-card-name">{name}</h1>
                <p class="place-card-sub">{subtitle}</p>
            </div>
            <button type="button" class="u-close" aria-label={$LL.mapEditor.lookAround.close()} on:click={close}>
                <IconX font-size="18" />
            </button>
        </div>
        {#if place.description}<p class="place-card-desc">{place.description}</p>{/if}
        <div class="place-card-actions">
            <button type="button" class="place-card-walk u-cta" on:click={walkThere}>
                <IconWalk font-size="18" />
                {$LL.mapEditor.lookAround.walkThere()}
            </button>
            {#if place instanceof Entity && place.getProperties().some((p) => DOES_SOMETHING.includes(p.type))}
                <button type="button" class="place-card-do" data-testid="look-around-do" on:click={doIt}>
                    {place.actionButtonLabel}
                </button>
            {/if}
        </div>
    </div>
{/if}

<style>
    .place-card {
        position: absolute;
        left: 50%;
        bottom: 24px;
        width: min(420px, calc(100% - 24px));
        transform: translateX(-50%);
        padding: 14px;
        border-radius: 24px;
        color: #fff;
        z-index: 2;
    }
    /* Phones: above the bar, clear of the zoom column on the right. */
    .place-card.phone {
        left: 12px;
        right: 68px;
        bottom: calc(var(--bar-clear, 0px) + 72px + env(safe-area-inset-bottom, 0px));
        width: auto;
        transform: none;
    }
    .place-card-head {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .place-card-tile {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
    }
    .place-card-image img {
        max-width: 36px;
        max-height: 36px;
        object-fit: contain;
        image-rendering: pixelated;
    }
    .place-card-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
    }
    .place-card-actions .place-card-walk {
        flex: 1;
        margin-top: 0;
    }
    .place-card-do {
        flex: 1;
        height: 44px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        box-shadow: inset 0 0 0 1px rgba(196, 181, 253, 0.35);
        color: #fff;
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
    }
    .place-card-desc {
        margin: 10px 2px 0;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.86);
    }
    .place-card-text {
        flex: 1;
        min-width: 0;
    }
    .place-card-name {
        margin: 0;
        text-transform: none;
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.01em;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .place-card-sub {
        margin: 2px 0 0;
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
    }
    .place-card-walk {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        height: 44px;
        margin-top: 12px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
    }
</style>
