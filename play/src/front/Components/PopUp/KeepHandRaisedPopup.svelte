<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import PopUpContainer from "./PopUpContainer.svelte";
    import { IconHandStop } from "@wa-icons";

    /** Keeps the hand up: no more automatic lowering until it goes down. */
    export let keep: () => void;
    /** Time left before the hand goes down, shown as a bar that empties. */
    export let durationMs: number;
</script>

<PopUpContainer reduceOnSmallScreen={true}>
    <div class="flex items-center gap-3 text-left" data-testid="keep-hand-raised">
        <span class="hand flex h-9 w-9 shrink-0 items-center justify-center rounded-full" aria-hidden="true">
            <IconHandStop font-size="20" />
        </span>
        <span>{$LL.say.raiseHand.spoke()}</span>
    </div>
    <div class="countdown mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div class="h-full rounded-full" style:animation-duration="{durationMs}ms" />
    </div>
    <svelte:fragment slot="buttons">
        <button
            type="button"
            class="btn btn-secondary w-full max-w-80 justify-center responsive-message"
            data-testid="keep-hand-raised-button"
            on:click|preventDefault={() => keep()}>{$LL.say.raiseHand.keepRaised()}</button
        >
    </svelte:fragment>
</PopUpContainer>

<style lang="scss">
    .hand {
        color: #f5c451;
        background: rgba(245, 196, 81, 0.14);
        box-shadow: inset 0 0 0 1.5px rgba(245, 196, 81, 0.7);
    }
    .countdown div {
        background: #f5c451;
        transform-origin: left;
        animation-name: empty;
        animation-timing-function: linear;
        animation-fill-mode: forwards;
    }
    :global([dir="rtl"]) .countdown div {
        transform-origin: right;
    }
    @keyframes empty {
        from {
            transform: scaleX(1);
        }
        to {
            transform: scaleX(0);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .countdown {
            display: none;
        }
    }
</style>
