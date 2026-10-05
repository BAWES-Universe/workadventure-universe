<script lang="ts">
    import { onDestroy } from "svelte";
    import type { ChatMessageReaction } from "../../Connection/ChatConnection";
    import Reaction from "./Reaction.svelte";
    export let reactions: ChatMessageReaction[];
    export let classes = "";

    let bar: HTMLDivElement;
    // Who reacted, shown above a chip held on a phone. It is drawn here, outside the scrolling row, which would clip it.
    let who: { text: string; left: number } | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    function showWho(event: CustomEvent<{ text: string; chip: HTMLElement }>) {
        const left = event.detail.chip.getBoundingClientRect().left - bar.getBoundingClientRect().left;
        who = { text: event.detail.text, left: Math.max(0, left) };
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hideWho, 2500);
    }

    function hideWho() {
        clearTimeout(hideTimer);
        who = undefined;
    }

    onDestroy(() => clearTimeout(hideTimer));
</script>

<div bind:this={bar} class="reactions-bar empty:hidden absolute -bottom-4 {classes}">
    <!-- Many reactions on a short message scroll sideways instead of running over the messages around it. A finger on
         the row scrolls it rather than starting a press-and-hold or a swipe on the message. -->
    <div class="reactions-row flex flex-row flex-nowrap gap-1" on:scroll={hideWho} on:pointerdown|stopPropagation>
        {#each reactions as reaction (reaction.key)}
            <Reaction {reaction} on:showWho={showWho} />
        {/each}
    </div>
    {#if who}
        <span class="who" style="left: {who.left}px" role="status">{who.text}</span>
    {/if}
</div>

<style lang="scss">
    .reactions-bar {
        max-width: calc(100% + 15px);
    }

    .reactions-row {
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-x: contain;
        // Room for the chips' pop-in and hover border, which the hidden vertical overflow would otherwise cut.
        padding: 4px;
        margin: -4px;
        scrollbar-width: none;
        -ms-overflow-style: none;

        &::-webkit-scrollbar {
            display: none;
        }
    }

    .who {
        position: absolute;
        bottom: calc(100% + 6px);
        z-index: 10;
        width: max-content;
        max-width: 220px;
        padding: 6px 10px;
        border-radius: 8px;
        font-size: 12px;
        color: #fff;
        background: #000;
        white-space: normal;
    }
</style>
