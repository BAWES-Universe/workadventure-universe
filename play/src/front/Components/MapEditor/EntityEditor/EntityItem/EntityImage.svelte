<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { IconLoader, IconPhotoOff } from "@wa-icons";

    export let classNames: string | undefined = undefined;
    export let imageSource: string;
    export let imageAlt: string;
    let imageElementRef: HTMLImageElement;

    // A new upload is asked for before map-storage has saved it. While a missing picture is tried again, one steady
    // loader stands in its place: the picture itself is not swapped in and out on every try, so the tile does not
    // jump (#1636). The tries run on a picture outside the page and stop when the tile closes.
    const RETRY_DELAYS_MS = [500, 1000, 2000, 3000, 5000, 8000];
    let state: "showing" | "waiting" | "failed" = "showing";
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let probe: HTMLImageElement | undefined;
    let shownSource = imageSource;

    function stopTrying() {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        if (probe) {
            probe.onload = null;
            probe.onerror = null;
            probe = undefined;
        }
    }

    function tryAgainLater() {
        if (attempt >= RETRY_DELAYS_MS.length) {
            state = "failed";
            return;
        }
        retryTimer = setTimeout(() => {
            attempt += 1;
            const next = new Image();
            next.onload = () => {
                stopTrying();
                state = "showing";
            };
            next.onerror = () => tryAgainLater();
            probe = next;
            next.src = imageSource;
        }, RETRY_DELAYS_MS[attempt]);
    }

    function onImageError() {
        if (state !== "showing") return;
        state = "waiting";
        tryAgainLater();
    }

    // Another object in the same tile starts over.
    $: if (imageSource !== shownSource) {
        shownSource = imageSource;
        stopTrying();
        attempt = 0;
        state = "showing";
    }

    onDestroy(stopTrying);

    const dispatch = createEventDispatcher<{
        onImageLoad: HTMLImageElement;
    }>();
</script>

{#if state === "showing"}
    <img
        loading="lazy"
        draggable="false"
        class={classNames}
        style="image-rendering: pixelated"
        src={imageSource}
        alt={imageAlt}
        on:load={() => dispatch("onImageLoad", imageElementRef)}
        bind:this={imageElementRef}
        on:error={onImageError}
    />
{:else if state === "waiting"}
    <div class="flex items-center justify-center flex-1" data-testid="entityImageLoader">
        <IconLoader class="animate-spin" />
    </div>
{:else}
    <div class="flex items-center justify-center flex-1" data-testid="entityImageError">
        <IconPhotoOff />
    </div>
{/if}
