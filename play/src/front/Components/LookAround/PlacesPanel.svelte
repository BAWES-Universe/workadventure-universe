<script lang="ts">
    // The Look around sheet: every area and object of the room with search and the property filters, plus the title
    // and the X that leaves Look around. On a phone it is a bottom sheet like the chat's (full width, three heights,
    // drag the grip or tap it, drag down from the lowest height to leave); on a computer it is a panel on the right edge.
    // Tap a place and the camera flies there; "Edit this room" at the bottom is for people who may edit.
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import {
        mapEditorModeStore,
        mapEditorVisibilityStore,
        mapExplorationAreasStore,
        mapExplorationEntitiesStore,
        mapExplorationObjectSelectedStore,
    } from "../../Stores/MapEditorStore";
    import { lookAroundBottomCoverStore } from "../../Stores/LookAroundStore";
    import { mapEditorMenuVisibleStore } from "../../Stores/MenuStore";
    import { mapExplorerSearchinputFocusStore } from "../../Stores/UserInputStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { Entity } from "../../Phaser/ECS/Entity";
    import type { AreaPreview } from "../../Phaser/Components/MapEditor/AreaPreview";
    import {
        getPlaceIcon,
        getPlaceName,
        getPlacePropertyLabel,
        getPlaceSearchText,
        getSettingTitle,
        placeHasProperty,
        type Place,
    } from "./placeInfo";
    import {
        IconAdjustements,
        IconChevronDown,
        IconChevronRight,
        IconEdit,
        IconLocation,
        IconSearch,
        IconX,
    } from "@wa-icons";

    /** People inside each area, by area id (counted by the map overlay). */
    export let peopleByArea: Map<string, number> = new Map();
    /** The line under the title: "Just you here", or the room name and how many people are here. */
    export let roomLine = "";
    /** Leaves Look around and goes back to the player. */
    export let onClose: () => void;
    /** On a phone the sheet steps aside while a place card is open, and comes back as it was. */
    export let hidden = false;

    // The chat sheet's three heights (ChatSheetSizes.ts): low, half, and the screen minus a 104px gap.
    type Snap = "low" | "half" | "full";
    const SNAPS: Snap[] = ["low", "half", "full"];
    const DRAG_PX = 30;
    let innerHeight = window.innerHeight;
    $: heights = {
        low: Math.min(Math.round(innerHeight / 2), Math.max(240, Math.round(innerHeight * 0.34))),
        half: Math.round(innerHeight / 2),
        full: innerHeight - 104,
    } as Record<Snap, number>;
    let snap: Snap = "half";
    let dragStartY: number | undefined;
    // The map overlay keeps its "You" tab above the sheet.
    $: lookAroundBottomCoverStore.set($mobileLayoutStore && !hidden ? heights[snap] : 0);
    onDestroy(() => lookAroundBottomCoverStore.set(0));

    function gripDown(event: PointerEvent) {
        // The pointer stays with the grip while it moves, so the release lands here even far from it.
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        dragStartY = event.clientY;
    }
    function gripUp(event: PointerEvent) {
        if (dragStartY === undefined) return;
        const dy = event.clientY - dragStartY;
        dragStartY = undefined;
        const at = SNAPS.indexOf(snap);
        if (dy < -DRAG_PX) snap = SNAPS[Math.min(at + 1, SNAPS.length - 1)];
        else if (dy > DRAG_PX) {
            // Dragged down from the lowest height: leaves Look around, like the chat closes.
            if (at === 0) onClose();
            else snap = SNAPS[at - 1];
        } else snap = SNAPS[(at + 1) % SNAPS.length];
    }
    function gripKey(event: KeyboardEvent) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        snap = SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length];
    }

    let openGroups = { areas: true, objects: true };
    let search = "";
    let filtersOpen = false;
    let selectedFilters: string[] = [];

    const PROPERTY_FILTERS = [
        "livekitRoomProperty",
        "jitsiRoomProperty",
        "speakerMegaphone",
        "listenerMegaphone",
        "silent",
        "openWebsite",
        "openFile",
        "playAudio",
        "start",
        "exit",
        "teleport",
        "focusable",
        "personalAreaPropertyData",
        "restrictedRightsPropertyData",
        "matrixRoomPropertyData",
    ];

    // The portal is a module's setting: its filter shows only in a room that has one.
    $: hasPortal = [...($mapExplorationAreasStore ?? new Map<string, AreaPreview>()).values()].some((area) =>
        placeHasProperty(area, "teleport")
    );
    $: shownFilters = PROPERTY_FILTERS.filter((filter) => filter !== "teleport" || hasPortal);

    function filterLabel(filter: string): string {
        return getSettingTitle(filter, $LL) ?? filter;
    }

    function toggleFilter(filter: string) {
        selectedFilters = selectedFilters.includes(filter)
            ? selectedFilters.filter((f) => f !== filter)
            : [...selectedFilters, filter];
        analyticsClient.filterInMapExplorer();
    }

    // The search and the filters are passed in, not read here, so the lists below are filtered again whenever they change.
    function matches(place: Place, query: string, filters: string[]): boolean {
        if (query.trim() !== "" && !getPlaceSearchText(place, $LL).includes(query.trim().toLowerCase())) {
            return false;
        }
        if (filters.length > 0 && !filters.some((filter) => placeHasProperty(place, filter))) {
            return false;
        }
        return true;
    }

    $: areas = [...($mapExplorationAreasStore ?? new Map<string, AreaPreview>()).entries()].filter(([, area]) =>
        matches(area, search, selectedFilters)
    );
    $: objects = [...$mapExplorationEntitiesStore.entries()].filter(([, entity]) =>
        matches(entity, search, selectedFilters)
    );

    function peopleText(areaId: string): string {
        const count = peopleByArea.get(areaId) ?? 0;
        if (count === 0) return "";
        if (count === 1) return $LL.mapEditor.lookAround.onePerson();
        return $LL.mapEditor.lookAround.people({ count });
    }

    function subtitle(place: Place, areaId?: string): string {
        const parts: string[] = [];
        const label = getPlacePropertyLabel(place, $LL);
        if (label) parts.push(label);
        if (areaId !== undefined && peopleText(areaId)) parts.push(peopleText(areaId));
        else if (place instanceof Entity && place.description) parts.push(place.description);
        return parts.join(" · ");
    }

    function select(place: Place) {
        mapExplorationObjectSelectedStore.set($mapExplorationObjectSelectedStore === place ? undefined : place);
    }

    function editRoom() {
        // Leaves "Look around" for the editor's objects tool, the same as Menu > Edit this room.
        mapExplorationObjectSelectedStore.set(undefined);
        // Between two maps there is no scene and no editor to open: the sheet just closes.
        const mapEditorModeManager = gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager();
        if (!mapEditorModeManager) return;
        analyticsClient.toggleMapEditor(true);
        if (!$mapEditorModeStore) mapEditorModeStore.switchMode(true);
        mapEditorModeManager.equipTool(EditorToolName.EntityEditor);
        mapEditorVisibilityStore.set(true);
    }

    // The game must not walk the woka while typing in the search box.
    function focusin(event: FocusEvent) {
        event.stopImmediatePropagation();
        mapExplorerSearchinputFocusStore.set(true);
    }
    function focusout(event: FocusEvent) {
        event.stopImmediatePropagation();
        mapExplorerSearchinputFocusStore.set(false);
    }
