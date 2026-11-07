<svelte:options immutable={true} />

<script lang="ts">
    import { onMount } from "svelte";
    import type { ScriptingVideoStreamable } from "../../../Stores/StreamableCollectionStore";
    import { configureInlineVideoElement } from "../../../Utils/MobileWebViewMediaCompatibility";

    export let style: string;
    export let className: string;
    export let videoWidth: number;
    export let videoHeight: number;
    export let onLoadVideoElement: (event: Event) => void;

    export let media: ScriptingVideoStreamable;
    let videoElement: HTMLVideoElement;

    onMount(() => {
        configureInlineVideoElement(videoElement);
    });
</script>

<!-- svelte-ignore a11y-media-has-caption -->
<video
    {style}
    bind:videoWidth
    bind:videoHeight
    bind:this={videoElement}
    on:loadedmetadata={onLoadVideoElement}
    class={className}
    autoplay
    playsinline
    webkit-playsinline="true"
    src={media.url}
    loop={media.config.loop}
/>
