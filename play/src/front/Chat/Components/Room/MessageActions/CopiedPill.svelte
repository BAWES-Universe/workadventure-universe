<script lang="ts">
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import LL from "../../../../../i18n/i18n-svelte";
    import { copiedPillStore } from "../../../Stores/CopiedPillStore";

    /**
     * The small "Copied" pill over the bottom of the conversation, like other chat apps: no logo, nothing to press,
     * gone after a moment. Copying again while it shows keeps it up a little longer.
     */
    const SHOWN_MS = 1500;

    let visible = false;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    // The copies made before this chat opened are not shown.
    let seen: number | undefined;

    const unsubscribe = copiedPillStore.subscribe((copies) => {
        if (seen === undefined || copies === seen) {
            seen = copies;
            return;
        }
        seen = copies;
        visible = true;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => (visible = false), SHOWN_MS);
    });

    onDestroy(() => {
        unsubscribe();
        clearTimeout(hideTimer);
    });
</script>

<div class="pointer-events-none relative z-10 h-0" role="status" aria-live="polite">
    {#if visible}
        <div class="copied-pill" data-testid="copiedPill" transition:fly={{ y: 8, duration: 160 }}>
            {$LL.chat.messageActions.textCopied()}
        </div>
    {/if}
</div>

<style>
    .copied-pill {
        position: absolute;
        bottom: 0.75rem;
        left: 50%;
        translate: -50% 0;
        padding: 0.4rem 0.9rem;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 700;
        line-height: 1.1rem;
        white-space: nowrap;
        color: #fff;
        background: rgb(28 24 42 / 0.94);
        border: 1px solid rgb(255 255 255 / 0.14);
        box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.7);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
    }
</style>
