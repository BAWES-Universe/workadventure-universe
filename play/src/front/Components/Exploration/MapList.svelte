<script lang="ts">
    import { onMount } from "svelte";
    import type { UniverseRoomDescription, UniverseWorldDescription } from "@workadventure/messages";
    import { roomListVisibilityStore } from "../../Stores/ModalStore";
    import { exploreStore, universeNameStore } from "../../Stores/ExploreStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import LL from "../../../i18n/i18n-svelte";
    import ExploreRoomCard from "./ExploreRoomCard.svelte";
    import { IconPlanet, IconX } from "@wa-icons";

    // "Explore {Universe}": every room the player may see in this universe, one row per world (theirs first), rooms
    // most visited first. Picking a room moves there in-game, like Orbit's Visit, without reloading the page.

    let search = "";

    onMount(() => {
        // Visits and stars move: show what we have and refresh it.
        exploreStore.refresh();
    });

    function matches(query: string, world: UniverseWorldDescription, room: UniverseRoomDescription): boolean {
        return [room.name, room.description ?? "", world.name].some((text) => text.toLowerCase().includes(query));
    }

    $: query = search.trim().toLowerCase();
    $: worlds = ($exploreStore.universe?.worlds ?? [])
        .map((world) => ({
            ...world,
            rooms: query ? world.rooms.filter((room) => matches(query, world, room)) : world.rooms,
        }))
        .filter((world) => world.rooms.length > 0);
    $: roomCount = ($exploreStore.universe?.worlds ?? []).reduce((sum, world) => sum + world.rooms.length, 0);

    function close() {
        roomListVisibilityStore.set(false);
    }

    function visit(room: UniverseRoomDescription) {
        close();
        if (room.isCurrent) return;
        gameManager.getCurrentGameScene().goToRoom(room.roomUrl);
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") close();
    }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="absolute inset-0 flex items-center justify-center pointer-events-none p-2 sm:p-4">
    <section
        class="explore pointer-events-auto flex flex-col w-full lg:w-3/4 max-w-6xl max-h-full rounded-xl bg-contrast/90 backdrop-blur-md text-white overflow-hidden"
        aria-labelledby="explore-title"
        data-testid="explore-list"
    >
        <header class="flex items-center gap-3 px-4 sm:px-6 pt-4 sm:pt-5">
            <span class="accent flex shrink-0" aria-hidden="true"><IconPlanet font-size="22" /></span>
            <h2 id="explore-title" class="m-0 text-lg sm:text-xl font-bold tracking-tight truncate">
                {$universeNameStore
                    ? $LL.actionbar.explore.title({ universe: $universeNameStore })
                    : $LL.actionbar.explore.titleWithoutName()}
            </h2>
            <button
                type="button"
                class="ms-auto flex items-center justify-center w-10 h-10 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                aria-label={$LL.actionbar.explore.close()}
                on:click={close}
            >
                <IconX font-size="20" />
            </button>
        </header>

        <div class="px-4 sm:px-6 pt-3 pb-4">
            <label for="explore-search" class="sr-only">{$LL.actionbar.explore.searchLabel()}</label>
            <input
                id="explore-search"
                type="search"
                autocomplete="off"
                placeholder={$LL.actionbar.explore.searchPlaceholder()}
                bind:value={search}
                class="input-search input-search-lg w-full"
            />
        </div>

        <div class="overflow-y-auto pb-4 min-h-40">
            {#if !$exploreStore.universe && $exploreStore.status === "loading"}
                <p class="m-0 px-6 py-10 text-center text-white/60" role="status">
                    {$LL.actionbar.explore.loading()}
                </p>
            {:else if !$exploreStore.universe}
                <p class="m-0 px-6 py-10 text-center text-white/60">
                    {$LL.actionbar.explore.failed()}
                    <button
                        type="button"
                        class="accent underline underline-offset-2 cursor-pointer bg-transparent"
                        on:click={() => exploreStore.refresh()}
                    >
                        {$LL.actionbar.explore.retry()}
                    </button>
                </p>
            {:else if roomCount === 0}
                <p class="m-0 px-6 py-10 text-center text-white/60">{$LL.actionbar.explore.noRooms()}</p>
            {:else if worlds.length === 0}
                <p class="m-0 px-6 py-10 text-center text-white/60">{$LL.actionbar.explore.noRoomFound()}</p>
            {:else}
                {#each worlds as world (world.slug)}
                    <section class="pt-2 pb-3" aria-label={world.name}>
                        <div class="flex items-center gap-2 px-4 sm:px-6 pb-2 min-w-0">
                            {#if world.thumbnailUrl}
                                <img
                                    src={world.thumbnailUrl}
                                    alt=""
                                    class="w-7 h-7 shrink-0 rounded-md object-cover bg-white/10"
                                    draggable="false"
                                />
                            {/if}
                            <h3 class="m-0 text-base font-bold truncate">{world.name}</h3>
                            {#if world.isCurrent}
                                <span
                                    class="chip chip-sm chip-secondary bg-secondary text-white rounded-[8px] shrink-0"
                                >
                                    {$LL.actionbar.explore.yourWorld()}
                                </span>
                            {/if}
                            <span class="ms-auto shrink-0 text-xs text-white/50 tabular-nums">{world.rooms.length}</span
                            >
                        </div>
                        <div
                            class="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 px-4 sm:px-6 pb-2"
                        >
                            {#each world.rooms as room (room.roomUrl)}
                                <ExploreRoomCard {room} worldName={world.name} on:select={() => visit(room)} />
                            {/each}
                        </div>
                    </section>
                {/each}
            {/if}
        </div>
    </section>
</div>

<style>
    .explore {
        --room-accent: #f59e0b;
    }
    .accent {
        color: var(--room-accent);
    }
</style>
