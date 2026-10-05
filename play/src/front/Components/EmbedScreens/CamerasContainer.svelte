<!--
    CamerasContainer.svelte

    This component displays a collection of WebRTC video streams in a responsive layout.
    It supports two display modes controlled by the isOnOneLine prop:

    1. Single-line mode (isOnOneLine = true):
       - Videos are displayed in a single horizontal line
       - Video sizes are automatically adjusted to fit the container width
       - If container is too narrow, videos will maintain minimum width (120px) and overflow horizontally
       - Videos are centered in the container with equal spacing
       - No vertical scrolling

    2. Multi-line mode (isOnOneLine = false):
       - Videos wrap to multiple lines to maximize available space
       - Uses an optimal layout algorithm that:
         a) Calculates maximum possible videos per row at minimum size
         b) Works backwards to find the largest video size that fits without scrolling
         c) Maintains 16:9 aspect ratio for all videos
         d) Ensures videos never go below minimum width (120px)
       - Videos are aligned to the top of the container
       - Vertical scrolling is enabled if needed
       - Maintains consistent gap between videos

    The component automatically adjusts its layout when:
    - Container dimensions change
    - Number of videos changes
    - Display mode changes

    Props:
    - oneLineMaxHeight: Maximum height for videos in single-line mode
    - isOnOneLine: Toggle between single-line and multi-line modes

