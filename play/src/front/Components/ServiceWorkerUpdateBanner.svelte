<script lang="ts">
    import { LL } from "../../i18n/i18n-svelte";
    import { serviceWorkerUpdateStore } from "../Stores/ServiceWorkerUpdateStore";

    function reload(): void {
        $serviceWorkerUpdateStore?.reload();
    }

    function dismiss(): void {
        serviceWorkerUpdateStore.set(undefined);
    }
</script>

<div class="service-worker-update-banner" role="status" aria-live="polite">
    <span>{$LL.refreshPrompt.serviceWorkerUpdate.message()}</span>
    <div class="actions">
        <button type="button" class="light" on:click={reload}>{$LL.refreshPrompt.serviceWorkerUpdate.reload()}</button>
        <button
            type="button"
            class="light outline"
            aria-label={$LL.refreshPrompt.serviceWorkerUpdate.dismissLabel()}
            on:click={dismiss}>{$LL.refreshPrompt.serviceWorkerUpdate.later()}</button
        >
    </div>
</div>

<style>
    .service-worker-update-banner {
        position: fixed;
        left: 50%;
        bottom: max(1rem, env(safe-area-inset-bottom));
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        transform: translateX(-50%);
        max-width: min(92vw, 34rem);
        padding: 0.75rem 1rem;
        border: 1px solid rgb(255 255 255 / 20%);
        border-radius: 0.5rem;
        background: rgb(0 0 0 / 88%);
        color: white;
        font-family: "Roboto", sans-serif;
        pointer-events: auto;
    }

    .service-worker-update-banner span {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .actions {
        display: flex;
        flex-shrink: 0;
        gap: 0.5rem;
    }

    @media (max-width: 480px) {
        .service-worker-update-banner {
            align-items: stretch;
            flex-direction: column;
        }

        .actions {
            justify-content: flex-end;
        }
    }
</style>
