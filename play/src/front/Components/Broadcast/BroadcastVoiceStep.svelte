<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import type { BroadcastReach } from "../../Stores/BroadcastStore";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import WaveBars from "./WaveBars.svelte";
    import { reachTitle } from "./reach";
    import { sendBroadcastVoice } from "./send";
    import type { VoiceRecorder } from "./voiceRecorder";
    import { describeAudioFile, formatDuration, startVoiceRecorder, WAVE_BARS, waveShape } from "./voiceRecorder";
    import {
        IconCloudUpload,
        IconMicrophone,
        IconPauseFilled,
        IconPlayFilled,
        IconSpeakerPhone,
        IconX,
    } from "@wa-icons";

    export let reach: BroadcastReach;

    const dispatch = createEventDispatcher<{ sent: void }>();

    /** Three minutes is plenty for a voice note; longer goes in as a file. */
    const MAX_SECONDS = 180;
    const MAX_FILE_BYTES = 20 * 1024 * 1024;
    const FILE_TYPES = [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/ogg",
        "audio/mp4",
        "audio/x-m4a",
        "audio/aac",
        "audio/webm",
    ];

    // "ready": nothing recorded yet. Recording starts when the record button is pressed, never by itself.
    type State = "ready" | "starting" | "recording" | "review" | "blocked";
    let state: State = "ready";
    let recorder: VoiceRecorder | undefined;
    let liveLevels: number[] = new Array<number>(WAVE_BARS).fill(0.08);
    let seconds = 0;
    let ticker: ReturnType<typeof setInterval> | undefined;

    let audio: { blob: Blob; name: string; levels: number[]; duration: number } | undefined;
    let audioUrl: string | undefined;
    let player: HTMLAudioElement | undefined;
    let playing = false;
    let caption = "";
    let error: string | undefined;
    let sending = false;
    let fileInput: HTMLInputElement;

    let opening = false;
    /**
     * Bumped when a file is chosen or a recording starts, so whichever came last wins: a microphone granted after a
     * file was picked is let go, and a file decoded after "Record again" is dropped instead of covering a live take.
     */
    let chosen = 0;

    /** @param keepReview "Record again": the review (and its recording) stays on screen until the microphone is granted. */
    async function startRecording(keepReview = false) {
        if (opening) return;
        opening = true;
        error = undefined;
        if (!keepReview) state = "starting";
        const mine = ++chosen;
        let started: VoiceRecorder;
        try {
            started = await startVoiceRecorder();
        } catch (e) {
            console.warn("Broadcast: the microphone could not be opened for a voice note", e);
            if (keepReview) error = $LL.broadcast.voice.micBlocked();
            else state = "blocked";
            return;
        } finally {
            // eslint-disable-next-line require-atomic-updates
            opening = false;
        }
        // The card closed, or a file was chosen, while the browser was asking for the microphone: let it go again.
        if (destroyed || mine !== chosen) {
            started.stop().catch(() => {});
            return;
        }
        recorder = started;
        state = "recording";
        seconds = 0;
        const startedAt = Date.now();
        ticker = setInterval(() => {
            seconds = Math.floor((Date.now() - startedAt) / 1000);
            liveLevels = [...liveLevels.slice(1), recorder?.level() ?? 0];
            if (seconds >= MAX_SECONDS) stopRecording().catch((e) => console.error(e));
        }, 100);
    }

    async function stopRecording() {
        if (!recorder) return;
        const current = recorder;
        recorder = undefined;
        if (ticker) clearInterval(ticker);
        ticker = undefined;
        const mine = chosen;
        let stopped: Awaited<ReturnType<VoiceRecorder["stop"]>>;
        try {
            stopped = await current.stop();
        } catch (e) {
            console.warn("Broadcast: the voice note could not be saved", e);
            if (destroyed) return;
            // The take is lost: the one reviewed before stays, else the card goes back to the record button.
            state = audio ? "review" : "ready";
            // A file picked while the take was being saved decides what shows next.
            if (mine !== chosen) return;
            error = $LL.broadcast.voice.recordingFailed();
            return;
        }
        // A file picked while the take was being saved wins over it.
        if (mine !== chosen) {
            if (!destroyed && state === "recording") state = audio ? "review" : "ready";
            return;
        }
        const { blob, samples, sampleRate } = stopped;
        setAudio(blob, "voice-note.wav", waveShape(samples), samples.length / sampleRate);
    }

    // A recording or a decoded file that lands after the card closed is dropped: its URL would never be revoked.
    let destroyed = false;

    function setAudio(blob: Blob, name: string, levels: number[], duration: number) {
        if (destroyed) return;
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        progress = 0;
        audio = { blob, name, levels, duration };
        audioUrl = URL.createObjectURL(blob);
        playing = false;
        state = "review";
    }

    async function recordAgain() {
        if (player) player.pause();
        await startRecording(true);
    }

    function pickFile() {
        fileInput.click();
    }

    async function onFile(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        await useFile(file);
    }

    // A sound file dropped on the step is taken like one picked with "Use a file", as the old upload did.
    function onDragOver(event: DragEvent) {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }

    function onDrop(event: DragEvent) {
        const file = event.dataTransfer?.files[0];
        if (!file) return;
        event.preventDefault();
        useFile(file).catch((e) => console.error(e));
    }

    async function useFile(file: File) {
        const looksLikeAudio = FILE_TYPES.includes(file.type) || /\.(mp3|wav|ogg|oga|m4a|aac|webm)$/i.test(file.name);
        if (!looksLikeAudio || file.size > MAX_FILE_BYTES) {
            error = $LL.broadcast.voice.wrongFile();
            return;
        }
        error = undefined;
        // The take being saved reads `chosen` before this pick counts, so it is dropped instead of shown first.
        const stopping = recorder ? stopRecording() : undefined;
        const mine = ++chosen;
        if (stopping) await stopping;
        try {
            const { levels, duration } = await describeAudioFile(file);
            // Another file was picked while this one decoded: the later pick wins.
            if (mine !== chosen) return;
            setAudio(file, file.name, levels, duration);
        } catch (e) {
            console.warn("Broadcast: the file could not be decoded", e);
            if (mine !== chosen) return;
            // The file was picked while the microphone was being opened, and that recorder was let go.
            if (state === "starting" && !recorder && !opening && !destroyed) state = "ready";
            error = $LL.broadcast.voice.wrongFile();
        }
    }

    function togglePlay() {
        if (!player) return;
        if (playing) player.pause();
        else player.play().catch((e) => console.error(e));
    }

    // Where playback is, 0 to 1: a white line over the wave, which can be dragged (or moved with the arrow keys)
    // to listen from another point.
    let progress = 0;
    let progressFrame: number | undefined;
    let wave: HTMLDivElement | undefined;
    let scrubbing = false;

    function length(): number {
        const fromPlayer = player?.duration;
        return fromPlayer && Number.isFinite(fromPlayer) ? fromPlayer : audio?.duration ?? 0;
    }

    function followPlayback() {
        if (!playing) {
            progressFrame = undefined;
            return;
        }
        if (player && length() > 0 && !scrubbing) progress = Math.min(1, player.currentTime / length());
        progressFrame = requestAnimationFrame(followPlayback);
    }

    function onPlay() {
        playing = true;
        if (progressFrame === undefined) progressFrame = requestAnimationFrame(followPlayback);
    }

    function onEnded() {
        playing = false;
        progress = 0;
    }

    function seekTo(fraction: number) {
        progress = Math.max(0, Math.min(1, fraction));
        if (player && length() > 0) player.currentTime = progress * length();
    }

    function seekToPointer(event: PointerEvent) {
        if (!wave) return;
        const box = wave.getBoundingClientRect();
        if (box.width > 0) seekTo((event.clientX - box.left) / box.width);
    }

    function onWavePointerDown(event: PointerEvent) {
        if (!wave) return;
        scrubbing = true;
        wave.setPointerCapture(event.pointerId);
        seekToPointer(event);
    }

    function onWavePointerMove(event: PointerEvent) {
        if (scrubbing) seekToPointer(event);
    }

    function onWavePointerUp() {
        scrubbing = false;
    }

    function onWaveKeyDown(event: KeyboardEvent) {
        const step = length() > 0 ? 5 / length() : 0.1;
        if (event.key === "ArrowRight") seekTo(progress + step);
        else if (event.key === "ArrowLeft") seekTo(progress - step);
        else if (event.key === "Home") seekTo(0);
        else if (event.key === "End") seekTo(1);
        else return;
        event.preventDefault();
    }

    async function send() {
        if (!audio || sending) return;
        sending = true;
        error = undefined;
        try {
            analyticsClient.sendGlobalSoundMessage();
            await sendBroadcastVoice(audio.blob, audio.name, reach, caption);
            dispatch("sent");
        } catch (e) {
            console.error(e);
            error = $LL.broadcast.voice.uploadFailed();
        } finally {
            // eslint-disable-next-line require-atomic-updates
            sending = false;
        }
    }

    onMount(() => {
        menuInputFocusStore.set(true);
    });

    onDestroy(() => {
        destroyed = true;
        menuInputFocusStore.set(false);
        if (ticker) clearInterval(ticker);
        recorder?.stop().catch(() => {});
        if (progressFrame !== undefined) cancelAnimationFrame(progressFrame);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
    });
