<script lang="ts">
    import { setContext } from "svelte";
    import { writable } from "svelte/store";
    import MediaBox from "../Video/MediaBox.svelte";
    import { highlightedEmbedScreen } from "../../Stores/HighlightedEmbedScreenStore";
    import type { VideoBox } from "../../Space/Space";
    import { oneLineStreamableCollectionStore } from "../../Stores/OneLineStreamableCollectionStore";
    import { playerMovedInTheLast10Seconds } from "../../Stores/VideoLayoutStore";
    import { chatSheetOpenStore } from "../../Chat/ChatSheetStore";
    import LL from "../../../i18n/i18n-svelte";
    import { raisedHandsStore } from "../../Space/RaiseHand/RaiseHandStore";
    import { localUserStore } from "../../Connection/LocalUserStore";

    export let videoBox: VideoBox;
    export let isOnOneLine: boolean;
    export let oneLineMode: "vertical" | "horizontal";
    export let videoWidth: number;
    export let videoHeight: number | undefined;
    /** A small video (PhoneVideoLayout.ts): the picture alone, without the name over it. */
    export let small = false;
    /** On phones: the spots that show. Videos placed after them are behind the "+N" tile. */
    export let shownCount = Infinity;

    // What is inside the box (the name, the picture) reads this to draw a small video.
    const smallStore = writable(small);
    setContext("videoSmall", smallStore);
    $: smallStore.set(small);
    $: voiceStore = $streamable?.showVoiceIndicator;
    $: name = videoBox.spaceUser.name;
    // A raised hand shows on the person's camera (ours is "-1"), not on their screen share: a gold edge, unless they
    // are talking (blue wins), and their place in line on the top-left corner, like on the ✋ button.
    // Our own camera is made before we know our uuid: read it when the hands change.
    // The box is passed in so the position follows a new videoBox too.
    const handUuid = (box: VideoBox): string | undefined =>
        box.uniqueId === "-1"
            ? localUserStore.getLocalUser()?.uuid
            : box.uniqueId === box.spaceUser.spaceUserId
            ? box.spaceUser.uuid
            : undefined;
    $: handPosition = $raisedHandsStore.find((hand) => hand.uuid !== "" && hand.uuid === handUuid(videoBox))?.position;
    $: speaking = voiceStore ? $voiceStore : false;

    const streamable = videoBox.streamable;
    const orderStore = videoBox.displayOrder;

    $: isFirst = $orderStore == 0;

    $: isLast = $orderStore == $oneLineStreamableCollectionStore.length - 1;
</script>

<!-- The video shown big leaves the row, except while the phone's chat sheet is open: then nobody is shown big, and
     every video, ours included, stays in the row. -->
{#if (($highlightedEmbedScreen !== videoBox || $playerMovedInTheLast10Seconds || $chatSheetOpenStore) && (!isOnOneLine || oneLineMode === "horizontal")) || (isOnOneLine && oneLineMode === "vertical" && ($streamable?.displayInPictureInPictureMode ?? false))}
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
        class:video-small={small}
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
        {#if small}
            <!-- Shown on hover (desktop). Drawn from the attribute: screen readers and searches already find the name
                 once, in the video. -->
            <span class="small-name" data-name={name} aria-hidden="true" />
        {/if}
    </div>
{/if}

<style>
    .video-small {
        position: relative;
    }
    .small-name {
        position: absolute;
        left: 50%;
        bottom: 4px;
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
    .small-name::after {
        content: attr(data-name);
    }
    @media (hover: hover) {
        .video-small:hover .small-name {
            opacity: 1;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .small-name {
            transition: none;
        }
    }
    /* A raised hand: the gold of the ✋ button, drawn over the picture like the blue edge of whoever is talking. */
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
    .behind-more {
        display: none;
    }
</style>
