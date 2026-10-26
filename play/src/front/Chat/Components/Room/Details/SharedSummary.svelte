<script lang="ts">
    import LL from "../../../../../i18n/i18n-svelte";
    import type { ChatRoom } from "../../../Connection/ChatConnection";
    import { openSharedItemsStore } from "../../../Stores/ChatDetailsStore";
    import MediaThumb from "./MediaThumb.svelte";
    import { sharedItemsStore } from "./SharedItemsStore";
    import { firstFilledTab } from "./SharedItems";
    import { sharedSender } from "./sharedSender";
    import { IconChevronLeft, IconChevronRight } from "@wa-icons";

    /**
     * The "Media, links and files" group in a chat's details: how many things the chat shared, and its latest images
     * and videos. A tap opens the page with all of them.
     */
    export let room: ChatRoom;

    const THUMBS = 4;
    const shared = sharedItemsStore(room);
    const direction = document.documentElement.getAttribute("dir") || "ltr";

    $: total = $shared.media.length + $shared.links.length + $shared.files.length;
    $: thumbs = $shared.media.slice(0, THUMBS);
    $: more = $shared.media.length - THUMBS;

    function open() {
        openSharedItemsStore.set({ roomId: room.id, tab: firstFilledTab($shared) });
    }
</script>

<div class="shared-summary flex flex-col gap-1 rounded-[14px] p-1" data-testid="sharedSummary">
    <button type="button" class="u-menu-row !m-0" data-testid="sharedSummaryOpen" on:click={open}>
        <span class="u-menu-label flex-1 truncate">{$LL.chat.details.shared()}</span>
        <span class="text-xs tabular-nums text-white/60" data-testid="sharedSummaryCount">{total}</span>
        <span class="u-menu-tile !w-6">
            {#if direction === "rtl"}
                <IconChevronLeft />
            {:else}
                <IconChevronRight />
            {/if}
        </span>
    </button>
    {#if thumbs.length > 0}
        <div class="grid grid-cols-4 gap-1.5 px-1.5 pb-1.5">
            {#each thumbs as item, index (item.key)}
                {@const sender = sharedSender(item.message, $LL.chat.details.you())}
                <div class="relative">
                    <MediaThumb
                        message={item.message}
                        label={item.message.type === "video"
                            ? $LL.chat.details.video({ name: sender })
                            : $LL.chat.details.image({ name: sender })}
                        on:click={open}
                    />
                    {#if index === THUMBS - 1 && more > 0}
                        <span
                            class="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-black/55 text-sm font-bold text-white"
                            aria-hidden="true">+{more}</span
                        >
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .shared-summary {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
</style>
