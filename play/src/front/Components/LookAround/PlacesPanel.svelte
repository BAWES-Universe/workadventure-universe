<script lang="ts">
    // The Places panel: every area and object of the room, with search and the property filters, on the right edge.
    // Tap one and the camera flies there; "Edit this room" at the bottom is for people who may edit.
    import { fly } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import {
        mapEditorModeStore,
        mapEditorVisibilityStore,
        mapExplorationAreasStore,
        mapExplorationEntitiesStore,
        mapExplorationObjectSelectedStore,
    } from "../../Stores/MapEditorStore";
    import { lookAroundPlacesOpenStore } from "../../Stores/LookAroundStore";
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
        placeHasProperty,
        type Place,
    } from "./placeInfo";
    import { IconAdjustements, IconChevronRight, IconEdit, IconLocation, IconSearch, IconX } from "@wa-icons";

    /** People inside each area, by area id (counted by the map overlay). */
    export let peopleByArea: Map<string, number> = new Map();

    type Kind = "all" | "areas" | "objects";
    let kind: Kind = "all";
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
        "focusable",
        "personalAreaPropertyData",
        "restrictedRightsPropertyData",
        "matrixRoomPropertyData",
    ];

    function filterLabel(filter: string): string {
        const properties = $LL.mapEditor.properties as unknown as Record<string, { label?: () => string } | undefined>;
        const translation = properties[filter];
        return translation && typeof translation.label === "function" ? translation.label() : filter;
    }

    function toggleFilter(filter: string) {
        selectedFilters = selectedFilters.includes(filter)
            ? selectedFilters.filter((f) => f !== filter)
            : [...selectedFilters, filter];
        analyticsClient.filterInMapExplorer();
    }

    function matches(place: Place): boolean {
        if (search.trim() !== "" && !getPlaceSearchText(place, $LL).includes(search.trim().toLowerCase())) {
            return false;
        }
        if (selectedFilters.length > 0 && !selectedFilters.some((filter) => placeHasProperty(place, filter))) {
            return false;
        }
        return true;
    }

    $: areas = [...($mapExplorationAreasStore ?? new Map<string, AreaPreview>()).entries()].filter(([, area]) =>
        matches(area)
    );
    $: objects = [...$mapExplorationEntitiesStore.entries()].filter(([, entity]) => matches(entity));
    $: showAreas = kind !== "objects";
    $: showObjects = kind !== "areas";

    function peopleText(areaId: string): string {
        const count = peopleByArea.get(areaId) ?? 0;
        if (count === 0) return $LL.mapEditor.lookAround.empty();
        if (count === 1) return $LL.mapEditor.lookAround.onePerson();
        return $LL.mapEditor.lookAround.people({ count });
    }

    function subtitle(place: Place, areaId?: string): string {
        const parts: string[] = [];
        const label = getPlacePropertyLabel(place, $LL);
        if (label) parts.push(label);
        if (areaId !== undefined) parts.push(peopleText(areaId));
        else if (place instanceof Entity && place.description) parts.push(place.description);
        return parts.join(" · ");
    }

    function select(place: Place) {
        mapExplorationObjectSelectedStore.set($mapExplorationObjectSelectedStore === place ? undefined : place);
        // On a phone the panel would cover the place the camera flies to, so it closes; the card takes over.
        if ($mobileLayoutStore && $mapExplorationObjectSelectedStore) lookAroundPlacesOpenStore.set(false);
    }

    function close() {
        lookAroundPlacesOpenStore.set(false);
    }

    function editRoom() {
        // Leaves "Look around" for the editor's objects tool, the same as Menu > Edit this room.
        lookAroundPlacesOpenStore.set(false);
        mapExplorationObjectSelectedStore.set(undefined);
        // Between two maps there is no scene and no editor to open: the panel just closes.
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

<div
    class="places u-surface pointer-events-auto"
    class:phone={$mobileLayoutStore}
    transition:fly={{ x: 60, duration: 220 }}
    data-testid="look-around-places"
>
    <div class="places-head">
        <div class="places-title">
            <div class="places-ttl">{$LL.mapEditor.lookAround.places()}</div>
            <div class="places-sub">{$LL.mapEditor.lookAround.placesSubtitle()}</div>
        </div>
        <button
            type="button"
            class="u-close"
            aria-label={$LL.mapEditor.lookAround.close()}
            data-testid="closeVisitCardButton"
            on:click={close}
        >
            <IconX font-size="18" />
        </button>
    </div>

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

    <div class="places-chips">
        <button type="button" class="chip" class:on={kind === "all"} on:click={() => (kind = "all")}
            >{$LL.mapEditor.lookAround.all()}</button
        >
        <button type="button" class="chip" class:on={kind === "areas"} on:click={() => (kind = "areas")}
            >{$LL.mapEditor.lookAround.areas()} <b>{areas.length}</b></button
        >
        <button type="button" class="chip" class:on={kind === "objects"} on:click={() => (kind = "objects")}
            >{$LL.mapEditor.lookAround.objects()} <b>{objects.length}</b></button
        >
        <button
            type="button"
            class="chip chip-icon"
            class:on={filtersOpen || selectedFilters.length > 0}
            aria-label={$LL.mapEditor.lookAround.filters()}
            aria-pressed={filtersOpen}
            on:click={() => (filtersOpen = !filtersOpen)}
        >
            <IconAdjustements font-size="15" />
            {#if selectedFilters.length > 0}<b>{selectedFilters.length}</b>{/if}
        </button>
    </div>

    {#if filtersOpen}
        <div class="places-filters" transition:fly={{ y: -8, duration: 150 }}>
            {#each PROPERTY_FILTERS as filter (filter)}
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
        {#if showAreas}
            <div class="u-eyebrow places-eyebrow areas">{$LL.mapEditor.lookAround.areas()}</div>
            <div class="area-items">
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
        {/if}
        {#if showObjects}
            <div class="u-eyebrow places-eyebrow entities">{$LL.mapEditor.lookAround.objects()}</div>
            <div class="entity-items">
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
        {/if}
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
    .places {
        position: absolute;
        top: 160px;
        bottom: 14px;
        right: 92px;
        width: 420px;
        max-width: calc(100% - 24px);
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        border-radius: 24px;
        color: #fff;
        z-index: 1;
    }
    /* Phones: under the pill, above the bar, on the right edge like the editor's panel. */
    .places.phone {
        top: 76px;
        bottom: calc(72px + env(safe-area-inset-bottom, 0px));
        right: 10px;
        width: 300px;
    }
    .places-head {
        display: flex;
        align-items: flex-start;
        gap: 8px;
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
    .places-chips,
    .places-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .places-chips {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
    }
    .places-chips::-webkit-scrollbar {
        display: none;
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
    .chip.on b {
        color: #fff;
    }
    .chip-icon {
        padding: 0 10px;
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
    .places-eyebrow {
        margin: 10px 0 4px;
    }
    .places-eyebrow:first-child {
        margin-top: 2px;
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
