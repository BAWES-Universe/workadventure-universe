<script lang="ts">
    import { fly } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import { installApp } from "../../Install/InstallWiring";
    import { installIconSrc } from "../../Install/InstallIcon";
    import { IconX } from "@wa-icons";

    const { cardVisibleStore } = installApp;
    const iconSrc = installIconSrc();
</script>

<!-- The install card: a small raised note at the top, under the bar on a computer. Never blocks the map: the page
     around it stays playable, and ✕ closes it for now (it comes back later, see InstallApp). -->
{#if $cardVisibleStore}
    <div
        class="u-surface pointer-events-auto absolute left-2 right-2 top-[calc(8px+env(safe-area-inset-top))] z-[650] flex items-center gap-3 rounded-[20px] py-3 pl-3.5 pr-2 text-white md:left-1/2 md:right-auto md:top-[88px] md:w-[440px] md:-translate-x-1/2"
        role="region"
        aria-label={$LL.install.card.title()}
        data-testid="install-card"
        transition:fly={{ y: -50, duration: 300 }}
    >
        {#if iconSrc}
            <img class="h-11 w-11 flex-none rounded-[22%]" src={iconSrc} alt="" />
        {/if}
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <b class="text-[15px] leading-tight">{$LL.install.card.title()}</b>
            <span class="text-[12.5px] leading-snug text-white/65">{$LL.install.card.text()}</span>
        </div>
        <button
            type="button"
            class="u-cta flex min-h-[44px] flex-none items-center justify-center rounded-full px-4 text-sm font-bold"
            data-testid="install-card-install"
            on:click={() => void installApp.install("card")}
        >
            {$LL.install.card.install()}
        </button>
        <button
            type="button"
            class="u-close"
            aria-label={$LL.install.card.close()}
            data-testid="install-card-close"
            on:click={() => installApp.dismissCard()}
        >
            <IconX font-size="18" aria-hidden="true" />
        </button>
    </div>
{/if}
