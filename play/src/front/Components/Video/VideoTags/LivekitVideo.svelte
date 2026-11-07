<svelte:options immutable={true} />

<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import type { Readable } from "svelte/store";
    import type { RemoteVideoTrack } from "livekit-client";
    import { configureInlineVideoElement } from "../../../Utils/MobileWebViewMediaCompatibility";
    import { NoVideoOutputDetector } from "./NoVideoOutputDetector";

    export let style: string;
    export let className: string;
    export let videoWidth: number;
    export let videoHeight: number;
    export let onLoadVideoElement: (event: Event) => void;

    export let remoteVideoTrack: Readable<RemoteVideoTrack | undefined>;
    let videoElement: HTMLVideoElement;
    let noVideoOutputDetector: NoVideoOutputDetector | undefined;

    let attachedVideoTrack: RemoteVideoTrack | undefined;

    const dispatch = createEventDispatcher<{
        video: undefined;
        noVideo: undefined;
    }>();

    $: {
        if ($remoteVideoTrack && videoElement) {
            // Enforce inline playback attributes before LiveKit attaches the track so iOS WKWebView and Android
            // WebView never hijack the video stream into a native full-screen media overlay.
            configureInlineVideoElement(videoElement);
            if ($remoteVideoTrack !== attachedVideoTrack) {
                if (attachedVideoTrack) {
                    attachedVideoTrack.detach(videoElement);
                }
            }
            attachedVideoTrack = $remoteVideoTrack;
            attachedVideoTrack.attach(videoElement);

            if (noVideoOutputDetector) {
                noVideoOutputDetector.destroy();
            }

            noVideoOutputDetector = new NoVideoOutputDetector(
                videoElement,
                () => {
                    dispatch("noVideo");
                },
                () => {
                    dispatch("video");
                }
            );
        }
    }

    onMount(() => {
        configureInlineVideoElement(videoElement);
    });

    onDestroy(() => {
        if (attachedVideoTrack) {
            attachedVideoTrack.detach(videoElement);
        }
        noVideoOutputDetector?.destroy();
    });
</script>

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
    muted={true}
/>
