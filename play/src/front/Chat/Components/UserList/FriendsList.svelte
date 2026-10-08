<script lang="ts">
    import type { Readable } from "svelte/store";
    import { LL } from "../../../../i18n/i18n-svelte";
    import FriendRow from "./FriendRow.svelte";
    import type { FriendGroupKey, PlacedFriend } from "./Friends";
    import { groupFriends } from "./Friends";
    import { IconRefresh } from "@wa-icons";

    /**
     * The Friends view: Here, In this world, Other worlds, Offline, each alphabetical. When where friends are can't
     * be checked, a line says so: friends in this world still show (the world's own list knows), everyone else is
     * listed under "Everyone else" with their status unavailable.
     */
    export let placed: PlacedFriend[];
    export let lookOf: (uuid: string) => { picture?: Readable<string | undefined>; color?: string };
    export let query = "";
    export let presenceUnavailable = false;
    export let highlightUuid: string | undefined = undefined;
    export let isMatrixChatEnabled = true;

    $: shown = query === "" ? placed : placed.filter((entry) => entry.friend.name.toLocaleLowerCase().includes(query));
    $: groups = groupFriends(shown);

    $: sections = (["here", "inThisWorld", "otherWorlds", "offline"] as FriendGroupKey[])
        .map((key) => ({
            key,
            title:
                key === "here"
                    ? $LL.chat.friends.here()
                    : key === "inThisWorld"
                    ? $LL.chat.friends.inThisWorld()
                    : key === "otherWorlds"
                    ? $LL.chat.friends.otherWorlds()
                    : presenceUnavailable
                    ? $LL.chat.friends.everyoneElse()
                    : $LL.chat.friends.offline(),
            entries: groups[key],
        }))
        .filter((section) => section.entries.length > 0);
</script>

<div class="flex flex-col" data-testid="friendsList">
    {#if presenceUnavailable}
        <div
            class="u-glass mx-2 mb-2 flex items-start gap-2.5 rounded-[14px] px-3 py-2.5"
            role="status"
            data-testid="friendsUnavailable"
        >
            <IconRefresh font-size="18" class="mt-0.5 shrink-0 text-white/70" aria-hidden="true" />
            <div class="flex min-w-0 flex-col">
                <span class="text-sm font-bold">{$LL.chat.friends.unavailableTitle()}</span>
                <span class="text-xs text-white/60">{$LL.chat.friends.unavailableHint()}</span>
            </div>
        </div>
    {/if}
    {#each sections as section (section.key)}
        <section class="flex flex-col" data-testid={`friends-${section.key}`}>
            <h3 class="m-0 flex h-11 items-center gap-2.5 px-4 text-sm font-bold">
                <span class="u-eyebrow truncate">{section.title}</span>
                <span class="u-count shrink-0">{section.entries.length}</span>
            </h3>
            {#each section.entries as entry (entry.friend.uuid)}
                <FriendRow
                    {entry}
                    {...lookOf(entry.friend.uuid)}
                    {isMatrixChatEnabled}
                    presenceUnavailable={presenceUnavailable && entry.group === "offline"}
                    highlighted={entry.friend.uuid === highlightUuid}
                />
            {/each}
        </section>
    {/each}
    {#if placed.length === 0}
        <div class="flex flex-col items-center gap-1 px-6 py-8 text-center" data-testid="friendsEmpty">
            <span class="text-sm font-bold">{$LL.chat.friends.noFriends()}</span>
            <span class="text-xs text-white/60">{$LL.chat.friends.noFriendsHint()}</span>
        </div>
    {:else if shown.length === 0}
        <p class="m-0 px-4 py-6 text-center text-sm text-white/50">
            {$LL.chat.friends.noFriendsMatch({ query })}
        </p>
    {/if}
</div>
