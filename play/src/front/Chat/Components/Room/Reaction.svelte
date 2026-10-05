<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { ChatMessageReaction } from "../../Connection/ChatConnection";
    import LL from "../../../../i18n/i18n-svelte";
    import { LONG_PRESS_MS } from "./MessageActions/messageGestures";

    export let reaction: ChatMessageReaction;

    const dispatch = createEventDispatcher<{ showWho: { text: string; chip: HTMLElement } }>();

    const { reacted, key, users } = reaction;

    $: names = Array.from($users.values())
        .map((user) => user.username)
        .filter((name): name is string => !!name)
        .join(", ");
    $: whoReacted = $LL.chat.messageActions.reactedBy({ emoji: key, names });

    // Holding a chip on a phone shows who reacted (the reactions bar draws it, outside its scrolling row); a mouse
    // gets the same text as a tooltip.
    let chip: HTMLButtonElement;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let held = false;

    function onPointerDown(event: PointerEvent) {
        if (event.pointerType === "mouse") return;
        held = false;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
            held = true;
            dispatch("showWho", { text: whoReacted, chip });
        }, LONG_PRESS_MS);
    }

    function cancelHold() {
        clearTimeout(holdTimer);
    }

    function onClick() {
        if (held) {
            held = false;
            return;
        }
        reaction.react();
    }
</script>

{#if $users.size > 0}
    <button
        bind:this={chip}
        on:click|stopPropagation={onClick}
        on:pointerdown|stopPropagation={onPointerDown}
        on:pointerup={cancelHold}
        on:pointercancel={cancelHold}
        on:pointerleave={cancelHold}
        on:contextmenu|preventDefault|stopPropagation
        class="reaction"
        class:reacted={$reacted}
        title={whoReacted}
        aria-label={whoReacted}
        aria-pressed={$reacted}
        data-testid={`${key}_reactionButton`}
    >
        <span class="emoji">{key}</span>
        <span class="count">{$users.size}</span>
    </button>
{/if}

<style lang="scss">
    @keyframes fall-in {
        0% {
            opacity: 0;
            transform: translateY(12px) scale(0.6);
        }
        60% {
            transform: translateY(0) scale(1.15);
        }
        100% {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }

    .reaction {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 24px;
        padding: 0 8px;
        border-radius: 9999px;
        font-size: 12px;
        line-height: 1;
        color: #fff;
        white-space: nowrap;
        background: rgb(28 26 40 / 0.95);
        border: 1px solid rgb(255 255 255 / 0.1);
        animation: fall-in 0.35s cubic-bezier(0.6, 0.02, 0.53, 1.33);
        -webkit-touch-callout: none;
        user-select: none;
    }

    .reaction:hover,
    .reaction:focus-visible {
        border-color: rgb(255 255 255 / 0.25);
        outline: none;
    }

    .reaction.reacted {
        background: rgb(134 41 252 / 0.28);
        border-color: rgb(167 139 250 / 0.5);
    }

    .count {
        font-variant-numeric: tabular-nums;
    }

    .reaction.reacted .count {
        font-weight: 700;
    }

    @media (prefers-reduced-motion: reduce) {
        .reaction {
            animation: none;
        }
    }
</style>
