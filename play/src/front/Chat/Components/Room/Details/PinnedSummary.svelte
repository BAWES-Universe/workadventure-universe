<script lang="ts">
    import { readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import { hasPins, type ChatRoom } from "../../../Connection/ChatConnection";
    import { openProfileRoomIdStore } from "../../../Stores/PartnerProfileStore";
    import { openRoomDetailsIdStore } from "../../../Stores/ChatDetailsStore";
    import PinnedRow from "./PinnedRow.svelte";
    import { jumpToMessage, pinnedEntriesStore } from "./Pins";
    import { IconPin } from "@wa-icons";

    /** The "Pinned" group in a chat's details: every pinned message, the latest first. A tap closes the details and goes to it. */
    export let room: ChatRoom;

    const entries = hasPins(room) ? pinnedEntriesStore(room) : readable([]);

    function go(messageId: string) {
        openProfileRoomIdStore.set(undefined);
        openRoomDetailsIdStore.set(undefined);
        // The conversation shows again before it scrolls.
        setTimeout(() => {
            jumpToMessage(room, messageId).catch((error) => console.error(error));
        }, 50);
    }
</script>

{#if $entries.length > 0}
    <div class="pinned-summary flex flex-col gap-0.5 rounded-[14px] p-1" data-testid="pinnedSummary">
        <div
            class="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-[0.72rem] font-bold uppercase tracking-[0.06em] text-white/55"
        >
            <IconPin font-size="13" />
            {$LL.chat.details.pinned()} · {$entries.length}
        </div>
        {#each $entries as entry (entry.id)}
            <PinnedRow message={entry.message} on:click={() => go(entry.id)} />
        {/each}
    </div>
{/if}

<style>
    .pinned-summary {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
</style>
