<script lang="ts">
    import { fly } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import { linkCopiedToastStore } from "../../Stores/LinkCopiedToastStore";
    import { IconCheck } from "@wa-icons";
</script>

{#if $linkCopiedToastStore}
    <!-- A short note where the reconnect note sits (top centre), with nothing to press: it goes away by itself. -->
    <div
        class="pointer-events-none fixed inset-x-0 top-[calc(12px+env(safe-area-inset-top))] z-[2100] flex justify-center md:top-[88px]"
    >
        <div
            class="u-surface flex items-center gap-2 whitespace-nowrap rounded-full py-2 pe-4 ps-3 text-sm font-semibold text-white"
            role="status"
            aria-live="polite"
            transition:fly={{ y: -12, duration: 180 }}
            data-testid="linkCopiedToast"
        >
            <IconCheck class="text-[#4ade80]" font-size="17" aria-hidden="true" />
            {$LL.notification.urlCopiedToClipboard()}
        </div>
    </div>
{/if}
