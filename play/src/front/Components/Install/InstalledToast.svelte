<script lang="ts">
    import { fly } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import { installApp } from "../../Install/InstallWiring";
    import { IconCheck } from "@wa-icons";

    const { installedToastStore } = installApp;
</script>

<!-- A short note after the app was added: "Universe is on your home screen". It goes by itself. -->
{#if $installedToastStore}
    <div
        class="u-surface pointer-events-auto absolute left-0 right-0 top-14 mobile:portrait:top-[calc(56px+env(safe-area-inset-top))] z-[650] mx-auto flex w-fit max-w-[calc(100vw-1.5rem)] items-center gap-2.5 rounded-full py-2 pl-2 pr-4 text-sm font-semibold text-white md:top-[88px]"
        role="status"
        data-testid="install-installed-toast"
        transition:fly={{ y: -50, duration: 300 }}
    >
        <span
            class="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
            aria-hidden="true"><IconCheck font-size="16" /></span
        >
        {$LL.install.installed()}
    </div>
{/if}