</script>

<svelte:window bind:innerHeight />

<div
    class="places u-surface pointer-events-auto"
    class:phone={$mobileLayoutStore}
    class:gone={hidden}
    transition:fly={$mobileLayoutStore ? { y: 80, duration: 220 } : { x: 60, duration: 220 }}
    style={$mobileLayoutStore ? `height: ${heights[snap]}px` : ""}
    data-testid="look-around-places"
>
    {#if $mobileLayoutStore}
        <button
            type="button"
            class="sheet-handle"
            aria-label={$LL.mapEditor.lookAround.dragHandle()}
            data-testid="look-around-grip"
            on:pointerdown={gripDown}
            on:pointerup={gripUp}
            on:pointercancel={() => (dragStartY = undefined)}
            on:keydown={gripKey}><i /></button
        >
    {/if}
    <div class="places-head">
        <div class="places-title">
            <div class="places-ttl">{$LL.mapEditor.lookAround.sheetTitle()}</div>
            <div class="places-sub" data-testid="look-around-room-line">{roomLine}</div>
        </div>
        <button
            type="button"
            class="u-close"
            aria-label={$LL.mapEditor.lookAround.closeAndBack()}
            data-testid="look-around-back"
            on:click={onClose}
        >
            <IconX font-size="18" />
        </button>
    </div>

    <div class="places-searchrow">
        <label class="places-search">
            <IconSearch font-size="16" />
            <input
                type="search"
                class="places-search-input"
                placeholder={$LL.mapEditor.lookAround.searchPlaces()}
                bind:value={search}
                on:focusin={focusin}
                on:focusout={focusout}
                data-testid="look-around-search"
            />
        </label>
        <button
            type="button"
            class="chip places-filter"
            class:open={filtersOpen}
            aria-pressed={filtersOpen}
            data-testid="look-around-filter"
            on:click={() => (filtersOpen = !filtersOpen)}
        >
            <IconAdjustements font-size="15" />
            {$LL.mapEditor.lookAround.filter()}
            {#if selectedFilters.length > 0}<b>{selectedFilters.length}</b>{/if}
        </button>
    </div>

    {#if filtersOpen}
        <div class="places-filters-label">{$LL.mapEditor.lookAround.showOnlyWith()}</div>
        <div class="places-filters">
            {#each shownFilters as filter (filter)}
                <button
                    type="button"
                    class="chip chip-sm"
                    class:on={selectedFilters.includes(filter)}
                    on:click={() => toggleFilter(filter)}>{filterLabel(filter)}</button
                >
            {/each}
            {#each connectionManager.applications as app (app.name)}
                <button
                    type="button"
                    class="chip chip-sm"
                    class:on={selectedFilters.includes(app.name)}
                    on:click={() => toggleFilter(app.name)}>{app.name}</button
                >
            {/each}
        </div>
    {/if}

    <div class="places-list">
        <button type="button" class="group-head areas" on:click={() => (openGroups.areas = !openGroups.areas)}>
            <span class="u-eyebrow">{$LL.mapEditor.lookAround.areas()}</span><b>{areas.length}</b>
            <span class="group-chev" class:shut={!openGroups.areas}><IconChevronDown font-size="16" /></span>
        </button>
        <div class="area-items" class:folded={!openGroups.areas}>
            {#each areas as [id, area] (id)}
                <button
                    type="button"
                    class="place-row item"
                    class:active={$mapExplorationObjectSelectedStore === area}
                    on:click={() => select(area)}
                >
                    <span class="place-tile"><svelte:component this={getPlaceIcon(area)} font-size="18" /></span>
                    <span class="place-text">
                        <span class="place-name">{getPlaceName(area, $LL)}</span>
                        <span class="place-sub">{subtitle(area, id)}</span>
                    </span>
                    <span class="place-go"><IconLocation font-size="15" /></span>
                </button>
            {:else}
                <div class="places-empty">{$LL.mapEditor.lookAround.nothingFound()}</div>
            {/each}
        </div>
        <button type="button" class="group-head entities" on:click={() => (openGroups.objects = !openGroups.objects)}>
            <span class="u-eyebrow">{$LL.mapEditor.lookAround.objects()}</span><b>{objects.length}</b>
            <span class="group-chev" class:shut={!openGroups.objects}><IconChevronDown font-size="16" /></span>
        </button>
        <div class="entity-items" class:folded={!openGroups.objects}>
            {#each objects as [id, entity] (id)}
                <button
                    type="button"
                    class="place-row item"
                    class:active={$mapExplorationObjectSelectedStore === entity}
                    on:click={() => select(entity)}
                >
                    <span class="place-tile place-tile-image">
                        <img src={entity.getPrefab().imagePath} alt="" draggable="false" />
                    </span>
                    <span class="place-text">
                        <span class="place-name">{getPlaceName(entity, $LL)}</span>
                        <span class="place-sub">{subtitle(entity)}</span>
                    </span>
                    <span class="place-go"><IconLocation font-size="15" /></span>
                </button>
            {:else}
                <div class="places-empty">{$LL.mapEditor.lookAround.nothingFound()}</div>
            {/each}
        </div>
    </div>

    {#if $mapEditorMenuVisibleStore}
        <button type="button" class="places-edit u-cta-secondary" on:click={editRoom} data-testid="look-around-edit">
            <IconEdit font-size="16" />
            {$LL.mapEditor.lookAround.editRoom()}
            <IconChevronRight font-size="14" />
        </button>
    {/if}
</div>

<style>
    /* Computers: a panel on the right edge, under the call's camera tiles. */
    .places {
        position: absolute;
        top: calc(var(--tiles-clear, 0px) + 12px);
        right: 92px;
        width: 360px;
        max-width: calc(100% - 24px);
        max-height: calc(100% - var(--tiles-clear, 0px) - 40px);
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        border-radius: 24px;
        color: #fff;
        z-index: 1;
    }
    /* Phones: like the chat, the full width from the bottom edge, over the bar. The height comes from the snap. */
    .places.phone {
        position: fixed;
        top: auto;
        left: 0;
        right: 0;
        bottom: 0;
        width: auto;
        max-width: none;
        max-height: none;
        padding: 4px 14px calc(14px + env(safe-area-inset-bottom, 0px));
        border-radius: 24px 24px 0 0;
        transition: height 200ms ease;
    }
    .places.gone {
        display: none;
    }
    .sheet-handle {
        display: grid;
        place-items: center;
        height: 18px;
        margin: 0 auto -4px;
        width: 120px;
        flex: none;
        border: 0;
        background: transparent;
        cursor: grab;
        touch-action: none;
    }
    .sheet-handle i {
        width: 40px;
        height: 5px;
        border-radius: 999px;
        background: rgba(244, 242, 250, 0.35);
    }
    .places-head {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .places-title {
        flex: 1;
        min-width: 0;
    }
    .places-ttl {
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.01em;
        line-height: 1.2;
    }
    .places-sub {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .places-searchrow {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .places-searchrow .places-search {
        flex: 1;
        min-width: 0;
    }
    .places-filter {
        height: 40px;
        padding: 0 14px;
    }
    /* Pressed while the filters are open = grey, like the bar's buttons. */
    .places-filter.open {
        background: rgba(255, 255, 255, 0.16);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
    }
    .places-filters-label {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.64);
        margin-top: -2px;
    }
    .group-head {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 36px;
        margin-top: 4px;
        padding: 0 8px;
        border: 0;
        background: transparent;
        color: #fff;
        cursor: pointer;
    }
    .group-head b {
        color: #f5c451;
        font-size: 12px;
    }
    .group-chev {
        margin-left: auto;
        display: grid;
        transition: transform 150ms ease;
    }
    .group-chev.shut {
        transform: rotate(-90deg);
    }
    .folded {
        display: none;
    }
    .places-search {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 14px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: rgba(244, 242, 250, 0.64);
    }
    .places-search:focus-within {
        box-shadow: inset 0 0 0 1px rgba(196, 181, 253, 0.7);
    }
    .places-search-input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: #fff;
        font: inherit;
        font-size: 14px;
        outline: none;
    }
    .places-search-input::placeholder {
        color: rgba(244, 242, 250, 0.42);
    }
    .places-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: none;
        height: 30px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: #fff;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .chip b {
        color: #f5c451;
        font-weight: 700;
    }
    .chip.on {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: none;
    }
    .chip-sm {
        height: 28px;
        padding: 0 10px;
        font-size: 12.5px;
    }
    .places-list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(167, 139, 250, 0.3) transparent;
    }
    .place-row {
        display: flex;
        align-items: center;
        gap: 11px;
        width: 100%;
        padding: 8px 8px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: #fff;
        font: inherit;
        text-align: start;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: background-color 150ms ease;
    }
    @media (hover: hover) {
        .place-row:hover {
            background: rgba(255, 255, 255, 0.06);
        }
    }
    .place-row.active {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.45);
    }
    .place-tile {
        display: grid;
        place-items: center;
        flex: none;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
    }
    .place-tile-image img {
        max-width: 28px;
        max-height: 28px;
        object-fit: contain;
        image-rendering: pixelated;
    }
    .place-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .place-name {
        font-size: 14px;
        font-weight: 400;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .place-row.active .place-name {
        font-weight: 700;
    }
    .place-sub {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .place-go {
        display: grid;
        place-items: center;
        flex: none;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
    }
    .places-empty {
        padding: 8px;
        font-size: 13px;
        color: rgba(244, 242, 250, 0.42);
    }
    .places-edit {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex: none;
        height: 40px;
        border-radius: 999px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
    }
</style>