</script>

<input
    class="hidden"
    type="file"
    accept="audio/*,.mp3,.wav,.ogg,.m4a"
    bind:this={fileInput}
    on:change={onFile}
    data-testid="broadcast-voice-file"
/>

<!-- Takes the steps' place in the card's column (display: contents) so a file can be dropped on any part of it. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="contents" on:dragover={onDragOver} on:drop={onDrop} data-testid="broadcast-voice-drop">
    {#if state === "ready" || state === "starting" || state === "recording"}
        <div class="flex flex-col items-center gap-2 py-2">
            <div class="text-3xl font-bold tabular-nums leading-none">{formatDuration(seconds)}</div>
            <WaveBars levels={liveLevels} height={36} />
            {#if state === "ready"}
                <button
                    type="button"
                    class="u-cta-coral rounded-full grid place-items-center w-[88px] h-[88px] mt-1"
                    on:click={() => startRecording().catch((e) => console.error(e))}
                    aria-label={$LL.broadcast.voice.record()}
                    data-testid="broadcast-voice-record"
                >
                    <IconMicrophone font-size="36" aria-hidden="true" />
                </button>
                <p class="m-0 text-sm text-white/60">{$LL.broadcast.voice.tapToRecord()}</p>
            {:else}
                <button
                    type="button"
                    class="u-cta-coral rounded-full grid place-items-center w-[88px] h-[88px] mt-1"
                    on:click={() => stopRecording().catch((e) => console.error(e))}
                    disabled={state !== "recording"}
                    aria-label={$LL.broadcast.voice.recording()}
                    data-testid="broadcast-voice-stop"
                >
                    <span class="block w-6 h-6 rounded-[4px] bg-white" aria-hidden="true" />
                </button>
                <p class="m-0 text-sm text-white/60">{$LL.broadcast.voice.recording()}</p>
            {/if}
        </div>
        <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-white/60">{$LL.broadcast.voice.haveFile()}</span>
            <button
                type="button"
                class="u-cta-secondary rounded-full px-4 py-2.5 text-sm font-bold flex items-center gap-2"
                on:click={pickFile}
            >
                <IconCloudUpload font-size="18" aria-hidden="true" />
                {$LL.broadcast.voice.useFile()}
            </button>
        </div>
    {:else if state === "blocked"}
        <div class="flex flex-col items-center text-center gap-3 py-4">
            <span class="grid place-items-center text-white/60" aria-hidden="true">
                <IconMicrophone font-size="28" />
            </span>
            <p class="m-0 text-sm text-white/70">{$LL.broadcast.voice.micBlocked()}</p>
            <div class="flex gap-2">
                <button
                    type="button"
                    class="u-cta-secondary rounded-full px-4 py-2.5 text-sm font-bold"
                    on:click={recordAgain}
                >
                    {$LL.broadcast.voice.recordAgain()}
                </button>
                <button
                    type="button"
                    class="u-cta rounded-full px-4 py-2.5 text-sm font-bold flex items-center gap-2"
                    on:click={pickFile}
                >
                    <IconCloudUpload font-size="18" aria-hidden="true" />
                    {$LL.broadcast.voice.useFile()}
                </button>
            </div>
        </div>
    {:else if state === "review" && audio}
        <h3 class="m-0 text-base font-semibold">{$LL.broadcast.voice.listen()}</h3>
        <div class="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-3">
            <button
                type="button"
                class="u-cta rounded-full grid place-items-center w-12 h-12 flex-none"
                on:click={togglePlay}
                aria-label={playing ? $LL.broadcast.received.pause() : $LL.broadcast.received.play()}
                data-testid="broadcast-voice-play"
            >
                {#if playing}
                    <IconPauseFilled font-size="20" />
                {:else}
                    <IconPlayFilled font-size="20" />
                {/if}
            </button>
            <!-- The line and the pointer follow the bars themselves, not the space around them. -->
            <div class="flex-1 min-w-0 flex justify-center">
                <div
                    class="relative w-fit max-w-full cursor-pointer touch-none select-none outline-none rounded focus-visible:ring-2 focus-visible:ring-violet-300"
                    bind:this={wave}
                    role="slider"
                    tabindex="0"
                    aria-label={$LL.broadcast.voice.position()}
                    aria-valuemin={0}
                    aria-valuemax={Math.round(audio.duration)}
                    aria-valuenow={Math.round(progress * audio.duration)}
                    aria-valuetext={formatDuration(progress * audio.duration)}
                    on:pointerdown={onWavePointerDown}
                    on:pointermove={onWavePointerMove}
                    on:pointerup={onWavePointerUp}
                    on:pointercancel={onWavePointerUp}
                    on:keydown={onWaveKeyDown}
                    data-testid="broadcast-voice-wave"
                >
                    <WaveBars levels={audio.levels} height={32} classList="overflow-hidden" />
                    <span
                        class="absolute -top-1 -bottom-1 w-0.5 -ms-px rounded-full bg-white pointer-events-none"
                        style="left: {progress * 100}%; box-shadow: 0 0 6px rgba(0, 0, 0, 0.6)"
                        aria-hidden="true"
                        data-testid="broadcast-voice-position"
                    />
                </div>
            </div>
            <span class="text-sm text-white/60 tabular-nums flex-none">{formatDuration(audio.duration)}</span>
            <audio
                src={audioUrl}
                bind:this={player}
                on:play={onPlay}
                on:pause={() => (playing = false)}
                on:ended={onEnded}
            />
        </div>
        <div class="flex gap-2">
            <button
                type="button"
                class="u-cta-secondary rounded-full flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2"
                on:click={recordAgain}
            >
                <IconMicrophone font-size="18" aria-hidden="true" />
                {$LL.broadcast.voice.recordAgain()}
            </button>
            <button
                type="button"
                class="u-cta-secondary rounded-full flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2"
                on:click={pickFile}
            >
                <IconCloudUpload font-size="18" aria-hidden="true" />
                {$LL.broadcast.voice.useFile()}
            </button>
        </div>
        <input
            type="text"
            class="u-field"
            placeholder={$LL.broadcast.voice.caption()}
            maxlength="200"
            bind:value={caption}
            data-testid="broadcast-voice-caption"
        />
        <button
            type="button"
            class="u-cta rounded-full w-full py-3.5 text-base font-bold flex items-center justify-center gap-2"
            on:click={send}
            disabled={sending}
            data-testid="broadcast-send"
        >
            <IconSpeakerPhone font-size="18" aria-hidden="true" />
            {$LL.broadcast.reach.sendTo({ reach: reachTitle($LL, reach) })}
        </button>
    {/if}

    {#if error}
        <div class="u-error-line" role="alert">
            <span class="flex-1">{error}</span>
            <button
                type="button"
                class="u-chip-remove"
                on:click={() => (error = undefined)}
                aria-label={$LL.broadcast.close()}
            >
                <IconX font-size="14" />
            </button>
        </div>
    {/if}
</div>
