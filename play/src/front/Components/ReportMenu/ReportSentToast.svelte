<script lang="ts">
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { reportSentToastStore } from "../../Stores/ShowReportScreenStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconCheck } from "@wa-icons";

    // A short note where the popup was, gone after a few seconds.
    const TOAST_MS = 4000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    $: if ($reportSentToastStore !== undefined) {
        clearTimeout(timer);
        timer = setTimeout(() => reportSentToastStore.set(undefined), TOAST_MS);
    }
    onDestroy(() => clearTimeout(timer));
</script>

{#if $reportSentToastStore !== undefined}
    <div
        class="u-surface pointer-events-auto absolute left-0 right-0 top-3 md:top-16 z-[650] mx-auto flex w-fit max-w-[calc(100vw-1.5rem)] items-center gap-2.5 rounded-full py-2 pl-2 pr-4 text-sm font-semibold text-white"
        role="status"
        data-testid="report-sent-toast"
        transition:fly={{ y: -50, duration: 300 }}
    >
        <span
            class="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
            aria-hidden="true"><IconCheck font-size="16" /></span
        >
        {$LL.report.popup.report.sent({ worldName: $reportSentToastStore })}
    </div>
{/if}
