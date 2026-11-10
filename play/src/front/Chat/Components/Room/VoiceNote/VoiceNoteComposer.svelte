<script lang="ts">
    import { onDestroy } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import { singlePlayback } from "../../../../Utils/SinglePlayback";
    import WaveBars from "../../../../Components/Broadcast/WaveBars.svelte";
    import { formatDuration } from "../../../../Components/Broadcast/voiceRecorder";
    import {
        browserRecordingFormat,
        resampleWaveform,
        VOICE_NOTE_BARS,
        VOICE_NOTE_MAX_SECONDS,
        VOICE_NOTE_WARNING_SECONDS,
        type UnsentVoiceNote,
        type VoiceNoteDetails,
    } from "../../../VoiceNote/VoiceNote";
    import {
        makeVoiceNoteContext,
        startVoiceNoteRecording,
        type VoiceNoteRecording,
    } from "../../../VoiceNote/VoiceNoteRecorder";
    import { HOLD_START_MS, holdMove, holdRelease, type HoldAxis, type HoldMove } from "../../../VoiceNote/HoldGesture";
    import {
        IconChevronLeft,
        IconChevronRight,
        IconChevronUp,
        IconLock,
        IconLockOpen,
        IconMicrophoneOn,
        IconPauseFilled,
        IconPlayFilled,
        IconSend,
        IconTrash,
    } from "@wa-icons";

    /** Whether the mic shows when nothing is being recorded: the box is empty and files can be sent here. */
    export let canRecord = false;
    /** Sends the note and says whether it went. When it did not, the note stays here to be sent again. */
    export let onSend: (file: File, details: VoiceNoteDetails) => Promise<boolean>;
    /** Says why recording could not start (the microphone is blocked or missing). */
    export let onError: (message: string) => void;
    /** Called when a recording has started, so the box can note who the note is for. */
    export let onStart: () => void = () => undefined;
    /** True from the first tap on the mic until the note is sent or deleted: the message box gives way to this. */
    export let active = false;

    type State = "idle" | "recording" | "review";
    let state: State = "idle";
    // While a finger holds the mic the recorder is already in charge of the bar, a moment before the recording starts.
    $: active = state !== "idle" || holding;

    const format = browserRecordingFormat();
    const LIVE_BARS = 28;

    let recording: VoiceNoteRecording | undefined;
    // The recording being finished into a note, while it is: what `takeNote` hands over when it comes in that moment.
    let finishing: Promise<UnsentVoiceNote> | undefined;
    // Counts the notes dropped: a stop that finishes after Delete was pressed (or the chat closed) must not bring the
    // note back.
    let dropped = 0;
    // The chat can close while the browser is still asking for the microphone.
    let destroyed = false;
    let starting = false;
    let sending = false;
    let seconds = 0;
    let startedAt = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let live: number[] = new Array<number>(LIVE_BARS).fill(0);

    let note: { file: File; details: VoiceNoteDetails; url: string; shape: number[] } | undefined;
    let player: HTMLAudioElement | undefined;
    let playing = false;
    let current = 0;

    $: left = Math.ceil(VOICE_NOTE_MAX_SECONDS - seconds);
    $: progress = note && note.details.duration > 0 ? Math.min(1, current / note.details.duration) : 0;

    function errorMessage(error: unknown): string {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") return $LL.chat.voiceNote.micBlocked();
        if (name === "NotFoundError" || name === "OverconstrainedError") return $LL.chat.voiceNote.micMissing();
        return $LL.chat.voiceNote.recordingFailed();
    }

    async function start(context?: AudioContext) {
        if (!format || starting || state !== "idle") {
            context?.close().catch(() => {});
            return;
        }
        starting = true;
        hint = "";
        try {
            recording = await startVoiceNoteRecording(format, context);
        } catch (error) {
            console.warn("Could not start a voice note", error);
            endHold();
            onError(errorMessage(error));
            return;
        } finally {
            // eslint-disable-next-line require-atomic-updates
            starting = false;
        }
        if (destroyed) {
            // Allowed after the chat was left: let the microphone go at once.
            recording.cancel();
            recording = undefined;
            return;
        }
        // eslint-disable-next-line require-atomic-updates
        state = "recording";
        // Slid up to lock before the microphone was ready: the recording is open, with no finger needed.
        if (lockWanted) holding = false;
        onStart();
        startedAt = Date.now();
        seconds = 0;
        live = new Array<number>(LIVE_BARS).fill(0);
        timer = setInterval(() => {
            seconds = (Date.now() - startedAt) / 1000;
            live = [...live.slice(1), recording?.level() ?? 0];
            // At the cap it stops by itself and waits for Send.
            if (seconds >= VOICE_NOTE_MAX_SECONDS) {
                stop().catch((error) => console.error(error));
                // A finger still holding is let go of: the note waits for Send.
                if (holding) endHold();
            }
        }, 100);
        // The finger was lifted while the microphone was being asked for: what letting go does happens now.
        if (releasedWhileStarting !== undefined) {
            const release = releasedWhileStarting;
            releasedWhileStarting = undefined;
            finishHold(release).catch((error) => console.error(error));
        }
    }

    // --- Press and hold (phones): hold the mic to record, release to send, slide left to cancel, slide up to lock. ---

    // The finger is on the mic (a touch or a pen; a mouse clicks instead).
    let pressed = false;
    // Held long enough to be a recording: the bar shows how to cancel and lock, and the mic follows the finger.
    let holding = false;
    let lockWanted = false;
    let pressId: number | undefined;
    let pressX = 0;
    let pressY = 0;
    let pressedAt = 0;
    let axis: HoldAxis;
    // Which way the page reads (the mic sits at the end of the line): -1 when right to left, so "away from the mic" is the way a finger slides to cancel.
    let side = 1;
    $: rtl = side < 0;
    let move: HoldMove = holdMove(0, 0, undefined);
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    // Made when the finger lands (a tap on an iPhone is what lets sound run), used by the recording that may follow.
    let pressContext: AudioContext | undefined;
    // A note released from a hold is on its way: the bar says so instead of showing the recorder for that moment.
    let quickSend = false;
    // The finger came up (or was taken away) before the microphone was ready: what to do once it is.
    let releasedWhileStarting: "send" | "cancel" | "review" | undefined;
    // What last touched the mic: a click that follows a touch or a pen is the end of that press, not a second start.
    let lastPressType = "mouse";
    // The hint over the mic: how to record, shown after a tap or a note too short to send.
    let hint = "";
    let hintTimer: ReturnType<typeof setTimeout> | undefined;

    $: cancelArmed = move.cancel >= 1;

    // The hint after a tap also offers a way in for a finger that cannot hold (one hand, switch access, motor needs): tap it to record.
    let hintTap = false;

    function showHint(text: string, tapToo = false) {
        hint = text;
        hintTap = tapToo;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => (hint = ""), tapToo ? 4000 : 2600);
    }

    // Opens the recorder locked, as the keyboard and screen readers do: no hold is needed.
    function recordFromHint() {
        hint = "";
        clearTimeout(hintTimer);
        start().catch((error) => console.error(error));
    }

    // The finger is watched on the window, not only on the mic: locking swaps the mic for the recorder bar, and the
    // lift that follows must still be seen (to let sound run on iOS, and to end the press).
    function watchLift() {
        unwatchLift();
        window.addEventListener("pointerup", onPressEnd);
        window.addEventListener("pointercancel", onPressEnd);
    }

    function unwatchLift() {
        window.removeEventListener("pointerup", onPressEnd);
        window.removeEventListener("pointercancel", onPressEnd);
    }

    function endHold() {
        unwatchLift();
        releasedWhileStarting = undefined;
        clearTimeout(holdTimer);
        holdTimer = undefined;
        pressed = false;
        holding = false;
        lockWanted = false;
        pressId = undefined;
        axis = undefined;
        move = holdMove(0, 0, undefined);
        if (pressContext) {
            // Not handed to a recording: let it go.
            pressContext.close().catch(() => {});
            pressContext = undefined;
        }
    }

    function onPressStart(event: PointerEvent) {
        lastPressType = event.pointerType;
        // A mouse has no hold: it clicks, as it always did.
        if (event.pointerType === "mouse" || !event.isPrimary || pressed || !format || state !== "idle" || starting)
            return;
        pressed = true;
        pressId = event.pointerId;
        pressX = event.clientX;
        pressY = event.clientY;
        side = getComputedStyle(event.currentTarget as HTMLElement).direction === "rtl" ? -1 : 1;
        pressedAt = Date.now();
        axis = undefined;
        move = holdMove(0, 0, undefined);
        hint = "";
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
            // The pointer is already gone.
        }
        pressContext ??= makeVoiceNoteContext();
        watchLift();
        holdTimer = setTimeout(beginHold, HOLD_START_MS);
    }

    function beginHold() {
        holdTimer = undefined;
        if (!pressed) return;
        holding = true;
        // A short buzz where the phone has one (not an iPhone): the recording has started.
        navigator.vibrate?.(12);
        const context = pressContext;
        pressContext = undefined;
        start(context).catch((error) => console.error(error));
    }

    function onPressMove(event: PointerEvent) {
        if (!pressed || event.pointerId !== pressId) return;
        move = holdMove((event.clientX - pressX) * side, event.clientY - pressY, axis);
        axis = move.axis;
        if (holding && move.lock >= 1 && !lockWanted) {
            // Locked: the finger can lift. The bar becomes the recorder (delete, timer, meter, stop, send).
            lockWanted = true;
            navigator.vibrate?.(18);
            if (state === "recording") holding = false;
        }
    }

    function onPressEnd(event: PointerEvent) {
        if (!pressed || event.pointerId !== pressId) return;
        // A finger lifting is a tap to iOS: the one moment it lets sound run, if it had not yet.
        recording?.resume?.();
        const cancelled = event.type === "pointercancel";
        const wasHolding = holding;
        const wasLocked = lockWanted;
        const slidAway = cancelArmed;
        const heldFor = (Date.now() - pressedAt) / 1000;
        try {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
            // Already released.
        }
        if (!wasHolding && !wasLocked) {
            // A tap: nothing is recorded. It says how.
            endHold();
            showHint($LL.chat.voiceNote.holdToRecord(), true);
            return;
        }
        pressed = false;
        if (wasLocked) {
            // The recording is open: lifting the finger changes nothing.
            endHold();
            return;
        }
        // The system took the touch (a call, an edge swipe): what was said is kept for review, never sent or lost.
        const outcome = cancelled ? "review" : holdRelease(slidAway, heldFor) === "cancel" ? "cancel" : "send";
        if (state !== "recording") {
            // The microphone is still being asked for: it is dealt with when it answers.
            releasedWhileStarting = outcome;
            holding = false;
            return;
        }
        finishHold(outcome).catch((error) => console.error(error));
    }

    async function finishHold(outcome: "send" | "cancel" | "review") {
        endHold();
        if (outcome === "cancel") {
            discard();
            return;
        }
        if (outcome === "review") {
            // Nothing worth keeping (the microphone's permission question took the touch): the note is dropped.
            if (holdRelease(false, seconds) === "tooShort") {
                discard();
                showHint($LL.chat.voiceNote.holdAgain());
                return;
            }
            await stop();
            return;
        }
        if (holdRelease(false, seconds) === "tooShort") {
            discard();
            showHint($LL.chat.voiceNote.holdToRecord(), true);
            return;
        }
        // The bar stays quiet while the note goes: the recorder's buttons come back only if it could not be sent.
        quickSend = true;
        try {
            await send();
        } finally {
            quickSend = false;
        }
    }

    /** Space or Enter, or a screen reader's activation: no hold is needed, the recording opens locked. */
    function onClick(event: MouseEvent) {
        // Space, Enter and a screen reader's activation click with no detail; a mouse click has one and is not a touch.
        if (event.detail !== 0 && lastPressType !== "mouse") return;
        start().catch((error) => console.error(error));
    }

    // Set while a recording is being finished: a second Stop, or a Send, in that moment waits for it instead of doing nothing.
    let stopping: Promise<void> | undefined;

    function stop(): Promise<void> {
        stopping ??= finishRecording().finally(() => {
            stopping = undefined;
        });
        return stopping;
    }

    async function finishRecording() {
        clearInterval(timer);
        const stopped = recording;
        recording = undefined;
        if (!stopped) return;
        const droppedBefore = dropped;
        try {
            finishing = stopped.stop();
            const done = await finishing;
            if (dropped !== droppedBefore) return;
            note = {
                ...done,
                url: URL.createObjectURL(done.file),
                shape: resampleWaveform(done.details.waveform, VOICE_NOTE_BARS),
            };
            seconds = done.details.duration;
            state = "review";
        } catch (error) {
            console.error(error);
            if (dropped !== droppedBefore) return;
            discard();
            onError($LL.chat.voiceNote.recordingFailed());
        } finally {
            // eslint-disable-next-line require-atomic-updates
            finishing = undefined;
        }
    }

    /**
     * Takes the note out of here, recorded so far or held for review, and leaves the recorder empty: the people it was
     * for walked off, and it is kept with their chat. Undefined when there is nothing to keep.
     */
    export function takeNote(): Promise<UnsentVoiceNote | undefined> {
        clearInterval(timer);
        const stopped = recording;
        recording = undefined;
        const held = note ? { file: note.file, details: note.details } : undefined;
        const taken = stopped ? stopped.stop() : finishing ?? Promise.resolve(held);
        discard();
        return taken.catch((error: unknown) => {
            console.error(error);
            return undefined;
        });
    }

    /** Whether a note kept from before can go back in: nothing is being recorded, held or asked for. */
    export function canLoad(): boolean {
        return state === "idle" && !starting;
    }

    /** Puts a note kept from before back in, ready to listen to and send. */
    export function load(kept: UnsentVoiceNote) {
        if (!canLoad()) return;
        note = {
            ...kept,
            url: URL.createObjectURL(kept.file),
            shape: resampleWaveform(kept.details.waveform, VOICE_NOTE_BARS),
        };
        seconds = kept.details.duration;
        state = "review";
    }

    /** Drops the recording or the note held for review, and lets the microphone go. */
    export function discard() {
        dropped++;
        releasedWhileStarting = undefined;
        if (holding || pressed) endHold();
        clearInterval(timer);
        recording?.cancel();
        recording = undefined;
        player?.pause();
        if (note) URL.revokeObjectURL(note.url);
        note = undefined;
        playing = false;
        current = 0;
        seconds = 0;
        state = "idle";
    }

    async function send() {
        if (sending) return;
        // Send while recording stops it first: what was said so far goes.
        if (state === "recording") await stop();
        // A second press while the stop was finishing waits for the same stop: only the first one sends.
        if (!note || sending) return;
        sending = true;
        player?.pause();
        let sent = false;
        try {
            sent = await onSend(note.file, note.details);
        } catch (error) {
            console.error(error);
        } finally {
            // eslint-disable-next-line require-atomic-updates
            sending = false;
        }
        if (sent) discard();
    }

    function togglePlay() {
        if (!player) return;
        if (playing) player.pause();
        else player.play().catch((error) => console.warn(error));
    }

    onDestroy(() => {
        // Leaving the chat lets the microphone go.
        destroyed = true;
        clearTimeout(hintTimer);
        endHold();
        discard();
    });
