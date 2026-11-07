<script lang="ts">
    import { fly } from "svelte/transition";
    import { appUpdateManager } from "../../Update/AppUpdateManager";
    import { IconX } from "@wa-icons";

    const { swUpdateAvailableStore, nativeUpdateStore } = appUpdateManager;
</script>

<!-- Blocking modal when the installed native shell version is below the server minimum (`nativeVersion < minNativeVersion`). -->
{#if $nativeUpdateStore?.kind === "forced"}
    <div
        class="pointer-events-auto fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4 text-white backdrop-blur-sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="forced-update-title"
        aria-describedby="forced-update-description"
        data-testid="forced-update-modal"
    >
        <div
            class="u-surface flex w-full max-w-md flex-col gap-4 rounded-2xl p-6 text-center shadow-2xl"
            transition:fly={{ y: 20, duration: 250 }}
        >
            <h2 id="forced-update-title" class="text-xl font-bold leading-snug">Please update the app</h2>
            <p id="forced-update-description" class="text-sm leading-relaxed text-white/75">
                Your installed app version ({$nativeUpdateStore.currentVersion}) is older than the minimum required
                version ({$nativeUpdateStore.targetVersion}). Please update from the store to continue into BAWES
                Universe.
            </p>
            <a
                href={$nativeUpdateStore.storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="u-cta inline-flex min-h-[44px] items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white no-underline"
                data-testid="forced-update-link"
            >
                Update in Store
            </a>
        </div>
    </div>
{:else if $nativeUpdateStore?.kind === "optional"}
    <!-- Dismissible non-blocking banner when a newer native shell release is available (`nativeVersion < latestNativeVersion`). -->
    <div
        class="u-surface pointer-events-auto fixed left-2 right-2 top-[calc(8px+env(safe-area-inset-top))] z-[700] flex items-center gap-3 rounded-[20px] py-2.5 pl-4 pr-2 text-white md:left-1/2 md:right-auto md:top-[88px] md:w-[440px] md:-translate-x-1/2"
        role="status"
        aria-live="polite"
        data-testid="optional-update-banner"
        transition:fly={{ y: -40, duration: 250 }}
    >
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <b class="text-sm leading-tight">New version available</b>
            <span class="text-xs leading-snug text-white/65">
                Version {$nativeUpdateStore.targetVersion} is ready in the store.
            </span>
        </div>
        <a
            href={$nativeUpdateStore.storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="u-cta flex min-h-[36px] flex-none items-center justify-center rounded-full px-4 text-xs font-bold text-white no-underline"
            data-testid="optional-update-link"
        >
            Update
        </a>
        <button
            type="button"
            class="u-close"
            aria-label="Dismiss update notice"
            data-testid="optional-update-dismiss"
            on:click={() => appUpdateManager.dismissOptionalNativeBanner()}
        >
            <IconX font-size="18" aria-hidden="true" />
        </button>
    </div>
{/if}

<!-- Non-blocking banner shown when a new Service Worker claims control (`controllerchange`). -->
{#if $swUpdateAvailableStore && $nativeUpdateStore?.kind !== "forced"}
    <div
        class="u-surface pointer-events-auto fixed left-1/2 top-[calc(12px+env(safe-area-inset-top))] z-[690] flex w-fit max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full py-2 pl-4 pr-2 text-sm font-semibold text-white md:top-[88px]"
        role="status"
        aria-live="polite"
        data-testid="sw-update-banner"
        transition:fly={{ y: -40, duration: 250 }}
    >
        <button
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-white underline-offset-2 hover:underline"
            data-testid="sw-update-reload"
            on:click={() => appUpdateManager.applyServiceWorkerReload()}
        >
            Game updated — tap to reload
        </button>
        <button
            type="button"
            class="u-close"
            aria-label="Dismiss reload notice"
            data-testid="sw-update-dismiss"
            on:click={() => appUpdateManager.dismissServiceWorkerBanner()}
        >
            <IconX font-size="16" aria-hidden="true" />
        </button>
    </div>
{/if}
