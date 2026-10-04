<script lang="ts">
    import type { AvailabilityStatus } from "@workadventure/messages";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { outgoingRingsStore, ringClockStore, ringStore } from "../../Stores/RingStore";
    import PersonActionButton from "./PersonActionButton.svelte";
    import { ringButton } from "./Ring";
    import { IconBell, IconBellOff, IconBellRinging, IconX } from "@wa-icons";

    /**
     * Ring a friend: they get a card asking them to come over. While it rings this is Stop; when they are busy, on
     * their way, or were just rung without coming, it is greyed out and says why.
     */
    export let uuid: string;
    export let name: string;
    export let status: AvailabilityStatus | undefined;
    /** A 40px icon button in People rows, or a small labelled pill. */
    export let variant: "icon" | "pill" = "icon";
    export let testId = `ring-${name}`;

    $: state = ringButton($outgoingRingsStore.get(uuid), status, $ringClockStore);
    $: label =
        state.kind === "stop"
            ? $LL.chat.friends.ring.stop()
            : state.kind === "busy"
            ? $LL.chat.friends.ring.busy()
            : state.kind === "wait"
            ? $LL.chat.friends.ring.ringAgainIn({ minutes: state.minutes })
            : state.kind === "onTheWay"
            ? $LL.chat.friends.ring.onTheWay()
            : $LL.chat.friends.ring.ring();
    $: ariaLabel =
        state.kind === "stop"
            ? $LL.chat.friends.ring.stopRinging({ userName: name })
            : state.kind === "busy"
            ? $LL.chat.friends.ring.busyUser({ userName: name })
            : state.kind === "wait" || state.kind === "onTheWay"
            ? `${$LL.chat.friends.ring.ringUser({ userName: name })}. ${label}`
            : $LL.chat.friends.ring.ringUser({ userName: name });
    $: disabled = state.kind !== "ring" && state.kind !== "stop";

    function click() {
        if (state.kind === "stop") {
            ringStore.stop(uuid).catch((e) => console.error(e));
        } else if (state.kind === "ring") {
            ringStore.ring(uuid, name).catch((e) => console.error(e));
        }
    }
</script>

{#if variant === "icon"}
    <PersonActionButton
        {label}
        {ariaLabel}
        {testId}
        {disabled}
        class={state.kind === "stop" ? "ring-stop" : ""}
        on:click={click}
    >
        {#if state.kind === "stop"}
            <IconX font-size="20" />
        {:else if state.kind === "starting"}
            <IconBellRinging font-size="20" class="ring-wiggle" />
        {:else if disabled}
            <IconBellOff font-size="20" />
        {:else}
            <IconBell font-size="20" />
        {/if}
    </PersonActionButton>
{:else}
    <button
        type="button"
        class="u-cta-secondary m-0 flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-white disabled:opacity-60"
        aria-label={ariaLabel}
        {disabled}
        data-testid={testId}
        on:click|stopPropagation={click}
    >
        {#if state.kind === "stop"}
            <IconX font-size="14" />
        {:else if state.kind === "starting"}
            <IconBellRinging font-size="14" class="ring-wiggle" />
        {:else if disabled}
            <IconBellOff font-size="14" />
        {:else}
            <IconBell font-size="14" />
        {/if}
        {label}
    </button>
{/if}

<style>
    :global(.ring-stop) {
        background: rgba(233, 109, 81, 0.22) !important;
        color: #ffd9cf !important;
    }
    :global(.ring-stop:hover) {
        background: rgba(233, 109, 81, 0.36) !important;
    }
    :global(.ring-wiggle) {
        animation: ring-wiggle 0.9s ease-in-out infinite;
        transform-origin: 50% 10%;
    }
    @keyframes ring-wiggle {
        0%,
        100% {
            transform: rotate(0);
        }
        20% {
            transform: rotate(14deg);
        }
        40% {
            transform: rotate(-12deg);
        }
        60% {
            transform: rotate(8deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        :global(.ring-wiggle) {
            animation: none;
        }
    }
</style>
