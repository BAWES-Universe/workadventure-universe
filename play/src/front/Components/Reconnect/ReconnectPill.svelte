<script lang="ts">
    import { fly } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import { softReconnect } from "../../Connection/SoftReconnect";
    import { IconCheck, IconLoader2, IconWifiOff } from "@wa-icons";

    $: pill = $softReconnect?.pill;
</script>

{#if pill}
    <!-- Top centre, where the game's other top pills sit: under the status bar on a phone, under the bar on a desktop.
         It only says what is going on; the room, the bar and the chat stay as they are under it (#958).
         The row centres it, not a transform: fly keeps the transform it read when the pill came in, so the shorter
         "Back in" pill would jump sideways as it leaves. -->
    <div
        class="pointer-events-none fixed inset-x-0 top-[calc(12px+env(safe-area-inset-top))] z-[2100] flex justify-center md:top-[88px]"
    >
        <div
            class="u-surface flex items-center gap-2 whitespace-nowrap rounded-full py-2 pe-4 ps-3 text-sm font-semibold text-white"
            role="status"
            aria-live="polite"
            transition:fly={{ y: -12, duration: 180 }}
            data-testid="reconnect-pill"
            data-state={pill}
        >
            {#if pill === "reconnecting"}
                <IconLoader2 class="reconnect-pill-spin text-[#c4b5fd]" font-size="17" aria-hidden="true" />
                {$LL.warning.reconnectingTitle()}
            {:else if pill === "offline"}
                <IconWifiOff class="text-[#c4b5fd]" font-size="17" aria-hidden="true" />
                {$LL.warning.offlineTitle()}
            {:else}
                <IconCheck class="text-[#4ade80]" font-size="17" aria-hidden="true" />
                {$LL.warning.backIn()}
            {/if}
        </div>
    </div>
{/if}

<style>
    :global(.reconnect-pill-spin) {
        animation: reconnect-pill-spin 1s linear infinite;
    }
    @keyframes reconnect-pill-spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        :global(.reconnect-pill-spin) {
            animation: none;
        }
    }
</style>