-->
<script lang="ts">
    import { onDestroy, onMount, setContext } from "svelte";
    import { derived, type Writable } from "svelte/store";
    import { myCameraPeerStore, type MyLocalStreamable } from "../../Stores/StreamableCollectionStore";
    import VideoBox from "../Video/VideoBox.svelte";
    import MediaBox from "../Video/MediaBox.svelte";
    import { highlightedEmbedScreen } from "../../Stores/HighlightedEmbedScreenStore";
    import { highlightFullScreen } from "../../Stores/ActionsCamStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { MAX_DISPLAYED_VIDEOS } from "../../Enum/EnvironmentVariable";
    import {
        orderedStreamableCollectionStore,
        maxVisibleVideosStore,
    } from "../../Stores/OrderedStreamableCollectionStore";
    import { activePictureInPictureStore } from "../../Stores/PeerStore";
    import { oneLineStreamableCollectionStore } from "../../Stores/OneLineStreamableCollectionStore";
    import { chatSheetHeightStore, chatSheetLayoutStore, chatSheetSnapStore } from "../../Chat/ChatSheetStore";
    import { windowSize } from "../../Stores/CoWebsiteStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import RaisedHandsPill from "../Video/RaisedHandsPill.svelte";
    import { PHONE_VIDEO_GAP, phoneVideoLayout, type PhoneVideoLayout } from "./PhoneVideoLayout";
    import ResizeHandle from "./ResizeHandle.svelte";

    setContext("inCameraContainer", true);

    export let oneLineMaxHeight: number;
    let gap = 16; // Configurable gap between videos in pixels

    // The "maximum" number of videos we want to display.
    // This is not 100% accurate, as if we are in "solution 2", the maximum number of videos
    // will be maximumVideosPerPage + nbVideos % vpr
    const maximumVideosPerPage = MAX_DISPLAYED_VIDEOS;

    export let isOnOneLine: boolean;
    export let oneLineMode: "vertical" | "horizontal" = "horizontal";
    let containerWidth: number;
    let maxContainerHeight: number;
    let containerHeight: number;
    let videoWidth: number;
    let videoHeight: number | undefined;

    // The minimum width of a media box in pixels
    const minMediaBoxWidth = 160;

    // ---- Rows and round faces (PhoneVideoLayout.ts): phones held upright, tablets and desktops ----
    // On a phone held upright the videos get the space above the chat sheet while the chat is open, and everywhere
    // the height set with the white bar; the same rules for all. Walking keeps the single row, and phones on their
    // side keep the layout below.
    $: phoneSheet = $chatSheetLayoutStore && oneLineMode === "horizontal";
    $: sheetOpen = phoneSheet && $chatSheetHeightStore > 0;
    $: phoneLayoutOn =
        ($chatSheetLayoutStore || !$mobileLayoutStore) && oneLineMode === "horizontal" && (!isOnOneLine || sheetOpen);
    // A screen share in a circle can't be read: with one in the rows, they stay videos. Not the one shown big.
    $: screenShareInRows = derived(
        $oneLineStreamableCollectionStore
            .filter((videoBox) => videoBox !== $highlightedEmbedScreen)
            .map((videoBox) => videoBox.streamable),
        (streamables) => streamables.some((streamable) => streamable?.videoType.endsWith("screenSharing") ?? false)
    );
    let cameraBlock: HTMLDivElement | undefined;
    // Room above the sheet: from the top of the videos to the top of the sheet, less a gap.
    $: spaceAboveSheet = sheetOpen
        ? Math.max(0, $windowSize.height - $chatSheetHeightStore - (cameraBlock?.getBoundingClientRect().top ?? 0) - 8)
        : 0;
    // With someone shown big, the others get one row of faces above them.
    $: phoneHeight = sheetOpen
        ? $highlightedEmbedScreen && !$highlightFullScreen
            ? Math.min(spaceAboveSheet, 64)
            : spaceAboveSheet
        : containerHeight;
    // "+N" tapped: everyone, in a list that scrolls. Dragging the sheet or the white bar goes back to the layout.
    let showEveryone = false;
    let phoneLayout: PhoneVideoLayout | undefined;
    // Not before the container is measured: its size is unknown (NaN) on the first pass after mounting.
    $: phoneLayout =
        phoneLayoutOn && containerWidth > 0 && Number.isFinite(phoneHeight)
            ? phoneVideoLayout(
                  $oneLineStreamableCollectionStore.length,
                  containerWidth,
                  phoneHeight,
                  showEveryone,
                  maximumVideosPerPage,
                  !$screenShareInRows
              )
            : undefined;
    $: shownCount = phoneLayout && phoneLayout.more > 0 ? phoneLayout.shown : Infinity;
    // One line along the top (walking), or rows.
    $: line = isOnOneLine && !phoneLayoutOn;

    function showEveryoneNow() {
        if (sheetOpen) {
            // Lower the sheet first: its change of height would otherwise go back to the layout.
            chatSheetSnapStore.set("peek");
        } else {
            containerHeight = Math.round(maxContainerHeight * 0.64);
            if (camerasContainer) camerasContainer.style.height = `${containerHeight}px`;
        }
        showEveryone = true;
    }

    // Whichever map is current when the layout changes: during a reconnect there is none (skip, don't throw).
    function reposition() {
        gameManager.tryGetCurrentGameScene()?.reposition();
    }

    $: myCameraStreamable = $myCameraPeerStore.streamable as Writable<MyLocalStreamable | undefined>;

    onMount(() => {
        const unsubscriber = orderedStreamableCollectionStore.subscribe((orderedStreamableCollection) => {
            // Each time the order of the videos changes, we update the displayOrder of each videoBox
            for (let i = 0; i < orderedStreamableCollection.length; i++) {
                orderedStreamableCollection[i].displayOrder.set(i);
            }
        });

        const unsubscribePictureInPictureMode = activePictureInPictureStore.subscribe((activePictureInPicture) => {
            // If the picture in picture mode is activated, we update the displayInPictureInPictureMode of the local camera streamable
            // To set true, the local camera streamable will appear like other camera boxes in the picture in picture mode
            $myCameraStreamable?.setDisplayInPictureInPictureMode(
                activePictureInPicture && $highlightedEmbedScreen != undefined
            );
        });

        const unsubscribeHighlightedEmbedScreen = highlightedEmbedScreen.subscribe((highlightedEmbedScreen) => {
            // If the highlighted embed screen is changed, we update the displayInPictureInPictureMode of the local camera streamable
            // To set true, the local camera streamable will appear like other camera boxes in the picture in picture mode
            $myCameraStreamable?.setDisplayInPictureInPictureMode(
                highlightedEmbedScreen != undefined && $activePictureInPictureStore
            );
        });

        const unsubscribeSheetSnap = chatSheetSnapStore.subscribe(() => (showEveryone = false));

        return () => {
            unsubscriber();
            unsubscribePictureInPictureMode();
            unsubscribeHighlightedEmbedScreen();
            unsubscribeSheetSnap();
        };
    });

    onDestroy(() => {
        reposition();
    });

    $: maxMediaBoxWidth = (oneLineMaxHeight * 16) / 9;

    $: if (sheetOpen && camerasContainer) {
        camerasContainer.style.height = `${phoneHeight}px`;
    }

    $: {
        if (sheetOpen) {
            // The sheet sets the height (above).
        } else if (!isOnOneLine) {
            containerHeight = maxContainerHeight * localUserStore.getCameraContainerHeight();
            if (camerasContainer) {
                camerasContainer.style.height = `${containerHeight}px`;
            }
        } else {
            if (camerasContainer) {
                camerasContainer.style.height = "";
            }
        }
    }

    $: {
        if (phoneLayout) {
            videoWidth = phoneLayout.width;
            videoHeight = phoneLayout.height;
            // The call puts the people it ranks first (whoever is talking) in the spots that show.
            maxVisibleVideosStore.set(phoneLayout.shown);
        } else if (isOnOneLine) {
            if (oneLineMode === "horizontal") {
                videoWidth = Math.max(
                    Math.min(maxMediaBoxWidth, containerWidth / $oneLineStreamableCollectionStore.length),
                    minMediaBoxWidth
                );
                videoHeight = undefined;
                maxVisibleVideosStore.set(Math.ceil(containerWidth / videoWidth));
            } else {
                videoWidth = containerWidth;
                videoHeight = videoWidth * (9 / 16);
                maxVisibleVideosStore.set(Math.ceil(containerHeight / videoHeight));
            }
        } else {
            const layout = calculateOptimalLayout(containerWidth, containerHeight);
            videoWidth = layout.videoWidth;
            videoHeight = layout.videoHeight;
        }
        reposition();
    }

    function calculateOptimalLayout(containerWidth: number, containerHeight: number) {
        if (!containerWidth || !containerHeight) {
            return {
                videoWidth: minMediaBoxWidth,
            };
        }

        // When the user scroll in or out, the canvas is resize and "containerWidth" has a small jitter.
        // When the user is not resizing the container through the resize handle, we don't want to take into account the jitter.
        // Rules: Apply -2 pixels to the gap when the user is not resizing the container.
        // TODO: find a better way to detect this and fix the jitter from the WaScalerManager.
        if (resizeInProgress) {
            gap = 16;
        } else {
            gap = 20;
        }

        // Calculate maximum number of videos that can fit in one row at minimum size
        const maxVideosPerRow = Math.min(
            Math.floor((containerWidth + gap) / (minMediaBoxWidth + gap)),
            $oneLineStreamableCollectionStore.length
        );

        let lastValidConfig = null;

        // Start with maximum possible videos per row and work backwards
        for (let vpr = maxVideosPerRow; vpr >= 1; vpr--) {
            // Calculate video width based on container width and gap
            const width = (containerWidth - gap * (vpr - 1)) / vpr;

            // Calculate video height maintaining aspect ratio
            const height = (width * 9) / 16;

            // Check if this height would fit in the container
            //if (height <= containerHeight) {
            // Calculate how many complete rows we can fit
            const rowsPerPage = Math.floor((containerHeight + gap) / (height + gap));

            const maxVisibleVideos = rowsPerPage * vpr;

            // The "maximum" number of videos we want to display. This is either the number of videos we have
            // or the maximumVideosPerPage constant.
            // This is not 100% accurate, as if we are in "solution 2", the maximum number of videos
            // will be maximumVideosPerPage + nbVideos % vpr
            const maxNbVideos = Math.min($oneLineStreamableCollectionStore.length, maximumVideosPerPage);
            // If we need scrolling, calculate the maximum height that would fit
            if (maxVisibleVideos < maxNbVideos) {
                // Calculate total number of rows needed
                const totalRows = Math.ceil(maxNbVideos / vpr);

                // Special case: we are on one row only, and we need to adapt the width / height of the videos to the container height
                if (totalRows === 1) {
                    const adjustedWidth = (containerHeight * 16) / 9;
                    // We put the maximum number of visible videos in a store. This store will be used to show active participants first.
                    maxVisibleVideosStore.set(vpr);

                    return {
                        videoWidth: Math.max(adjustedWidth, minMediaBoxWidth),
                    };
                }

                // There are 2 possible optimal solutions here. Either we can reduce the height of the videos
                // to fit in the container OR we can take the previous solution with one more video per row
                // Let's check which one is better (i.e. which one has the largest video size)

                // Solution 1: let's reduce video size:

                // Calculate maximum height per video that would fit
                const maxHeightPerVideo = (containerHeight - gap * (totalRows - 1)) / totalRows;

                // Calculate corresponding width based on aspect ratio
                const adjustedWidthWithReducedHeight = (maxHeightPerVideo * 16) / 9;

                // Solution 2: let's increase the number of videos per row (only possible if we have enough videos)
                const adjustedWidthWithOneMoreVpr =
                    maxNbVideos >= vpr + 1 ? (containerWidth - gap * vpr) / (vpr + 1) : 0;

                // Check which solution is better
                let adjustedWidth: number;
                let adjustedHeight: number | undefined;
                if (adjustedWidthWithReducedHeight > adjustedWidthWithOneMoreVpr) {
                    const adjustedVpr = Math.floor((containerWidth + gap) / (adjustedWidthWithReducedHeight + gap));
                    if (adjustedVpr !== vpr) {
                        console.warn("problem");
                    }
                    // if solution 1 is better
                    adjustedWidth = adjustedWidthWithReducedHeight;
                    // We put the maximum number of visible videos in a store. This store will be used to show active participants first.
                    maxVisibleVideosStore.set(vpr * (rowsPerPage + 1));
                } else {
                    // if solution 2 is better, the videos will not occupy all vertical space.
                    // We can fix this by breaking the aspect ratio.
                    adjustedWidth = adjustedWidthWithOneMoreVpr;
                    const adjustedTotalRows = Math.ceil(maxNbVideos / (vpr + 1));
                    adjustedHeight = (containerHeight - gap * (adjustedTotalRows - 1)) / adjustedTotalRows;
                    if (adjustedHeight < adjustedWidth * (9 / 16)) {
                        adjustedHeight = adjustedWidth * (9 / 16);
                    }
                    // We put the maximum number of visible videos in a store. This store will be used to show active participants first.
                    maxVisibleVideosStore.set((vpr + 1) * adjustedTotalRows);
                }

                if (adjustedWidth < minMediaBoxWidth) {
                    return {
                        videoWidth: minMediaBoxWidth,
                    };
                }
                //const adjustedWidth = Math.max(adjustedWidthWithReducedHeight, adjustedWidthWithOneMoreVpr);
                return {
                    videoWidth: adjustedWidth,
                    videoHeight: adjustedHeight,
                };
            }

            // Keep this as our last valid config that doesn't need scrolling
            lastValidConfig = {
                videoWidth: width,
            };
        }

        // If we get here, we never needed scrolling, use the last valid config
        return (
            lastValidConfig || {
                videoWidth: minMediaBoxWidth,
            }
        );
    }

    let camerasContainer: HTMLDivElement | undefined;
    let grabPointerEvents = false;
    const isWebkit = "WebkitAppearance" in document.documentElement.style;
    $: {
        // In Webkit, the scroll event on the cameras-container is not triggered when the user scrolls unless the
        // pointer-events is set to auto. But we want to avoid that unless there is a scroll bar to keep the
        // pointer events to go through to the map.

        // Let's trigger this logic when the number of videos changes or when the container width changes
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        $oneLineStreamableCollectionStore;

        if (isWebkit && isOnOneLine && oneLineMode === "horizontal") {
            setTimeout(() => {
                if (camerasContainer) {
                    if (camerasContainer.scrollWidth > containerWidth) {
                        //eslint-disable-next-line svelte/infinite-reactive-loop
                        grabPointerEvents = true;
                    } else {
                        //eslint-disable-next-line svelte/infinite-reactive-loop
                        grabPointerEvents = false;
                    }
                }
            }, 500);
        } else {
            grabPointerEvents = false;
        }
    }

    let resizeInProgress = false;
    function onResizeHandler(height: number) {
        resizeInProgress = true;
        showEveryone = false;
        containerHeight = height;
        const coefCameraContainerHeight = containerHeight / maxContainerHeight;
        localUserStore.setCameraContainerHeight(coefCameraContainerHeight > 0.9 ? 0.9 : coefCameraContainerHeight);
        if (camerasContainer) {
            const oldHeight = camerasContainer.scrollHeight;
            // Move the scroll position to keep the same percentage of position
            const oldScrollPercent = camerasContainer.scrollTop / oldHeight;

            camerasContainer.style.height = `${containerHeight}px`;
            camerasContainer.scrollTop = camerasContainer.scrollHeight * oldScrollPercent;
        }
    }
