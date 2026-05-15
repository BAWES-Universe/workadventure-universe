<script lang="ts">
    import { nativeUpdateStore } from "../Stores/NativeUpdateStore";

    function openUpdate(): void {
        if ($nativeUpdateStore?.updateUrl) {
            window.location.assign($nativeUpdateStore.updateUrl);
        }
    }

    function dismiss(): void {
        if (!$nativeUpdateStore?.blocking) {
            nativeUpdateStore.set(undefined);
        }
    }

    function reload(): void {
        window.location.reload();
    }
</script>

{#if $nativeUpdateStore?.blocking}
    <div class="native-update-backdrop">
        <section class="native-update-modal" aria-modal="true" role="dialog">
            <h2>Please update the app</h2>
            <p>
                Version {$nativeUpdateStore.currentVersion} is no longer supported. Update to
                {$nativeUpdateStore.requiredVersion} or newer to continue.
            </p>
            {#if $nativeUpdateStore.updateUrl}
                <button type="button" class="light" on:click={openUpdate}>Update app</button>
            {:else}
                <button type="button" class="light" on:click={reload}>Try again</button>
            {/if}
        </section>
    </div>
{:else if $nativeUpdateStore}
    <div class="native-update-banner" role="status" aria-live="polite">
        <span>New app version {$nativeUpdateStore.latestVersion} is available.</span>
        <div class="actions">
            {#if $nativeUpdateStore.updateUrl}
                <button type="button" class="light" on:click={openUpdate}>Update</button>
            {/if}
            <button type="button" class="light outline" aria-label="Dismiss native update prompt" on:click={dismiss}
                >Later</button
            >
        </div>
    </div>
{/if}

<style>
    .native-update-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10002;
        display: grid;
        place-items: center;
        padding: 1rem;
        background: rgb(0 0 0 / 72%);
        pointer-events: auto;
    }

    .native-update-modal,
    .native-update-banner {
        border: 1px solid rgb(255 255 255 / 20%);
        border-radius: 0.5rem;
        background: rgb(0 0 0 / 90%);
        color: white;
        font-family: "Roboto", sans-serif;
        pointer-events: auto;
    }

    .native-update-modal {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        width: min(92vw, 28rem);
        padding: 1.25rem;
    }

    .native-update-modal h2 {
        margin: 0;
        font-size: 1.4rem;
    }

    .native-update-modal p {
        margin: 0;
        overflow-wrap: anywhere;
    }

    .native-update-modal button {
        align-self: flex-end;
    }

    .native-update-banner {
        position: fixed;
        left: 50%;
        top: max(1rem, env(safe-area-inset-top));
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        transform: translateX(-50%);
        max-width: min(92vw, 34rem);
        padding: 0.75rem 1rem;
    }

    .native-update-banner span {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .actions {
        display: flex;
        flex-shrink: 0;
        gap: 0.5rem;
    }

    @media (max-width: 480px) {
        .native-update-banner {
            align-items: stretch;
            flex-direction: column;
        }

        .actions {
            justify-content: flex-end;
        }
    }
</style>
