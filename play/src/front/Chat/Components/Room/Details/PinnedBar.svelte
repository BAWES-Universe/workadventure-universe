<script lang="ts">
    import { readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { ChatRoom, ChatRoomPins } from "../../../Connection/ChatConnection";
    import { badgeOfKind, fileKindOf } from "../../../../FileViewer/fileKinds";
    import { pinnedText } from "./PinnedSummaryText";
    import { jumpToMessage, pinnedEntriesStore } from "./Pins";
    import { IconPin } from "@wa-icons";

    /**
     * The bar under a chat's header while it has pinned messages: one at a time, the latest first. A tap goes to it in
     * the conversation and the bar moves on to the next one; "All" opens the chat's details with every pin.
     */
    export let room: ChatRoom & ChatRoomPins;
    export let onShowAll: () => void;

    const entries = pinnedEntriesStore(room);
    const pinnedIds = room.pinnedMessageIds;
    const emptyContent = { body: "", url: undefined, urls: undefined, filename: undefined, fileNames: undefined };
    let index = 0;

    // A message pinned just now is the one the bar shows: the latest pin is first.
    let knownIds: string[] | undefined;
    $: {
        if (knownIds && $pinnedIds.some((id) => !knownIds?.includes(id))) index = 0;
        knownIds = $pinnedIds;
    }

    $: count = $entries.length;
    $: if (index >= count) index = 0;
    $: entry = $entries[index];
    $: message = entry?.message;
    $: content = message?.content ?? readable(emptyContent);
    $: text = message ? pinnedText(message, $content, $LL) : $LL.chat.details.pinnedLoading();
    $: fileName = message?.sharedFile?.name ?? "";
    $: kind = fileKindOf(fileName);
    $: badge = kind ? badgeOfKind(kind, fileName) : { color: "#757575", label: "FILE", kindName: "File" };
    $: label = count > 1 ? $LL.chat.details.pinnedOf({ index: index + 1, count }) : $LL.chat.details.pinned();

    function go() {
        if (!entry) return;
        const id = entry.id;
        index = count > 0 ? (index + 1) % count : 0;
        jumpToMessage(room, id).catch((error) => console.error(error));
    }
</script>

{#if count > 0}
    <div class="pinned-bar mx-2 flex items-center gap-1 rounded-xl" data-testid="pinnedBar">
        <button
            type="button"
            class="pinned-go m-0 flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 ps-2 pe-1 text-start"
            title={$LL.chat.details.nextPin()}
            on:click={go}
            data-testid="pinnedBarGo"
        >
            {#if count > 1}
                <span class="flex h-8 shrink-0 flex-col gap-0.5" aria-hidden="true">
                    {#each $entries as pin, tickIndex (pin.id)}
                        <span class="pinned-tick w-[3px] flex-1 rounded-full" class:current={tickIndex === index} />
                    {/each}
                </span>
            {/if}
            {#if message?.type === "image" && $content.url}
                <img class="h-8 w-8 shrink-0 rounded-md object-cover" src={$content.url} alt="" draggable="false" />
            {:else if message?.type === "file" || message?.type === "audio"}
                <span
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[8px] font-bold text-white"
                    style="background: {badge.color};"
                    aria-hidden="true">{badge.label}</span
                >
            {:else}
                <span class="grid h-8 w-6 shrink-0 place-items-center text-white/70" aria-hidden="true"
                    ><IconPin font-size="16" /></span
                >
            {/if}
            <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-[11px] font-bold text-white/60">{label}</span>
                <span class="truncate text-sm text-white/90">{text}</span>
            </span>
        </button>
        <button
            type="button"
            class="pinned-all m-0 h-11 shrink-0 rounded-xl px-3 text-xs font-bold text-white/80"
            aria-label={$LL.chat.details.allPinsLabel()}
            on:click={onShowAll}
            data-testid="pinnedBarAll"
        >
            {$LL.chat.details.allPins()}
        </button>
    </div>
{/if}

<style>
    .pinned-bar {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .pinned-go,
    .pinned-all {
        font-family: inherit;
        background: transparent;
    }
    .pinned-go:hover,
    .pinned-all:hover {
        background: rgba(255, 255, 255, 0.06);
    }
    .pinned-go:focus-visible,
    .pinned-all:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
    .pinned-tick {
        background: rgba(255, 255, 255, 0.25);
    }
    .pinned-tick.current {
        background: #c4b5fd;
    }
</style>
