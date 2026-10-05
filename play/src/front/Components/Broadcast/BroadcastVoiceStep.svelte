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
    // Matches the uploader's audio message limit.
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
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

    type State = "starting" | "recording" | "review" | "blocked";
    let state: State = "starting";
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

    /** @param restart With no take to fall back on, open the microphone again when this one can't be saved. */
    async function stopRecording(restart = true) {
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
            // The take is lost: the one reviewed before stays, else the card goes back to the start.
            state = audio ? "review" : "starting";
            // A file picked while the take was being saved decides what shows next.
            if (mine !== chosen) return;
            if (!audio && restart) startRecording().catch((err) => console.error(err));
            error = $LL.broadcast.voice.recordingFailed();
            return;
        }
        // A file picked while the take was being saved wins over it.
        if (mine !== chosen) {
            if (!destroyed && state === "recording") state = audio ? "review" : "starting";
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
        const looksLikeAudio =
            FILE_TYPES.includes(file.type) || /\.(mp3|wav|ogg|oga|opus|m4a|aac|webm|flac)$/i.test(file.name);
        if (!looksLikeAudio || file.size > MAX_FILE_BYTES) {
            error = $LL.broadcast.voice.wrongFile();
            return;
        }
        error = undefined;
        const mine = ++chosen;
        if (recorder) await stopRecording(false);
        try {
            const { levels, duration } = await describeAudioFile(file);
            // Another file was picked while this one decoded: the later pick wins.
            if (mine !== chosen) return;
            setAudio(file, file.name, levels, duration);
        } catch (e) {
            console.warn("Broadcast: the file could not be decoded", e);
            if (mine !== chosen) return;
            // The file was picked while the microphone was being opened, and that recorder was let go: ask again.
            if (state === "starting" && !recorder && !opening && !destroyed) {
                startRecording().catch((err) => console.error(err));
            }
            error = $LL.broadcast.voice.wrongFile();
        }
    }

    function togglePlay() {
        if (!player) return;
        if (playing) player.pause();
        else player.play().catch((e) => console.error(e));
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
        startRecording().catch((e) => console.error(e));
    });

    onDestroy(() => {
        destroyed = true;
        menuInputFocusStore.set(false);
        if (ticker) clearInterval(ticker);
        recorder?.stop().catch(() => {});
        if (audioUrl) URL.revokeObjectURL(audioUrl);
    });
</script>

<input
    class="hidden"
    type="file"
    accept="audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.webm,.flac"
    bind:this={fileInput}
    on:change={onFile}
    data-testid="broadcast-voice-file"
/>

{#if state === "starting" || state === "recording"}
    <div class="flex flex-col items-center gap-2 py-2">
        <div class="text-3xl font-bold tabular-nums leading-none">{formatDuration(seconds)}</div>
        <WaveBars levels={liveLevels} height={36} />
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
        <span class="grid place-items-center w-14 h-14 rounded-2xl bg-white/5 text-white/60" aria-hidden="true">
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
        <WaveBars levels={audio.levels} height={32} classList="flex-1 min-w-0 overflow-hidden" />
        <span class="text-sm text-white/60 tabular-nums flex-none">{formatDuration(audio.duration)}</span>
        <audio
            src={audioUrl}
            bind:this={player}
            on:play={() => (playing = true)}
            on:pause={() => (playing = false)}
            on:ended={() => (playing = false)}
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
