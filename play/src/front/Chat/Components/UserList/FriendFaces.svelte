<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { AvailabilityStatus } from "@workadventure/messages";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { getColorHexOfStatus } from "../../../Utils/AvailabilityStatus";
    import FriendAvatar from "./FriendAvatar.svelte";
    import type { PlacedFriend } from "./Friends";
    import { statusLabel } from "./PersonStatus";

    /**
     * "Friends in other worlds": one swipeable row of faces at the top of Everyone, so friends elsewhere never
     * push this room's people down. Tapping a face (or All) opens them in the Friends view.
     */
    export let faces: PlacedFriend[];
    /** Faces shown before "+N All". */
    export let limit = 8;

    const dispatch = createEventDispatcher<{ open: string | undefined }>();

    $: visible = faces.slice(0, limit);
    $: more = faces.length - visible.length;

    // Where they are, or their status when it isn't plain "online" (Busy, Do not disturb...).
    function under(entry: PlacedFriend): string {
        if (entry.status !== AvailabilityStatus.ONLINE) return statusLabel(entry.status, $LL);
        return entry.session?.worldName || entry.session?.roomName || "";
    }
</script>

{#if faces.length > 0}
    <section class="flex flex-col pb-1" data-testid="friendFaces">
        <h3 class="m-0 flex h-10 items-center gap-2.5 px-4 text-sm font-bold">
            <span class="u-eyebrow truncate">{$LL.chat.friends.inOtherWorlds()}</span>
            <span class="u-count shrink-0">{faces.length}</span>
        </h3>
        <ul class="m-0 flex list-none gap-1 overflow-x-auto px-2 pb-1 [scrollbar-width:none]">
            {#each visible as entry (entry.friend.uuid)}
                <li class="shrink-0">
                    <button
                        type="button"
                        class="m-0 flex w-16 flex-col items-center gap-1 rounded-[12px] border-0 bg-transparent px-1 py-1.5 text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                        aria-label={`${entry.friend.name}, ${under(entry)}`}
                        data-testid={`face-${entry.friend.name}`}
                        on:click={() => dispatch("open", entry.friend.uuid)}
                    >
                        <span class="relative">
                            <FriendAvatar size="face" />
                            <span
                                class="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-solid border-[#14121E]"
                                style="background:{getColorHexOfStatus(entry.status)}"
                                aria-hidden="true"
                            />
                        </span>
                        <span class="w-full truncate text-center text-xs font-bold">{entry.friend.name}</span>
                        <span class="-mt-1 w-full truncate text-center text-[10px] text-white/55">{under(entry)}</span>
                    </button>
                </li>
            {/each}
            {#if more > 0}
                <li class="shrink-0">
                    <button
                        type="button"
                        class="m-0 flex w-16 flex-col items-center gap-1 rounded-[12px] border-0 bg-transparent px-1 py-1.5 text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                        aria-label={$LL.chat.friends.seeAllFriends({ count: faces.length })}
                        on:click={() => dispatch("open", undefined)}
                    >
                        <span
                            class="u-glass flex h-11 w-11 items-center justify-center rounded-[12px] text-sm font-bold"
                            >+{more}</span
                        >
                        <span class="text-xs font-bold">{$LL.chat.friends.seeAll()}</span>
                    </button>
                </li>
            {/if}
        </ul>
    </section>
{/if}
