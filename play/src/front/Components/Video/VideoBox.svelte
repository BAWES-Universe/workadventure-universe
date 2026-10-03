<script lang="ts">
    import { setContext } from "svelte";
    import { writable } from "svelte/store";
    import MediaBox from "../Video/MediaBox.svelte";
    import { highlightedEmbedScreen } from "../../Stores/HighlightedEmbedScreenStore";
    import type { VideoBox } from "../../Space/Space";
    import { oneLineStreamableCollectionStore } from "../../Stores/OneLineStreamableCollectionStore";
    import { playerMovedInTheLast10Seconds } from "../../Stores/VideoLayoutStore";

    export let videoBox: VideoBox;
    export let isOnOneLine: boolean;
    export let oneLineMode: "vertical" | "horizontal";
    export let videoWidth: number;
    export let videoHeight: number | undefined;
    /** On phones (PhoneVideoLayout.ts): shown as a round face rather than a video. */
    export let face = false;
    /** On phones: the spots that show. Videos placed after them are behind the "+N" tile. */
    export let shownCount = Infinity;

    // What is inside the box (the name, the buttons) reads this to draw a face.
    const faceStore = writable(face);
    setContext("videoFace", faceStore);
    $: faceStore.set(face);
    // A face shows who is talking with a ring around it, like the edge on a video.
    $: voiceStore = $streamable?.showVoiceIndicator;
    $: talking = face && voiceStore ? $voiceStore : false;

    const streamable = videoBox.streamable;
    const orderStore = videoBox.displayOrder;

    $: isFirst = $orderStore == 0;

    $: isLast = $orderStore == $oneLineStreamableCollectionStore.length - 1;
</script>

{#if (($highlightedEmbedScreen !== videoBox || $playerMovedInTheLast10Seconds) && (!isOnOneLine || oneLineMode === "horizontal")) || (isOnOneLine && oneLineMode === "vertical" && ($streamable?.displayInPictureInPictureMode ?? false))}
    <div
        style={`order: ${$orderStore}; width: ${videoWidth}px; max-width: ${videoWidth}px;${
            videoHeight ? `height: ${videoHeight}px; max-height: ${videoHeight}px;` : ""
        }`}
        class={` overflow-hidden
        ${
            isOnOneLine
                ? oneLineMode === "horizontal"
                    ? `pointer-events-auto basis-40 shrink-0 min-w-40 grow camera-box ${isFirst ? "ml-auto" : ""} ${
                          isLast ? "mr-auto" : ""
                      }`
                    : "pointer-events-auto basis-40 shrink-0 min-h-24 grow camera-box"
                : "pointer-events-auto shrink-0 camera-box"
        }`}
        class:aspect-video={videoHeight === undefined}
        class:video-face={face}
        class:talking
        class:behind-more={$orderStore >= shownCount}
    >
        <MediaBox {videoBox} />
    </div>
{/if}

<style>
    /* The picture fills the circle (VideoMediaBox covers in face mode); the box's overflow-hidden clips it round. */
    .video-face {
        position: relative;
        border-radius: 9999px;
    }
    /* Inside a face, the video's own frame (a 3px border, square-ish corners) would show as a square in the circle:
       the face's ring below shows who is talking instead. */
    .video-face :global(.border-solid),
    .video-face :global(.rounded-lg) {
        border-width: 0;
        border-radius: 0;
    }
    /* Drawn over the picture: the video and its overlays sit above an outline. */
    .video-face.talking::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 30;
        border-radius: inherit;
        box-shadow: inset 0 0 0 3px #4156f6;
        pointer-events: none;
    }
    .behind-more {
        display: none;
    }
</style>
