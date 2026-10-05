<script lang="ts">
    import { setContext } from "svelte";
    import { writable } from "svelte/store";
    import MediaBox from "../Video/MediaBox.svelte";
    import { highlightedEmbedScreen } from "../../Stores/HighlightedEmbedScreenStore";
    import type { VideoBox } from "../../Space/Space";
    import { oneLineStreamableCollectionStore } from "../../Stores/OneLineStreamableCollectionStore";
    import { playerMovedInTheLast10Seconds } from "../../Stores/VideoLayoutStore";
    import LL from "../../../i18n/i18n-svelte";
    import { raisedHandsStore } from "../../Space/RaiseHand/RaiseHandStore";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { IconMicrophoneOff } from "@wa-icons";

    export let videoBox: VideoBox;
    export let isOnOneLine: boolean;
    export let oneLineMode: "vertical" | "horizontal";
    export let videoWidth: number;
    export let videoHeight: number | undefined;
    /** In a row of faces (PhoneVideoLayout.ts): shown as a round face rather than a video. */
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
    // A face has no room for the video's mic icon: a badge on its edge says they're muted.
    $: mutedStore = $streamable?.isMuted;
    $: hasAudioStore = $streamable?.hasAudio;
    $: muted = face && mutedStore && hasAudioStore ? $mutedStore && $hasAudioStore : false;
    $: name = videoBox.spaceUser.name;
    // A raised hand shows on the person's camera (ours is "-1"), not on their screen share: a gold edge, unless they
    // are talking (blue wins), and their place in line on the top-left corner, like on the ✋ button.
    // Our own camera is made before we know our uuid: read it when the hands change.
    const handUuid = (): string | undefined =>
        videoBox.uniqueId === "-1"
            ? localUserStore.getLocalUser()?.uuid
            : videoBox.uniqueId === videoBox.spaceUser.spaceUserId
            ? videoBox.spaceUser.uuid
            : undefined;
    $: handPosition = $raisedHandsStore.find((hand) => hand.uuid !== "" && hand.uuid === handUuid())?.position;
    $: speaking = voiceStore ? $voiceStore : false;

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
        class:hand-up={handPosition !== undefined && !speaking}
        class:behind-more={$orderStore >= shownCount}
    >
        <MediaBox {videoBox} />
        {#if handPosition !== undefined}
            <span
                class="hand-chip"
                role="img"
                aria-label={$LL.say.raiseHand.handUpOf({ name, position: handPosition })}
                data-testid="video-hand-position"
                ><span class="hand-chip-emoji" aria-hidden="true">✋</span>{#if handPosition > 0}<span
                        aria-hidden="true">{handPosition}</span
                    >{/if}</span
            >
        {/if}
        {#if face}
            <!-- Shown on hover (desktop). Drawn from the attribute: screen readers and searches already find the name
                 once, in the face. -->
            <span class="face-name" data-name={name} aria-hidden="true" />
        {/if}
        {#if muted}
            <span class="face-muted" data-testid={$LL.video.user_is_muted({ name })}>
                <IconMicrophoneOff font-size="12" aria-label={$LL.video.user_is_muted({ name })} />
            </span>
        {/if}
    </div>
{/if}

<style>
    /* The picture fills the circle (VideoMediaBox covers in face mode), clipped round. The name and the mute badge
       sit on the circle's edge, outside the clip. */
    .video-face {
        position: relative;
        border-radius: 9999px;
        overflow: visible !important;
    }
    .video-face > :global(*:not(.face-name):not(.face-muted):not(.hand-chip)) {
        clip-path: inset(0 round 9999px);
    }
    .face-muted {
        position: absolute;
        right: 0;
        bottom: 0;
        z-index: 35;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 9999px;
        color: #fff;
        background: rgb(var(--u-ink) / 0.92);
        box-shadow: inset 0 0 0 1px var(--u-surface-edge);
        pointer-events: none;
    }
    .face-name {
        position: absolute;
        left: 50%;
        bottom: -4px;
        z-index: 40;
        max-width: 140px;
        padding: 2px 8px;
        overflow: hidden;
        border-radius: 8px;
        color: #fff;
        background: rgb(var(--u-ink) / 0.92);
        box-shadow: inset 0 0 0 1px var(--u-surface-edge);
        font-size: 12px;
        font-weight: 700;
        line-height: 16px;
        white-space: nowrap;
        text-overflow: ellipsis;
        transform: translateX(-50%);
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease;
    }
    .face-name::after {
        content: attr(data-name);
    }
    @media (hover: hover) {
        .video-face:hover .face-name {
            opacity: 1;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .face-name {
            transition: none;
        }
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
    /* A raised hand: the gold of the ✋ button, drawn over the picture like the talking ring. */
    .hand-up {
        position: relative;
    }
    .hand-up::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 30;
        border-radius: 0.5rem;
        box-shadow: inset 0 0 0 3px #f5c451;
        pointer-events: none;
    }
    .video-face.hand-up::after {
        border-radius: inherit;
    }
    /* The ✋ and the place in line, in the map badge's ink and gold (✋ is yellow: on gold it would vanish). */
    .hand-chip {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 35;
        display: flex;
        align-items: center;
        gap: 2px;
        height: 22px;
        padding: 0 7px 0 5px;
        border-radius: 9999px;
        background: rgb(var(--u-ink) / 0.92);
        box-shadow: inset 0 0 0 1px rgba(245, 196, 81, 0.85);
        color: #f5c451;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
        pointer-events: none;
    }
    .hand-chip-emoji {
        font-size: 13px;
    }
    /* On a face, bottom-left, opposite the mute badge: the row's top edge would cut it. */
    .video-face .hand-chip {
        top: auto;
        bottom: 0;
        left: -2px;
        height: 20px;
        padding: 0 6px 0 4px;
    }
    .behind-more {
        display: none;
    }
</style>
