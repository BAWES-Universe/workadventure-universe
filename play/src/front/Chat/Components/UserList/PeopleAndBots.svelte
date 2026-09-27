<script lang="ts">
    import type { ChatUser } from "../../Connection/ChatConnection";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { peopleSectionsOpenStore } from "../../Stores/ChatStore";
    import UserList from "./UserList.svelte";
    import type { PersonGroup } from "./PersonSessions";
    import { sessionCount, splitBots } from "./PersonSessions";
    import { IconChevronDown } from "@wa-icons";

    /**
     * The rows of one room, people first, then bots under a group of their own. Both groups fold, and remember it
     * for every room. Without bots the list shows as it always did, with no group headers.
     * Group counts are of sessions before the search filters them, so they add up to the room's "N here".
     */
    type Person = PersonGroup<ChatUser>;

    /** Everyone in the room, for the counts. */
    export let all: Person[];
    /** The rows to show: `all` filtered by the search. */
    export let shown: Person[];
    export let isMatrixChatEnabled = true;
    export let isSearching = false;
    /** Whether people get a header of their own; off where the room name already heads them. */
    export let peopleHeader = true;
    export let testId = "people";

    $: counts = splitBots(all);
    $: rows = splitBots(shown);
    $: hasBots = counts.bots.length > 0;

    // Searching unfolds the groups that match; clearing it goes back to what you had unfolded.
    $: peopleOpen =
        !hasBots || !peopleHeader || (isSearching ? rows.people.length > 0 : $peopleSectionsOpenStore.people);
    $: botsOpen = isSearching ? rows.bots.length > 0 : $peopleSectionsOpenStore.bots;

    function toggle(group: "people" | "bots") {
        peopleSectionsOpenStore.update((open) => ({ ...open, [group]: !open[group] }));
    }
</script>

{#if hasBots && peopleHeader && counts.people.length > 0 && (!isSearching || rows.people.length > 0)}
    <button
        type="button"
        class="people-group-toggle m-0 flex h-9 w-full items-center gap-2 rounded-none px-4 text-start text-xs font-semibold text-white/60 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:bg-white/5"
        aria-expanded={peopleOpen}
        aria-label={(peopleOpen ? $LL.chat.peopleTab.collapse : $LL.chat.peopleTab.expand)({
            section: $LL.chat.peopleTab.people(),
        })}
        data-testid={`${testId}PeopleToggle`}
        on:click={() => toggle("people")}
    >
        <span class="u-eyebrow truncate">{$LL.chat.peopleTab.people()}</span>
        <span class="u-count shrink-0">{sessionCount(counts.people)}</span>
        <span class="grow" />
        <IconChevronDown
            font-size="16"
            class="shrink-0 text-white/50 transition-transform {peopleOpen ? '' : '-rotate-90 rtl:rotate-90'}"
        />
    </button>
{/if}
{#if peopleOpen}
    <UserList people={rows.people} {isMatrixChatEnabled} />
{/if}

{#if hasBots && (!isSearching || rows.bots.length > 0)}
    <button
        type="button"
        class="people-group-toggle m-0 flex h-9 w-full items-center gap-2 rounded-none px-4 text-start text-xs font-semibold text-white/60 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:bg-white/5"
        aria-expanded={botsOpen}
        aria-label={(botsOpen ? $LL.chat.peopleTab.collapse : $LL.chat.peopleTab.expand)({
            section: $LL.chat.peopleTab.bots(),
        })}
        data-testid={`${testId}BotsToggle`}
        on:click={() => toggle("bots")}
    >
        <span class="u-eyebrow truncate">{$LL.chat.peopleTab.bots()}</span>
        <span class="u-count shrink-0">{sessionCount(counts.bots)}</span>
        <span class="grow" />
        <IconChevronDown
            font-size="16"
            class="shrink-0 text-white/50 transition-transform {botsOpen ? '' : '-rotate-90 rtl:rotate-90'}"
        />
    </button>
    {#if botsOpen}
        <UserList people={rows.bots} {isMatrixChatEnabled} />
    {/if}
{/if}
