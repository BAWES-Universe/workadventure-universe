<script lang="ts">
    import { fly } from "svelte/transition";
    import { chatDoneToastStore } from "../../Stores/ChatDoneToastStore";
    import { IconCheck } from "@wa-icons";
</script>

{#if $chatDoneToastStore}
    <!-- Where "Link copied" sits (top centre), with the look of "Report sent". Nothing to press: it goes by itself. -->
    <div
        class="pointer-events-none fixed inset-x-0 top-[calc(12px+env(safe-area-inset-top))] z-[2100] flex justify-center md:top-[88px]"
    >
        <div
            class="u-surface box-border flex min-w-0 max-w-[calc(100vw-1.5rem)] items-center gap-2.5 whitespace-nowrap rounded-full py-2 pe-4 ps-2 text-sm font-semibold text-white"
            role="status"
            aria-live="polite"
            transition:fly={{ y: -12, duration: 180 }}
            data-testid="chatDoneToast"
        >
            <span
                class="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
                aria-hidden="true"><IconCheck font-size="16" /></span
            >
            <!-- A long name is cut with "…" so the note stays on one line. -->
            <span class="min-w-0 truncate">{$chatDoneToastStore.text}</span>
        </div>
    </div>
{/if}
