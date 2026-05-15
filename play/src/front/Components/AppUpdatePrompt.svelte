<script lang="ts">
    import { onMount } from "svelte";
    import { IconXIcon } from "@wa-icons";
    import {
        appUpdateStore,
        applyServiceWorkerUpdate,
        checkNativeAppVersion,
        dismissServiceWorkerUpdate,
        openNativeUpdateUrl,
    } from "../Stores/AppUpdateStore";

    onMount(() => {
        void checkNativeAppVersion();

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void checkNativeAppVersion();
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    });
</script>

{#if $appUpdateStore.native.blocking}
    <div class="fixed inset-0 z-[12000] flex items-center justify-center bg-black/80 px-4 pointer-events-auto">
        <section
            class="w-full max-w-md rounded bg-contrast text-white p-6 shadow-2xl border border-white/20"
            role="dialog"
            aria-modal="true"
            aria-labelledby="native-update-title"
        >
            <h2 id="native-update-title" class="font-bold text-xl mb-3">Update required</h2>
            <p class="text-sm leading-6 mb-5">
                This app version is no longer supported. Install the latest BAWES Universe app to continue.
            </p>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm mb-6">
                <dt class="opacity-70">Current</dt>
                <dd>{$appUpdateStore.native.currentVersion}</dd>
                <dt class="opacity-70">Minimum</dt>
                <dd>{$appUpdateStore.native.minVersion}</dd>
            </dl>
            {#if $appUpdateStore.native.updateUrl}
                <button
                    type="button"
                    class="light w-full cursor-pointer px-3 py-2"
                    on:click={() => openNativeUpdateUrl($appUpdateStore.native.updateUrl)}
                >
                    Update app
                </button>
            {/if}
        </section>
    </div>
{:else if $appUpdateStore.serviceWorkerUpdateAvailable}
    <div class="fixed top-4 left-0 right-0 z-[1100] flex justify-center px-3 pointer-events-auto">
        <div
            class="flex max-w-[min(92vw,520px)] items-center gap-3 rounded bg-contrast text-white px-4 py-3 shadow-xl border border-white/20"
            role="status"
        >
            <p class="min-w-0 flex-1 text-sm">A fresh version is ready.</p>
            <button type="button" class="light shrink-0 cursor-pointer px-3 py-1" on:click={applyServiceWorkerUpdate}>
                Reload
            </button>
            <button
                type="button"
                class="shrink-0 cursor-pointer text-white/70 hover:text-white px-2"
                aria-label="Dismiss update notice"
                on:click={dismissServiceWorkerUpdate}
            >
                <IconXIcon stroke={1} font-size="16" class="text-white" />
            </button>
        </div>
    </div>
{/if}