</script>

<div
    class="w-full"
    data-camera-block
    bind:this={cameraBlock}
    bind:clientHeight={maxContainerHeight}
    class:h-full={!isOnOneLine || (isOnOneLine && oneLineMode === "vertical")}
>
    <div
        bind:clientWidth={containerWidth}
        bind:this={camerasContainer}
        class="gap-4 mx-1"
        style:gap={phoneLayoutOn ? `${PHONE_VIDEO_GAP}px` : null}
        class:pointer-events-none={!grabPointerEvents}
        class:pointer-events-auto={grabPointerEvents}
        class:hidden={$highlightFullScreen && $highlightedEmbedScreen && oneLineMode !== "vertical"}
        class:flex={true}
        class:max-h-full={line && oneLineMode === "horizontal"}
        class:max-w-full={!line || (line && oneLineMode === "horizontal")}
        class:flex-col={line && oneLineMode === "vertical"}
        class:flex-wrap={!line}
        class:content-start={!line}
        class:justify-start={line}
        class:justify-center={!line}
        class:whitespace-nowrap={line}
        class:relative={true}
        class:overflow-x-auto={line && oneLineMode === "horizontal"}
        class:overflow-x-hidden={!line}
        class:overflow-y-auto={(!line && !(phoneLayout && !phoneLayout.scrolls)) ||
            (line && oneLineMode === "vertical")}
        class:overflow-y-hidden={(line && oneLineMode === "horizontal") || (phoneLayout && !phoneLayout.scrolls)}
        class:pointer-events-auto-scroll={phoneLayout?.scrolls}
        class:pb-3={line && !$highlightedEmbedScreen}
        class:m-0={line}
        class:my-0={line}
        class:w-full={!line && oneLineMode !== "horizontal"}
        class:items-start={!line}
        class:not-highlighted={!line}
        class:mt-0={!line}
        class:h-full={line && oneLineMode === "vertical"}
        class:m-2={$activePictureInPictureStore}
        id="cameras-container"
        data-testid="cameras-container"
        data-phone-layout={phoneLayout ? phoneLayout.kind : undefined}
    >
        {#each $oneLineStreamableCollectionStore as videoBox (videoBox.uniqueId)}
            <VideoBox
                {videoBox}
                isOnOneLine={line}
                {oneLineMode}
                {videoWidth}
                {videoHeight}
                face={phoneLayout?.kind === "faces"}
                {shownCount}
            />
        {/each}
        {#if phoneLayout && phoneLayout.more > 0}
            <!-- The last spot: how many more people there are. Tapping it shows everyone. -->
            <button
                type="button"
                class="more-people pointer-events-auto shrink-0 camera-box"
                class:face={phoneLayout.kind === "faces"}
                style="order: {phoneLayout.shown}; width: {phoneLayout.width}px; height: {phoneLayout.height}px;"
                aria-label={$LL.video.showEveryone({ count: phoneLayout.more })}
                data-testid="more-people"
                on:click={showEveryoneNow}
            >
                <span class="more-people-count">+{phoneLayout.more}</span>
                {#if phoneLayout.kind === "videos"}
                    <span class="more-people-label">{$LL.video.more()}</span>
                {/if}
            </button>
        {/if}
        <!-- in PictureInPicture, let's finish with our video feedback in small -->
        {#if isOnOneLine && oneLineMode === "vertical" && !($myCameraStreamable?.displayInPictureInPictureMode ?? false)}
            <div class="fixed bottom-20 right-0 z-50">
                <div
                    data-unique-id="my-camera"
                    style={`top: -50px; width: ${videoWidth / 3}px; max-width: ${videoWidth / 3}px;${
                        videoHeight ? `height: ${videoHeight / 3}px; max-height: ${videoHeight / 3}px;` : ""
                    } ${
                        $activePictureInPictureStore ? "min-width: 224px; min-height: 130px; margin-right: 0.5rem;" : ""
                    }`}
                    class="pointer-events-auto basis-40 shrink-0 min-h-24 grow camera-box"
                    class:aspect-video={videoHeight === undefined}
                >
                    <MediaBox videoBox={$myCameraPeerStore} />
                </div>
            </div>
        {/if}
    </div>
    {#if oneLineMode === "horizontal" && !($highlightFullScreen && $highlightedEmbedScreen)}
        <!-- Under the videos, on the left (clear of the white bar in the middle): who is waiting to speak. -->
        <div class="raised-hands-anchor">
            <div class="raised-hands-spot"><RaisedHandsPill /></div>
        </div>
    {/if}
    <!-- With the chat sheet open, its handle sizes the videos instead. -->
    {#if !isOnOneLine && !sheetOpen}
        <ResizeHandle
            minHeight={maxContainerHeight * 0.1}
            maxHeight={maxContainerHeight * 0.9}
            onResize={onResizeHandler}
            onResizeEnd={() => {
                resizeInProgress = false;
                analyticsClient.resizeCameraLayout();
                if (phoneLayoutOn) return;

                // We need to recalculate the layout to take into account the new container width
                const layout = calculateOptimalLayout(containerWidth, containerHeight);
                videoWidth = layout.videoWidth;
                videoHeight = layout.videoHeight;
            }}
            dataTestid="resize-handle"
        />
    {/if}
</div>

<!-- && !$megaphoneEnabledStore TODO HUGO -->
<style lang="scss">
    .raised-hands-anchor {
        position: relative;
        height: 0;
    }
    .raised-hands-spot {
        position: absolute;
        top: 4px;
        left: 8px;
        z-index: 50;
    }
    .hidden {
        display: none !important;
    }

    /* "+N": an ink tile like a camera that's off, with the count. */
    .more-people {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 16px;
        color: #fff;
        background: rgb(var(--u-ink) / 0.8);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: inset 0 0 0 1px var(--u-surface-edge);
        cursor: pointer;
    }
    .more-people.face {
        border-radius: 9999px;
    }
    .more-people-count {
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
    }
    .more-people.face .more-people-count {
        font-size: 13px;
    }
    .more-people-label {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.7);
    }
    .more-people:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
    /* Everyone, in a list that scrolls: the list takes the finger, the map behind doesn't. */
    .pointer-events-auto-scroll {
        pointer-events: auto;
    }

    @container (min-width: 1024) and (max-width: 1279px) {
        .not-highlighted {
            gap: 1rem;
        }
    }

    @container (min-width: 640px) and (max-width: 1024px) {
        .not-highlighted {
            gap: 0.75rem;
        }
    }

    @container (max-width: 640px) {
        .not-highlighted {
            gap: 0.5rem;
        }
    }
</style>
