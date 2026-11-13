<script lang="ts">
    import type { Readable } from "svelte/store";
    import LL from "../../../i18n/i18n-svelte";
    import type { ChatMessageContent } from "../Connection/ChatConnection";
    import type { MadeBrick } from "./Brick";
    import { openBrickChat, openingBrickChats } from "./BrickChat";
    import { linksBrickChat } from "./BrickChatLink";

    /**
     * Under an answer in which a Brick made another Brick (game #1996): one tap to the new Brick's chat, for each
     * Brick the answer's own words do not already link to ("Open its chat" inside the sentence is the usual way).
     */
    export let made: MadeBrick[];
    export let content: Readable<ChatMessageContent>;

    $: unlinked = made.filter((brick) => !linksBrickChat($content.body, brick.id));

    function open(brick: MadeBrick) {
        openBrickChat(brick.id).catch((error) => console.error(error));
    }
</script>

{#if unlinked.length > 0}
    <div class="made" data-testid="brickMadeLinks">
        {#each unlinked as brick (brick.id)}
            <button
                type="button"
                class="made-go"
                aria-busy={$openingBrickChats.has(brick.id)}
                data-testid="brickMadeOpen"
                on:click={() => open(brick)}
                >{made.length === 1
                    ? $LL.chat.brick.openItsChat()
                    : $LL.chat.brick.openChatOf({ name: brick.name })}</button
            >
        {/each}
    </div>
{/if}

<style>
    /* Under the answer, in line with its words */
    .made {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 2px 16px 8px 52px;
    }
    :global([dir="rtl"]) .made {
        margin: 2px 52px 8px 16px;
    }
    .made-go {
        min-height: 36px;
        margin: 0;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .made-go:hover {
            background: rgba(255, 255, 255, 0.16);
        }
    }
    .made-go:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    @media (pointer: coarse) {
        .made-go {
            min-height: 44px;
        }
    }
</style>
