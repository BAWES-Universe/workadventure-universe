<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { readable, type Readable, type Unsubscriber } from "svelte/store";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import { formatDuration } from "../../Broadcast/voiceRecorder";
    import { singlePlayback } from "../../../Utils/SinglePlayback";
    import { sentLabel, type SharedItem } from "../../../Chat/Components/Room/Details/SharedItems";
    import { sharedSender } from "../../../Chat/Components/Room/Details/sharedSender";
    import { audioFileKind, audioFileTitle } from "../../../Chat/Components/Room/Message/audioFileTitle";
    import { formatFileSize } from "../../../FileViewer/fileKinds";
    import { openHereFloatsStore } from "../../../Stores/CoWebsiteStore";
    import {
        bandsOf,
        bandsSettled,
        drawWaves,
        easeBands,
        joinedWindowAudioAnalyser,
        QUIET_BANDS,
        windowAudioAnalyser,
        windowAudioElement,
        type Bands,
    } from "../../../FileViewer/audioWaves";
    import type { FileViewerAudio } from "../../../WebRtc/CoWebsite/FileViewerCoWebsite";
    import {
        IconAlertTriangle,
        IconDownload,
        IconPauseFilled,
        IconPlayFilled,
        IconPlayerSkipBackFilled,
        IconPlayerSkipForwardFilled,
        IconRewindBackward10,
        IconRewindForward10,
        IconUnMute,
        IconVolume2,
        IconVolumeOff,
    } from "@wa-icons";

    /**
     * A song or other audio file in the window: a stage of ribbons that move with the music, its title, a scrubber with
     * the song's shape, the controls, and the chat's other songs. Only one audio plays at a time, as in the chat.
     */
    export let audio: FileViewerAudio;
    export let name: string;
    export let senderName: string | undefined = undefined;
    export let sentByMe = false;
    /** The window shows this item: the stage draws only then. */
    export let visible = true;
    export let onDuration: ((seconds: number | undefined) => void) | undefined = undefined;
    export let onDownload: (() => void) | undefined = undefined;

    const SPEEDS = [1, 1.5, 2];
    const SCRUB_BARS = 72;
    /** A longer file has no shape on its scrubber (reading it would take a while): a plain line then. */
    const MAX_SHAPE_BYTES = 10 * 1024 * 1024;
    /** Previous this far into a song goes back to its start, as in music apps. */
    const RESTART_AFTER_SECONDS = 3;
    /** The list's heading and two and a half songs: less room than this and the whole window scrolls instead. */
    const QUEUE_MIN_HEIGHT = 176;
    /** A song from the list whose file never comes gives up, so the next tap asks again. */
    const FILE_WAIT_MS = 15000;

    const url = audio.url;
    // The page may only listen to a file it holds itself: another site's file would play silent through the stage.
    // Such a file plays on an element of its own, without the stage.
    const canListen = url.startsWith("blob:");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    const player = canListen ? windowAudioElement() : new Audio();
    const ownPlayback = canListen ? undefined : singlePlayback(player);
    player.src = url;
    // The window's element is shared from song to song: it answers only while it plays this one.
    const isMine = () => player.getAttribute("src") === url;
    let canvas: HTMLCanvasElement | undefined;
    let playing = false;
    let current = 0;
    let duration: number | undefined;
    let speed = 0;
    // The level carries over from the last song.
    let volume = player.volume;
    let muted = player.muted;
    let volumeDragging = false;
    let failed = false;
    // Opened from its chat card: it carries on from where the card was, once the window knows the song's length.
    let startAt = audio.startAt;
    let levels: number[] | undefined;
    let fileSize: number | undefined;
    /** While a finger or the mouse drags the dot: where it is, 0 to 1. The song jumps there on release. */
    let dragAt: number | undefined;
    let width = 0;
    let height = 0;
    let queue: HTMLDivElement | undefined;
    let queueList: HTMLDivElement | undefined;

    $: compact = width > 0 && width < 440;
    // The list scrolls on its own, so the player stays in view, when the floating window has room for a few songs
    // under the player. A short window scrolls as a whole instead of squeezing the list, and so does an upright phone's
    // sheet, whose lower part the chat's sheet can cover.
    $: pinned =
        $openHereFloatsStore && width > 0 && queue !== undefined && height - queue.offsetTop >= QUEUE_MIN_HEIGHT;
    $: title =
        audioFileTitle(name) ??
        (sentByMe
            ? $LL.chat.audioFile.untitled()
            : senderName
            ? $LL.chat.audioFile.from({ name: senderName })
            : $LL.chat.audioFile.untitled());
    $: kind = audioFileKind(name);
    $: progress = dragAt ?? (duration ? Math.min(1, current / duration) : 0);
    // The time follows the dot while it is dragged.
    $: shownTime = dragAt !== undefined && duration ? dragAt * duration : current;
    $: onDuration?.(duration);

    // The chat's songs, newest first, as its Files list shows them. Nothing is downloaded until one is picked.
    const inChat = audio.inChat;
    const tracks: Readable<SharedItem[]> = inChat?.tracks ?? readable([]);
    $: index = inChat ? $tracks.findIndex((track) => track.key === inChat.key) : -1;
    $: currentTrack = index >= 0 ? $tracks[index] : undefined;
    // Previous and Next only when the chat has other songs to go to.
    $: hasList = index >= 0 && $tracks.length > 1;
    // The song playing is in sight in the list when the window opens on it.
    $: if (pinned && queueList && index >= 0) showCurrent(index).catch((error) => console.warn(error));

    async function showCurrent(at: number): Promise<void> {
        await tick();
        const list = queueList;
        const row = list?.children[at];
        if (!list || !(row instanceof HTMLElement)) return;
        const top = row.offsetTop - list.offsetTop;
        if (top >= list.scrollTop && top + row.offsetHeight <= list.scrollTop + list.clientHeight) return;
        list.scrollTop = top - (list.clientHeight - row.offsetHeight) / 2;
    }

    let openingKey: string | undefined;
    let stopOpening: (() => void) | undefined;

    function openTrack(track: SharedItem | undefined): void {
        if (!track || !inChat || openingKey === track.key) return;
        stopOpening?.();
        const go = (trackUrl: string) =>
            audio.openOther({
                url: trackUrl,
                name: track.name,
                senderName: sharedSender(track.message, $LL.chat.details.you()),
                sentByMe: track.message.isMyMessage,
                inChat: { tracks: inChat.tracks, key: track.key },
                startPlaying: true,
            });
        if (track.src) {
            go(track.src);
            return;
        }
        // The message fetches its file once listened to (with the sign-in token), as a tap on its Files row does.
        openingKey = track.key;
        let done = false;
        let unsubscribe: Unsubscriber | undefined;
        const timeout = setTimeout(() => stop(), FILE_WAIT_MS);
        const stop = () => {
            done = true;
            clearTimeout(timeout);
            unsubscribe?.();
            unsubscribe = undefined;
            if (openingKey === track.key) openingKey = undefined;
            stopOpening = undefined;
        };
        stopOpening = stop;
        unsubscribe = track.message.content.subscribe((content) => {
            if (done) return;
            if (content.url) {
                stop();
                go(content.url);
            } else if (content.mediaFailed) {
                stop();
            }
        });
        if (done) unsubscribe();
    }

    function previous(): void {
        if (current > RESTART_AFTER_SECONDS || index <= 0) seekTo(0);
        else openTrack($tracks[index - 1]);
    }

    // The shape of the whole song, read from the copy chat already holds in memory.
    async function readShape(): Promise<void> {
        if (!canListen) return;
        try {
            const blob = await (await fetch(url)).blob();
            fileSize = blob.size;
            if (blob.size > MAX_SHAPE_BYTES) return;
            const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
            const data = decoded.getChannelData(0);
            const step = Math.max(1, Math.floor(data.length / SCRUB_BARS));
            const peaks: number[] = [];
            for (let bar = 0; bar < SCRUB_BARS; bar++) {
                let sum = 0;
                let count = 0;
                for (let i = bar * step; i < (bar + 1) * step && i < data.length; i += 32) {
                    sum += data[i] * data[i];
                    count++;
                }
                peaks.push(count ? Math.sqrt(sum / count) : 0);
            }
            const top = Math.max(...peaks, 0.0001);
            levels = peaks.map((peak) => Math.max(0.08, peak / top));
        } catch (error) {
            console.warn("Could not read the shape of an audio file", error);
        }
    }

    // The stage listens to the music while it plays.
    let analyser: AnalyserNode | undefined;
    let bins: Uint8Array | undefined;
    let shown: Bands = QUIET_BANDS;
    let time = 0;
    let lastFrame = 0;
    let frame = 0;
    let drawing = false;

    function paint(): void {
        if (!canvas) return;
        const ratio = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        // Hidden behind another item: nothing to draw.
        if (w === 0 || h === 0) return;
        if (canvas.width !== Math.round(w * ratio)) canvas.width = Math.round(w * ratio);
        if (canvas.height !== Math.round(h * ratio)) canvas.height = Math.round(h * ratio);
        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawWaves(context, w, h, shown, time);
    }

    function draw(now: number): void {
        const elapsed = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
        lastFrame = now;
        time += elapsed * (playing ? 1 : 0.35);
        let target = QUIET_BANDS;
        // The analyser joins once its context runs, a moment after the first play.
        if (playing && canListen && !analyser) analyser = joinedWindowAudioAnalyser();
        if (analyser && (!bins || bins.length !== analyser.frequencyBinCount)) {
            bins = new Uint8Array(analyser.frequencyBinCount);
        }
        if (playing && analyser && bins) {
            analyser.getByteFrequencyData(bins);
            target = bandsOf(bins, analyser.context.sampleRate);
        }
        shown = easeBands(shown, target);
        paint();
        // Paused, the ribbons settle and the stage stops drawing until the next play.
        if (!playing && bandsSettled(shown, QUIET_BANDS)) {
            drawing = false;
            return;
        }
        frame = requestAnimationFrame(draw);
    }

    function wake(): void {
        if (drawing || reducedMotion || !visible) return;
        drawing = true;
        lastFrame = 0;
        frame = requestAnimationFrame(draw);
    }

    // Reduce motion: a still frame. Back in front, or at a new size, the stage is drawn again.
    $: if (canvas && width && visible) {
        if (playing && !reducedMotion) wake();
        else requestAnimationFrame(paint);
    }
    $: if (!visible && drawing) {
        cancelAnimationFrame(frame);
        drawing = false;
    }

    function play(): void {
        if (failed) return;
        if (canListen) analyser = windowAudioAnalyser();
        player.play().catch((error) => console.warn("Could not play an audio file", error));
    }

    function toggle(): void {
        if (failed) return;
        if (playing) player.pause();
        else play();
    }

    function seekTo(seconds: number): void {
        if (!duration) return;
        player.currentTime = Math.min(duration, Math.max(0, seconds));
    }

    function skip(seconds: number): void {
        seekTo(current + seconds);
    }

    function cycleSpeed(): void {
        speed = (speed + 1) % SPEEDS.length;
        player.playbackRate = SPEEDS[speed];
    }

    function fractionAt(event: PointerEvent): number {
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
        return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    }

    // The dot follows the pointer at once; the song seeks once, on release, as seeking on every move lags.
    function startDrag(event: PointerEvent): void {
        if (!duration) return;
        if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
        dragAt = fractionAt(event);
    }

    function moveDrag(event: PointerEvent): void {
        if (dragAt !== undefined) dragAt = fractionAt(event);
    }

    function endDrag(): void {
        if (dragAt === undefined || !duration) return;
        const at = dragAt * duration;
        dragAt = undefined;
        seekTo(at);
        current = at;
    }

    function cancelDrag(): void {
        dragAt = undefined;
    }

    function onScrubKey(event: KeyboardEvent): void {
        if (event.key === "ArrowRight") skip(5);
        else if (event.key === "ArrowLeft") skip(-5);
        else return;
        event.preventDefault();
    }

    // The level runs from the bottom of the bar to its top, inside the popup's padding.
    function volumeAt(event: PointerEvent): void {
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
        volume = Math.min(1, Math.max(0, (box.bottom - 14 - event.clientY) / (box.height - 28)));
        muted = false;
    }

    function onVolumeKey(event: KeyboardEvent): void {
        if (event.key === "ArrowUp") volume = Math.min(1, volume + 0.05);
        else if (event.key === "ArrowDown") volume = Math.max(0, volume - 0.05);
        else return;
        muted = false;
        event.preventDefault();
    }

    function onKey(event: KeyboardEvent): void {
        if (event.key === " " && !(event.target as Element | null)?.closest?.("button")) {
            event.preventDefault();
            toggle();
        }
    }

    $: player.volume = volume;
    $: player.muted = muted;

    const listeners: [string, () => void][] = [
        ["play", () => (playing = true)],
        ["pause", () => (playing = false)],
        [
            "ended",
            () => {
                playing = false;
                current = 0;
            },
        ],
        ["error", () => (failed = true)],
        ["timeupdate", () => (current = player.currentTime)],
        ["seeked", () => (current = player.currentTime)],
        [
            "durationchange",
            () => {
                duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : undefined;
            },
        ],
        [
            "loadedmetadata",
            () => {
                player.playbackRate = SPEEDS[speed];
                if (startAt) player.currentTime = startAt;
                startAt = undefined;
            },
        ],
    ];
    const handlers = listeners.map(([event, handler]) => {
        const guarded = () => {
            if (isMine()) handler();
        };
        player.addEventListener(event, guarded);
        return [event, guarded] as const;
    });

    onMount(() => {
        void readShape();
        // A song picked from the list starts at once.
        if (audio.startPlaying) play();
    });

    onDestroy(() => {
        cancelAnimationFrame(frame);
        stopOpening?.();
        for (const [event, handler] of handlers) player.removeEventListener(event, handler);
        ownPlayback?.destroy();
        // The next song may have taken the element already: only this one's is let go.
        if (isMine()) {
            player.pause();
            player.removeAttribute("src");
            player.load();
        }
    });
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="audio-player"
    class:compact
    class:pinned
    bind:clientWidth={width}
    bind:clientHeight={height}
    on:keydown={onKey}
    data-testid="fileViewerAudio"
