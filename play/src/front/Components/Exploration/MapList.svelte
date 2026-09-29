<script lang="ts">
    import { onMount } from "svelte";
    import type { UniverseRoomDescription, UniverseWorldDescription } from "@workadventure/messages";
    import { roomListVisibilityStore } from "../../Stores/ModalStore";
    import { exploreFoldedWorldsStore, exploreStore, universeNameStore } from "../../Stores/ExploreStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import LL from "../../../i18n/i18n-svelte";
    import ExploreRoomCard from "./ExploreRoomCard.svelte";
    import { displayName } from "./exploreText";
    import { IconChevronDown, IconPlanet, IconX } from "@wa-icons";

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

    // Searching unfolds the worlds that match; clearing it goes back to what you had folded (as the people sidebar).
    function isOpen(slug: string, folded: ReadonlySet<string>, searching: boolean): boolean {
        return searching || !folded.has(slug);
    }

    function toggle(slug: string) {
        exploreFoldedWorldsStore.update((folded) => {
            const next = new Set(folded);
            if (!next.delete(slug)) next.add(slug);
            return next;
        });
    }

    /** Back to the first room whenever the search changes, so a cleared search doesn't leave a row scrolled away. */
    function scrollToStartOn(node: HTMLElement, _query: string) {
        return {
            update() {
                node.scrollLeft = 0;
            },
        };
    }

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
        class="explore pointer-events-auto flex flex-col w-full lg:w-3/4 max-w-6xl max-h-full rounded-2xl backdrop-blur-md text-white overflow-hidden"
        aria-labelledby="explore-title"
        data-testid="explore-list"
    >
        <header class="flex items-center gap-3 px-4 sm:px-6 pt-4 sm:pt-5">
            <!-- Orbit's universe kind -->
            <span class="kind-universe" aria-hidden="true"><IconPlanet font-size="18" /></span>
            <h2
                id="explore-title"
                class="m-0 font-sans normal-case text-lg sm:text-xl font-bold tracking-tight truncate"
            >
                {$universeNameStore
                    ? $LL.actionbar.explore.title({ universe: displayName($universeNameStore) })
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

        <div class="px-4 sm:px-6 pt-3 pb-3">
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

        <div class="overflow-y-auto pb-3 min-h-40">
            {#if !$exploreStore.universe && $exploreStore.status === "loading"}
                <p class="m-0 px-6 py-10 text-center muted" role="status">
                    {$LL.actionbar.explore.loading()}
                </p>
            {:else if !$exploreStore.universe}
                <p class="m-0 px-6 py-10 text-center muted">
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
                <p class="m-0 px-6 py-10 text-center muted">{$LL.actionbar.explore.noRooms()}</p>
            {:else if worlds.length === 0}
                <p class="m-0 px-6 py-10 text-center muted">{$LL.actionbar.explore.noRoomFound()}</p>
            {:else}
                {#each worlds as world (world.slug)}
                    {@const open = isOpen(world.slug, $exploreFoldedWorldsStore, query !== "")}
                    <section aria-label={displayName(world.name)}>
                        <!-- The people sidebar's group header (PeopleAndBots.svelte) -->
                        <button
                            type="button"
                            class="m-0 flex h-9 w-full items-center gap-2 rounded-none px-4 sm:px-6 text-start text-xs font-semibold text-white/60 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:bg-white/5"
                            aria-expanded={open}
                            aria-label={(open ? $LL.chat.peopleTab.collapse : $LL.chat.peopleTab.expand)({
                                section: displayName(world.name),
                            })}
                            data-testid="explore-world-toggle"
                            on:click={() => toggle(world.slug)}
                        >
                            <span class="u-eyebrow truncate">{displayName(world.name)}</span>
                            <span class="u-count shrink-0">{world.rooms.length}</span>
                            <span class="grow" />
                            <IconChevronDown
                                font-size="16"
                                class="shrink-0 text-white/50 transition-transform {open
                                    ? ''
                                    : '-rotate-90 rtl:rotate-90'}"
                            />
                        </button>
                        {#if open}
                            <div
                                class="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 px-4 sm:px-6 pt-1 pb-3"
                                use:scrollToStartOn={query}
                            >
                                {#each world.rooms as room (room.roomUrl)}
                                    <ExploreRoomCard {room} on:select={() => visit(room)} />
                                {/each}
                            </div>
                        {/if}
                    </section>
                {/each}
            {/if}
        </div>
    </section>
</div>

<style>
    /* Orbit's dark theme (admin app/globals.css .dark). */
    .explore {
        background: hsl(218 44% 12% / 0.95);
        border: 1px solid hsl(216 28% 26%);
    }
    .muted {
        color: hsl(216 20% 72%);
    }
    .accent {
        color: #fbbf24;
    }
    .kind-universe {
        display: inline-grid;
        place-items: center;
        flex: none;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.75rem;
        color: #fff;
        background-image: linear-gradient(135deg, #8629fc, #4156f6);
    }
</style>
