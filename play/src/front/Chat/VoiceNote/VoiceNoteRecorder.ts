import { readAudioShape } from "./AudioShape";
import {
    VOICE_NOTE_MAX_SECONDS,
    voiceNoteDetails,
    voiceNoteFileName,
    waveformOf,
    type RecordingFormat,
    type VoiceNoteDetails,
} from "./VoiceNote";

/** How often the level is read: the meter's pace, and the slices the note's shape is made from. */
const LEVEL_INTERVAL_MS = 100;
/** Speech is mono, so 48 kbit/s is plenty: a two minute note is under 720 KB. */
const AUDIO_BITS_PER_SECOND = 48000;

/** A meter that never rose above this saw no sound at all. */
const SILENT_METER = 0.02;
/**
 * How long finishing a note waits for its shape to be read from the file. The reading waits behind other audio in the chat
 * being read, so it can take long: past this, the note goes on with the meter's shape and the person is never held up.
 */
export const FILE_SHAPE_WAIT_MS = 3000;

async function shapeOf(file: File): Promise<number[] | undefined> {
    let url: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        url = URL.createObjectURL(file);
        const late = new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), FILE_SHAPE_WAIT_MS);
        });
        return (await Promise.race([readAudioShape(url), late]))?.levels;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
        if (url) URL.revokeObjectURL(url);
    }
}

export interface VoiceNoteRecording {
    /** The level (0 to 1) of the latest slice, read by the meter. */
    readonly level: () => number;
    /** False while the browser keeps sound from running (an iPhone before a tap lets it): the meter then reads nothing. */
    readonly metering: () => boolean;
    /** Asks the browser again to let sound run: called from a finger lifting, which iOS counts as a tap. */
    readonly resume: () => void;
    /** Stops recording and returns the note as a file (its length and shape are kept with it). */
    stop: () => Promise<{ file: File; details: VoiceNoteDetails }>;
    /** Stops recording and throws the audio away. */
    cancel: () => void;
}

/**
 * Starts recording the microphone. Rejects when the microphone is blocked or missing: the caller says how to allow it.
 * The level of each slice is read from the live stream, so the shape of the note is known without decoding the file.
 */
export async function startVoiceNoteRecording(
    format: RecordingFormat,
    context: AudioContext = makeVoiceNoteContext()
): Promise<VoiceNoteRecording> {
    let stream: MediaStream | undefined;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return wire(stream, context, format);
    } catch (e) {
        // The microphone may be open by now: let it go, or the browser keeps its light on.
        stream?.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => {});
        throw e;
    }
}

/**
 * Made and started in the tap itself, before the wait for the microphone: an iPhone only lets sound run from a tap, and
 * a context made after that wait stays silent when nothing else is playing (a direct message, not a bubble). The meter
 * and the note's shape then read nothing. A press-and-hold makes it when the finger lands and hands it to the recording.
 * Not waited for: a context the browser will not start yet must not hold up the recording itself.
 */
export function makeVoiceNoteContext(): AudioContext {
    const context = new AudioContext();
    context.resume().catch(() => {});
    return context;
}

function wire(stream: MediaStream, context: AudioContext, format: RecordingFormat): VoiceNoteRecording {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    // Safari can also leave it "interrupted": anything but running is asked to run again, without waiting for it.
    if (context.state !== "running") context.resume().catch(() => {});
    const samples = new Float32Array(analyser.fftSize);

    const recorder = new MediaRecorder(stream, {
        mimeType: format.recorderType,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
    };

    // Listening from the start: a recorder that stops by itself (the microphone was unplugged) has already said so by
    // the time `stop` is asked, and would never say it again.
    const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => resolve();
    });

    const levels: number[] = [];
    let level = 0;
    // True once the meter was read while the browser kept sound from running: the levels may then be silence the
    // microphone never made.
    let contextWasIdle = false;
    let finished = false;

    // A slice each second, so a crash or a closed tab does not lose the whole note, and `stop` has little left to wait for.
    // Started before the meter: when it throws, there is no timer left running.
    recorder.start(1000);
    const startedAt = performance.now();
    const meter = setInterval(() => {
        if (context.state !== "running") contextWasIdle = true;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        // Speech sits around 0.05 to 0.3 RMS: scale so a normal voice fills the meter without peaking.
        level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        levels.push(level);
    }, LEVEL_INTERVAL_MS);
    const release = async () => {
        clearInterval(meter);
        stream.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => {});
    };

    return {
        level: () => level,
        metering: () => context.state === "running",
        resume: () => {
            if (context.state !== "running" && context.state !== "closed") context.resume().catch(() => {});
        },
        stop: async () => {
            if (finished) throw new Error("The recording is already finished");
            finished = true;
            if (recorder.state !== "inactive") recorder.stop();
            await stopped;
            await release();
            const duration = Math.min(VOICE_NOTE_MAX_SECONDS, (performance.now() - startedAt) / 1000);
            const file = new File(chunks, voiceNoteFileName(format), { type: format.fileType });
            let waveform = waveformOf(levels, levels.length > 0 ? levels.length : 1);
            // The meter read nothing because the browser kept sound from running (an iPhone before a tap): the shape
            // is read from the recorded file instead, as it is for a note that arrives without one.
            if (contextWasIdle && Math.max(0, ...levels) < SILENT_METER) {
                const heard = await shapeOf(file);
                if (heard) waveform = heard;
            }
            const details = { duration, waveform };
            voiceNoteDetails.set(file, details);
            return { file, details };
        },
        cancel: () => {
            if (finished) return;
            finished = true;
            if (recorder.state !== "inactive") recorder.stop();
            release().catch(() => {});
        },
    };
}