</script>

{#if holding}
    <!-- A finger holds the mic: the timer and meter, and how to cancel. The mic itself stays under the finger, below. -->
    <div class="voice-live voice-hold" data-testid="voiceHolding">
        <!-- The dot, timer and meter show only once the microphone is really recording (not while a permission prompt is open). -->
        {#if cancelArmed}
            <span class="voice-hold-trash"><IconTrash font-size={18} /></span>
        {:else if state === "recording"}
            <span class="voice-rec-dot" aria-hidden="true" />
        {/if}
        {#if state === "recording"}
            <span class="voice-clock" class:voice-ending={left <= VOICE_NOTE_WARNING_SECONDS}>
                {formatDuration(seconds)}{#if left <= VOICE_NOTE_WARNING_SECONDS}<span class="voice-left"
                        >&nbsp;· {$LL.chat.voiceNote.secondsLeft({ seconds: left })}</span
                    >{/if}
            </span>
        {/if}
        {#if cancelArmed}
            <span class="voice-slide voice-slide-armed">{$LL.chat.voiceNote.releaseToCancel()}</span>
        {:else}
            {#if state === "recording"}
                <WaveBars
                    levels={live}
                    height={26}
                    gap={2}
                    barWidth={3}
                    classList="flex-1 min-w-0 overflow-hidden justify-end"
                />
            {:else}
                <span class="flex-1 min-w-0" />
            {/if}
            <span
                class="voice-slide"
                style="transform: translateX({move.offsetX * 0.6 * side}px); opacity: {1 - move.cancel}"
            >
                {#if rtl}<IconChevronRight font-size={16} />{:else}<IconChevronLeft
                        font-size={16}
                    />{/if}{$LL.chat.voiceNote.slideToCancel()}
            </span>
        {/if}
    </div>
    <!-- Above the mic: slide up to lock the recording open. -->
    <div class="voice-lock" class:voice-lock-near={move.lock >= 0.6} data-testid="voiceLockHint" aria-hidden="true">
        {#if move.lock >= 0.6}<IconLock font-size={18} />{:else}<IconLockOpen font-size={18} />{/if}
        <span class="voice-lock-arrow"><IconChevronUp font-size={16} /></span>
    </div>
{:else if quickSend}
    <div class="voice-live" data-testid="voiceSending">
        <span class="voice-clock voice-sending">{$LL.chat.voiceNote.sending()}</span>
    </div>
{:else if state !== "idle"}
    <button
        type="button"
        class="voice-button text-white"
        data-testid="voiceDeleteButton"
        aria-label={$LL.chat.voiceNote.delete()}
        disabled={sending}
        on:click={discard}
    >
        <IconTrash font-size={20} />
    </button>
    {#if state === "recording"}
        <div class="voice-live" data-testid="voiceRecording">
            <span class="voice-rec-dot" aria-hidden="true" />
            <span class="voice-clock" class:voice-ending={left <= VOICE_NOTE_WARNING_SECONDS}>
                {formatDuration(seconds)}{#if left <= VOICE_NOTE_WARNING_SECONDS}<span class="voice-left"
                        >&nbsp;· {$LL.chat.voiceNote.secondsLeft({ seconds: left })}</span
                    >{/if}
            </span>
            <WaveBars
                levels={live}
                height={26}
                gap={2}
                barWidth={3}
                classList="flex-1 min-w-0 overflow-hidden justify-end"
            />
        </div>
        <button
            type="button"
            class="voice-button voice-stop"
            data-testid="voiceStopButton"
            aria-label={$LL.chat.voiceNote.stopAndListen()}
            on:click={() => stop()}
        >
            <span class="voice-stop-square" aria-hidden="true" />
        </button>
    {:else if note}
        <div class="voice-live" data-testid="voiceReview">
            <button
                type="button"
                class="voice-review-play"
                aria-label={playing ? $LL.chat.voiceNote.pause() : $LL.chat.voiceNote.listen()}
                on:click={togglePlay}
            >
                {#if playing}<IconPauseFilled font-size="16" />{:else}<IconPlayFilled font-size="16" />{/if}
            </button>
            <div class="voice-review-bars" aria-hidden="true">
                {#each note.shape as level, index (index)}
                    <span
                        class:played={index / note.shape.length < progress}
                        style="height: {Math.max(4, Math.round(level * 24))}px"
                    />
                {/each}
            </div>
            <span class="voice-clock">
                {formatDuration(playing || current > 0 ? current : note.details.duration)}
            </span>
            <audio
                src={note.url}
                bind:this={player}
                use:singlePlayback
                bind:currentTime={current}
                on:play={() => (playing = true)}
                on:pause={() => (playing = false)}
                on:ended={() => {
                    playing = false;
                    current = 0;
                }}
            />
        </div>
    {/if}
{/if}
{#if (state === "idle" && canRecord && format) || holding}
    <!-- The same button from the touch down to the release: it must not be replaced while a finger holds it. -->
    <button
        type="button"
        class="voice-record text-white"
        class:voice-held={holding}
        class:voice-held-cancel={holding && cancelArmed}
        style={holding ? `translate: ${move.offsetX * side}px ${move.offsetY}px;` : undefined}
        data-testid="voiceRecordButton"
        aria-label={$LL.chat.voiceNote.record()}
        title={$LL.chat.voiceNote.record()}
        on:pointerdown={onPressStart}
        on:pointermove={onPressMove}
        on:pointerup={onPressEnd}
        on:pointercancel={onPressEnd}
        on:contextmenu|preventDefault
        on:click={onClick}
    >
        {#if holding && cancelArmed}<IconTrash font-size={20} />{:else}<IconMicrophoneOn font-size={20} />{/if}
    </button>
{:else if state !== "idle"}
    <button
        type="button"
        class="voice-button voice-send text-white disabled:opacity-30"
        data-testid="voiceSendButton"
        aria-label={$LL.chat.voiceNote.send()}
        disabled={sending || starting}
        on:click={() => send()}
    >
        <IconSend />
    </button>
{/if}
{#if hint}
    <div class="voice-hint" class:voice-hint-tap={hintTap} role="status" data-testid="voiceHint">
        <span>{hint}</span>
        {#if hintTap}
            <button type="button" class="voice-hint-action" data-testid="voiceHintRecord" on:click={recordFromHint}>
                {$LL.chat.voiceNote.tapToRecord()}
            </button>
        {/if}
    </div>
{/if}

<style>
    .voice-record,
    .voice-button {
        width: 40px;
        height: 40px;
        padding: 0;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        flex: none;
    }
    /* The recorder's own buttons (delete, stop, send) are 44px, the least a thumb should be asked to hit. */
    .voice-button {
        width: 44px;
        height: 44px;
    }
    /* Not on a touch screen: there a tap leaves the hover behind, a grey disc that stays until the next touch. */
    @media (hover: hover) {
        .voice-record:hover {
            background: rgba(255, 255, 255, 0.1);
        }
    }
    /* A finger decides here: no text selection, no touch menu, no scrolling started from the mic. */
    .voice-record {
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        -webkit-tap-highlight-color: transparent;
        position: relative;
    }
    /* A 48px target around the 40px button, for a thumb. */
    .voice-record::before {
        content: "";
        position: absolute;
        inset: -4px;
    }
    /* Held: the mic grows under the finger, in the brand gradient, and follows it. */
    .voice-held {
        scale: 1.5;
        z-index: 3;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 0 0 8px rgba(134, 41, 252, 0.22);
        transition: scale 0.14s ease-out, background 0.14s;
    }
    .voice-held-cancel {
        background: #e96d51;
        box-shadow: 0 0 0 8px rgba(233, 109, 81, 0.25);
    }
    .voice-hold {
        padding-inline-end: 4px;
    }
    .voice-sending {
        font-weight: 400;
        color: rgba(255, 255, 255, 0.7);
    }
    .voice-slide {
        flex: none;
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.7);
        white-space: nowrap;
        padding-inline-end: 36px;
    }
    .voice-slide-armed {
        flex: 1;
        min-width: 0;
        padding-inline-end: 0;
        color: #e96d51;
        font-weight: 600;
    }
    .voice-hold-trash {
        flex: none;
        width: 18px;
        margin-inline-start: -4px;
        display: grid;
        place-items: center;
        color: #e96d51;
    }
    /* Above the mic: the padlock a slide up closes. */
    .voice-lock {
        position: absolute;
        inset-inline-end: 6px;
        bottom: calc(100% + 18px);
        width: 40px;
        height: 84px;
        border-radius: 9999px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-around;
        padding: 10px 0;
        box-sizing: border-box;
        color: #fff;
        background: rgba(20, 24, 54, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.16);
        z-index: 2;
        pointer-events: none;
    }
    .voice-lock-near {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .voice-lock-arrow {
        display: grid;
        animation: voice-lift 1.1s ease-in-out infinite;
    }
    @keyframes voice-lift {
        50% {
            transform: translateY(-4px);
            opacity: 0.6;
        }
    }
    .voice-hint {
        position: absolute;
        inset-inline-end: 6px;
        bottom: calc(100% + 10px);
        max-width: calc(100% - 12px);
        padding: 8px 14px;
        border-radius: 14px;
        font-size: 13px;
        color: #fff;
        background: rgba(20, 24, 54, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.16);
        pointer-events: none;
        z-index: 2;
    }
    .voice-hint-tap {
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
    }
    /* A 44px target: the way in for a finger that cannot hold. */
    .voice-hint-action {
        min-height: 44px;
        min-width: 44px;
        padding: 0 4px;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        text-decoration: underline;
        text-underline-offset: 3px;
        background: none;
        border: 0;
        cursor: pointer;
    }
    /* Send is the one filled button: the brand gradient, as in the message box. */
    .voice-send {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .voice-stop {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        box-sizing: border-box;
        margin-right: 4px;
    }
    .voice-stop-square {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        background: #fff;
    }
    .voice-live {
        flex: 1;
        min-width: 0;
        height: 52px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 6px;
    }
    .voice-rec-dot {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 9999px;
        background: #e96d51;
        box-shadow: 0 0 0 4px rgba(233, 109, 81, 0.25);
        animation: voice-pulse 1.2s ease-in-out infinite;
    }
    @keyframes voice-pulse {
        50% {
            opacity: 0.7;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .voice-rec-dot,
        .voice-lock-arrow {
            animation: none;
        }
        .voice-held {
            transition: none;
        }
    }
    .voice-clock {
        flex: none;
        font-size: 15px;
        font-weight: 600;
        color: #fff;
        font-variant-numeric: tabular-nums;
    }
    /* The last seconds: amber, with how many are left. */
    .voice-ending {
        color: #fbbf24;
    }
    .voice-left {
        font-weight: 400;
    }
    .voice-review-play {
        flex: none;
        width: 36px;
        height: 36px;
        padding: 0;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        color: #fff;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-sizing: border-box;
        position: relative;
    }
    /* A 44px target around the 36px button. */
    .voice-review-play::before {
        content: "";
        position: absolute;
        inset: -4px;
    }
    .voice-review-bars {
        flex: 1;
        min-width: 0;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        overflow: hidden;
    }
    .voice-review-bars span {
        flex: none;
        width: 3px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.35);
    }
    .voice-review-bars span.played {
        background: #fff;
    }
</style>
