<script lang="ts">
    import type { FriendSearchResult } from "@workadventure/messages";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { friendsStore, relationshipsStore } from "../../Stores/FriendsStore";
    import FriendAvatar from "./FriendAvatar.svelte";
    import { runFriendAction } from "./FriendActions";
    import { IconCheck, IconUserCheck, IconUserPlus, IconWorld } from "@wa-icons";

    /**
     * Under a People search: look for the name in all of Universe, among the players who allow being found by name.
     * Only names and universes show; where someone is shows once they accept.
     */
    export let query: string;
    /** No one in this world matched: say so above the button. */
    export let nothingHere = false;

    type Search = { status: "idle" } | { status: "searching" } | { status: "done"; results: FriendSearchResult[] };
    let search: Search = { status: "idle" };
    let searchedFor = "";
    let latest = 0;

    // A new query forgets the last results: the button searches again.
    $: if (query !== searchedFor && search.status !== "idle") {
        search = { status: "idle" };
    }

    async function run() {
        const request = ++latest;
        searchedFor = query;
        search = { status: "searching" };
        try {
            const results = await friendsStore.search(query);
            if (request === latest) search = { status: "done", results };
        } catch (e) {
            console.error("Friends: search failed", e);
            if (request === latest) search = { status: "done", results: [] };
        }
    }

    let pending = new Set<string>();
    async function add(result: FriendSearchResult) {
        pending = new Set(pending).add(result.uuid);
        const action = $relationshipsStore.get(result.uuid) === "request_received" ? "accept" : "request";
        await runFriendAction(result.uuid, result.name, action);
        pending.delete(result.uuid);
        pending = new Set(pending);
    }

    function relationshipOf(result: FriendSearchResult): string {
        return $relationshipsStore.get(result.uuid) ?? result.relationship;
    }
</script>

<div class="flex flex-col gap-2 px-2 pt-1 pb-2" data-testid="universeSearch">
    {#if nothingHere}
        <p class="m-0 px-2 text-sm text-white/60">{$LL.chat.friends.noMatchHere({ query })}</p>
    {/if}
    {#if search.status !== "done"}
        <button
            type="button"
            class="u-cta-secondary m-0 flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-bold text-white disabled:opacity-60"
            disabled={search.status === "searching" || query.length < 2}
            data-testid="searchUniverse"
            on:click={run}
        >
            <IconWorld font-size="18" />
            {search.status === "searching" ? $LL.chat.friends.searching() : $LL.chat.friends.searchUniverse()}
        </button>
        <p class="m-0 px-2 text-xs text-white/50">{$LL.chat.friends.searchHint()}</p>
    {:else}
        <h3 class="m-0 flex h-9 items-center gap-2.5 px-2 text-sm font-bold">
            <span class="u-eyebrow truncate">{$LL.chat.friends.allOfUniverse()}</span>
            <span class="u-count shrink-0">{search.results.length}</span>
        </h3>
        {#if search.results.length === 0}
            <p class="m-0 px-2 text-sm text-white/60">{$LL.chat.friends.noUniverseMatch({ query })}</p>
        {/if}
        <ul class="m-0 flex list-none flex-col p-0">
            {#each search.results as result (result.uuid)}
                {@const relationship = relationshipOf(result)}
                <li class="flex items-center gap-2 px-2 py-1.5" data-testid={`universe-result-${result.name}`}>
                    <FriendAvatar />
                    <div class="ms-1 flex min-w-0 flex-auto flex-col">
                        <span class="truncate text-sm font-bold">{result.name}</span>
                        {#if result.universes.length > 0}
                            <span class="truncate text-xs text-white/60"
                                >{$LL.chat.friends.member({ universes: result.universes.join(", ") })}</span
                            >
                        {/if}
                    </div>
                    {#if relationship === "friends"}
                        <span class="flex shrink-0 items-center gap-1 ps-2 text-xs font-bold text-white/70">
                            <IconUserCheck font-size="14" />
                            {$LL.chat.friends.friendBadge()}
                        </span>
                    {:else if relationship === "request_sent"}
                        <span class="flex shrink-0 items-center gap-1 ps-2 text-xs font-bold text-white/60">
                            <IconCheck font-size="14" />
                            {$LL.chat.friends.requestSent()}
                        </span>
                    {:else}
                        <button
                            type="button"
                            class="u-cta-secondary m-0 flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-white disabled:opacity-60"
                            aria-label={relationship === "request_received"
                                ? $LL.chat.friends.acceptFrom({ userName: result.name })
                                : $LL.chat.friends.addUserAsFriend({ userName: result.name })}
                            disabled={pending.has(result.uuid)}
                            data-testid={`add-friend-${result.name}`}
                            on:click={() => add(result)}
                        >
                            <IconUserPlus font-size="14" />
                            {relationship === "request_received"
                                ? $LL.chat.friends.accept()
                                : $LL.chat.friends.addFriend()}
                        </button>
                    {/if}
                </li>
            {/each}
        </ul>
        <p class="m-0 px-2 text-xs text-white/50">{$LL.chat.friends.searchPrivacy()}</p>
    {/if}
</div>