>
    <div class="stage">
        {#if failed}
            <div class="stage-failed">
                <IconAlertTriangle font-size="28" />
                <b>{$LL.chat.audioFile.cantPlay()}</b>
                <button type="button" class="u-cta stage-download" on:click={() => onDownload?.()}>
                    <IconDownload font-size="18" />
                    {$LL.chat.audioFile.download()}
                </button>
            </div>
        {:else}
            <canvas bind:this={canvas} class="stage-canvas" aria-hidden="true" />
        {/if}
    </div>

    <div class="track">
        <div class="track-title">{title}</div>
        <div class="track-sub">
            {[
                audioFileTitle(name) ? (sentByMe ? $LL.chat.details.you() : senderName) : undefined,
                currentTrack ? sentLabel(currentTrack.message.date, $locale) : undefined,
                kind,
                currentTrack?.size !== undefined
                    ? formatFileSize(currentTrack.size)
                    : fileSize !== undefined
                    ? formatFileSize(fileSize)
                    : undefined,
            ]
                .filter(Boolean)
                .join(" · ")}
        </div>
    </div>

    <div class="scrub-wrap">
        <div
            class="scrub"
            class:plain={!levels}
            role="slider"
            tabindex="0"
            aria-label={$LL.chat.audioFile.position()}
            aria-valuemin={0}
            aria-valuemax={duration ? Math.round(duration) : 0}
            aria-valuenow={Math.round(current)}
            class:dragging={dragAt !== undefined}
            on:pointerdown={startDrag}
            on:pointermove={moveDrag}
            on:pointerup={endDrag}
            on:pointercancel={cancelDrag}
            on:keydown={onScrubKey}
        >
            {#if levels}
                {#each levels as level, bar (bar)}
                    <span
                        class="bar"
                        class:played={bar / SCRUB_BARS < progress}
                        style="height: {Math.round(8 + level * 40)}px"
                    />
                {/each}
            {:else}
                <span class="line"><span class="fill" style="width: {progress * 100}%" /></span>
            {/if}
            <span class="head" style="left: {progress * 100}%" />
        </div>
        <div class="times">
            <span>{formatDuration(shownTime)}</span>
            <span>{duration ? `-${formatDuration(Math.max(0, duration - shownTime))}` : "--:--"}</span>
        </div>
    </div>

    <div class="controls">
        <div class="side">
            <button
                type="button"
                class="speed u-cta-secondary"
                on:click={cycleSpeed}
                aria-label={$LL.chat.voiceNote.speed()}
                disabled={failed}
            >
                {SPEEDS[speed]}×
            </button>
        </div>
        <div class="transport">
            {#if hasList}
                <button
                    type="button"
                    class="tbtn"
                    aria-label={$LL.chat.audioFile.previous()}
                    disabled={failed && index <= 0}
                    on:click={previous}
                >
                    <IconPlayerSkipBackFilled font-size="22" />
                </button>
            {/if}
            <button
                type="button"
                class="tbtn"
                aria-label={$LL.chat.audioFile.back()}
                disabled={failed}
                on:click={() => skip(-10)}
            >
                <IconRewindBackward10 font-size="24" />
            </button>
            <button
                type="button"
                class="play u-cta"
                on:click={toggle}
                disabled={failed}
                aria-label={playing ? $LL.chat.voiceNote.pause() : $LL.chat.voiceNote.play()}
            >
                {#if playing}<IconPauseFilled font-size="30" />{:else}<IconPlayFilled font-size="30" />{/if}
            </button>
            <button
                type="button"
                class="tbtn"
                aria-label={$LL.chat.audioFile.forward()}
                disabled={failed}
                on:click={() => skip(10)}
            >
                <IconRewindForward10 font-size="24" />
            </button>
            {#if hasList}
                <button
                    type="button"
                    class="tbtn"
                    aria-label={$LL.chat.audioFile.next()}
                    disabled={index >= $tracks.length - 1}
                    on:click={() => openTrack($tracks[index + 1])}
                >
                    <IconPlayerSkipForwardFilled font-size="22" />
                </button>
            {/if}
        </div>
        <div class="side end">
            {#if !compact}
                <!-- Like YouTube and SoundCloud: a tap mutes, pointing at it (or Tab to it) shows the level above it. -->
                <div class="vol">
                    <button
                        type="button"
                        class="tbtn"
                        aria-label={muted ? $LL.chat.audioFile.unmute() : $LL.chat.audioFile.mute()}
                        on:click={() => (muted = !muted)}
                    >
                        {#if muted || volume === 0}
                            <IconVolumeOff font-size="22" />
                        {:else if volume < 0.5}
                            <IconVolume2 font-size="22" />
                        {:else}
                            <IconUnMute font-size="22" />
                        {/if}
                    </button>
                    <div class="vol-pop">
                        <div
                            class="vol-slider"
                            role="slider"
                            tabindex="0"
                            aria-label={$LL.chat.audioFile.volume()}
                            aria-orientation="vertical"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
                            on:pointerdown={(event) => {
                                volumeDragging = true;
                                event.currentTarget.setPointerCapture(event.pointerId);
                                volumeAt(event);
                            }}
                            on:pointermove={(event) => volumeDragging && volumeAt(event)}
                            on:pointerup={() => (volumeDragging = false)}
                            on:keydown={onVolumeKey}
                        >
                            <span class="vol-track">
                                <span class="vol-fill" style="height: {(muted ? 0 : volume) * 100}%" />
                                <span class="vol-thumb" style="bottom: calc({muted ? 0 : volume} * (100% - 12px))" />
                            </span>
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    </div>

    {#if hasList}
        <div class="queue" bind:this={queue}>
            <div class="queue-label">{$LL.chat.audioFile.inThisChat({ count: $tracks.length })}</div>
            <div class="queue-list" bind:this={queueList}>
                {#each $tracks as track, position (track.key)}
                    {@const isCurrent = position === index}
                    <button
                        type="button"
                        class="queue-row"
                        class:current={isCurrent}
                        aria-current={isCurrent ? "true" : undefined}
                        aria-busy={openingKey === track.key}
                        on:click={() => !isCurrent && openTrack(track)}
                    >
                        <span class="queue-mark">
                            {#if isCurrent && playing}
                                <span class="eq"><i /><i /><i /></span>
                            {:else}
                                {position + 1}
                            {/if}
                        </span>
                        <span class="queue-text">
                            <span class="queue-title"
                                >{audioFileTitle(track.name) ?? $LL.chat.audioFile.untitled()}</span
                            >
                            <span class="queue-sub">
                                {[
                                    sharedSender(track.message, $LL.chat.details.you()),
                                    track.size !== undefined ? formatFileSize(track.size) : undefined,
                                    sentLabel(track.message.date, $locale),
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </span>
                        </span>
                    </button>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    .audio-player {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 20px 24px 28px;
        box-sizing: border-box;
        font-family: inherit;
    }
    .audio-player.compact {
        padding: 14px 16px 20px;
        gap: 16px;
    }
    .stage {
        position: relative;
        flex: none;
        height: 260px;
        border-radius: 20px;
        overflow: hidden;
        background: radial-gradient(120% 90% at 18% 10%, rgba(134, 41, 252, 0.32), transparent 60%),
            radial-gradient(90% 80% at 90% 100%, rgba(65, 86, 246, 0.26), transparent 65%), #110e1f;
        border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .compact .stage {
        height: 168px;
    }
    .stage-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
    }
    .stage-failed {
        position: absolute;
        inset: 0;
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 12px;
        padding: 16px;
        text-align: center;
        color: rgba(255, 255, 255, 0.85);
        font-size: 14px;
    }
    .stage-failed b {
        font-weight: 500;
        max-width: 280px;
    }
    .stage-download {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 18px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 700;
        font-family: inherit;
        box-sizing: border-box;
    }
    .track {
        display: grid;
        gap: 4px;
        min-width: 0;
    }
    .track-title {
        font-size: 22px;
        line-height: 28px;
        font-weight: 700;
        color: #fff;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .compact .track-title {
        font-size: 19px;
        line-height: 24px;
    }
    .track-sub {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.55);
    }
    .scrub-wrap {
        display: grid;
        gap: 6px;
    }
    .scrub {
        position: relative;
        height: 52px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        touch-action: none;
        outline: none;
    }
    .scrub:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: 4px;
        border-radius: 8px;
    }
    /* As in the chat's player: what has played is white. */
    .scrub .bar {
        flex: none;
        width: 3px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.3);
    }
    .scrub .bar.played {
        background: #fff;
    }
    .scrub .line {
        position: relative;
        width: 100%;
        height: 4px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.18);
    }
    .scrub .fill {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: 9999px;
        background: #fff;
    }
    .head {
        position: absolute;
        top: 50%;
        width: 14px;
        height: 14px;
        margin: -7px 0 0 -7px;
        border-radius: 9999px;
        background: #fff;
        box-shadow: 0 0 0 4px rgba(134, 41, 252, 0.35);
        pointer-events: none;
    }
    .times {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
        font-variant-numeric: tabular-nums;
    }
    .controls {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 8px;
    }
    .side {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }
    .side.end {
        justify-content: flex-end;
    }
    .transport {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .compact .transport {
        gap: 2px;
    }
    .tbtn {
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        background: transparent;
        color: #fff;
        cursor: pointer;
        font-family: inherit;
    }
    .tbtn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
    }
    .tbtn:disabled {
        opacity: 0.3;
        cursor: default;
    }
    .play {
        width: 64px;
        height: 64px;
        padding: 0;
        margin: 0 6px;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        font-family: inherit;
    }
    .speed {
        min-width: 44px;
        height: 30px;
        padding: 0 10px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        box-sizing: border-box;
    }
    .vol {
        position: relative;
    }
    .vol-pop {
        position: absolute;
        left: 50%;
        bottom: 100%;
        transform: translateX(-50%);
        padding-bottom: 6px;
        display: none;
        z-index: 2;
    }
    .vol:hover .vol-pop,
    .vol:focus-within .vol-pop {
        display: block;
    }
    .vol-slider {
        width: 44px;
        height: 132px;
        box-sizing: border-box;
        padding: 14px 0;
        display: flex;
        justify-content: center;
        border-radius: 14px;
        background: #1f1b33;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
        cursor: pointer;
        touch-action: none;
        outline: none;
    }
    .vol-slider:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: 2px;
    }
    /* The dot stays inside the bar at both ends. */
    .vol-track {
        position: relative;
        width: 4px;
        height: 100%;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.2);
    }
    .vol-fill {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        border-radius: 9999px;
        background: linear-gradient(0deg, #8629fc, #4156f6);
    }
    .vol-thumb {
        position: absolute;
        left: 50%;
        width: 12px;
        height: 12px;
        margin-left: -6px;
        border-radius: 9999px;
        background: #fff;
    }
    .queue {
        display: flex;
        flex-direction: column;
        padding-top: 4px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .queue-list {
        display: grid;
        align-content: start;
        gap: 2px;
    }
    /* The player stays where it is and only the songs scroll. */
    .audio-player.pinned {
        overflow-y: hidden;
    }
    .pinned .queue {
        flex: 1 1 0;
        min-height: 0;
        margin-bottom: -28px;
    }
    .pinned .queue-list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding-bottom: 28px;
    }
    .compact.pinned .queue {
        margin-bottom: -20px;
    }
    .compact.pinned .queue-list {
        padding-bottom: 20px;
    }
    .queue-label {
        padding: 12px 0 6px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .queue-row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 52px;
        padding: 6px 10px;
        border-radius: 12px;
        border: 1px solid transparent;
        background: transparent;
        color: inherit;
        text-align: start;
        cursor: pointer;
        font-family: inherit;
        box-sizing: border-box;
    }
    .queue-row:hover {
        background: rgba(255, 255, 255, 0.06);
    }
    .queue-row.current {
        background: rgba(134, 41, 252, 0.14);
        border-color: rgba(167, 139, 250, 0.7);
        cursor: default;
    }
    .queue-mark {
        width: 24px;
        flex: none;
        text-align: center;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.5);
        font-variant-numeric: tabular-nums;
    }
    .queue-text {
        display: grid;
        min-width: 0;
    }
    .queue-title {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.92);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .queue-sub {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.45);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .eq {
        display: inline-flex;
        align-items: flex-end;
        gap: 2px;
        height: 14px;
    }
    .eq i {
        width: 3px;
        border-radius: 2px;
        background: #c4b5fd;
        animation: eq 0.9s ease-in-out infinite;
    }
    .eq i:nth-child(2) {
        animation-delay: -0.3s;
    }
    .eq i:nth-child(3) {
        animation-delay: -0.6s;
    }
    @keyframes eq {
        0%,
        100% {
            height: 4px;
        }
        50% {
            height: 14px;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .eq i {
            animation: none;
            height: 10px;
        }
    }
</style>
