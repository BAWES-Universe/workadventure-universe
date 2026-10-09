<script lang="ts">
    import { onMount } from "svelte";
    import { cubicOut } from "svelte/easing";
    import type { TransitionConfig } from "svelte/transition";
    import type { UniverseRoomDescription, UniverseWorldDescription } from "@workadventure/messages";
    import { roomListVisibilityStore } from "../../Stores/ModalStore";
    import { exploreFoldedWorldsStore, exploreStore, universeNameStore } from "../../Stores/ExploreStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import LL from "../../../i18n/i18n-svelte";
    import { fold } from "../../Utils/foldTransition";
    import ExploreRoomCard from "./ExploreRoomCard.svelte";
    import { displayName } from "./exploreText";
    import { IconChevronDown, IconPlanet, IconSearch, IconX } from "@wa-icons";

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
            // The header counts every room, as the people sidebar counts before its search filters.
            total: world.rooms.length,
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

    // Motion as in Express (ExpressTray.svelte): quick, eased out, and none for players who ask for less.
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    /** The panel grows into place, like the Express tray unfolding. */
    function unfold(_node: Element): TransitionConfig {
        return {
            duration: reducedMotion ? 0 : 260,
            easing: cubicOut,
            css: (t) => `opacity: ${t}; transform: translateY(${(1 - t) * 12}px) scale(${0.96 + 0.04 * t});`,
        };
    }

    function close() {
        roomListVisibilityStore.set(false);
    }

    function visit(room: UniverseRoomDescription) {
        close();
        if (room.isCurrent) return;
        // Between scenes (a map exit already under way) there is none to move: that move wins.
        gameManager.tryGetCurrentGameScene()?.goToRoom(room.roomUrl);
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
        transition:unfold
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
            <button type="button" class="u-close ms-auto" aria-label={$LL.actionbar.explore.close()} on:click={close}>
                <IconX font-size="20" />
            </button>
        </header>

        <div class="px-4 sm:px-6 pt-3 pb-3">
            <!-- The chat's people and chats search (ChatHeader.svelte) -->
            <div class="explore-search u-glass group relative h-11 flex items-center rounded-full transition-colors">
                <IconSearch
                    font-size="18"
                    class="pointer-events-none absolute start-3.5 text-white/60 group-focus-within:text-white"
                    aria-hidden="true"
                />
                <input
                    id="explore-search"
                    type="search"
                    autocomplete="off"
                    data-testid="explore-search"
                    class="explore-search-input block w-full h-full m-0 border-none bg-transparent text-white text-sm placeholder:text-white/50 placeholder:text-sm ps-10 pe-11 py-0 rounded-full focus:outline-none"
                    placeholder={$LL.actionbar.explore.searchPlaceholder()}
                    aria-label={$LL.actionbar.explore.searchLabel()}
                    bind:value={search}
                />
                {#if search !== ""}
                    <button
                        type="button"
                        class="absolute end-1 m-0 p-0 h-9 w-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10"
                        aria-label={$LL.chat.header.clearSearch()}
                        title={$LL.chat.header.clearSearch()}
                        on:click={() => (search = "")}
                    >
                        <IconX font-size="16" />
                    </button>
                {/if}
            </div>
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
                            <span class="u-count shrink-0">{world.total}</span>
                            <span class="grow" />
                            <IconChevronDown
                                font-size="16"
                                class="shrink-0 text-white/50 transition-transform duration-200 ease-out {open
                                    ? ''
                                    : '-rotate-90 rtl:rotate-90'}"
                            />
                        </button>
                        {#if open}
                            <div
                                class="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 px-4 sm:px-6 pt-1 pb-3"
                                use:scrollToStartOn={query}
                                transition:fold
                            >
                                {#each world.rooms as room, index (room.roomUrl)}
                                    <ExploreRoomCard {room} {index} on:select={() => visit(room)} />
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
    /* The raised surface Express uses (style.scss), with Orbit's dark theme (admin app/globals.css .dark) inside. */
    .explore {
        background: var(--u-surface-bg);
        box-shadow: var(--u-surface-shadow);
    }
    .explore-search {
        background: rgba(255, 255, 255, 0.06);
    }
    .explore-search:focus-within {
        border-color: rgba(167, 139, 250, 0.6);
        box-shadow: 0 0 0 3px rgba(134, 41, 252, 0.18);
    }
    /* The field has its own clear button; hide the browser's. */
    .explore-search-input::-webkit-search-cancel-button,
    .explore-search-input::-webkit-search-decoration {
        -webkit-appearance: none;
        appearance: none;
    }
    .muted {
        color: hsl(250 15% 74%);
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
