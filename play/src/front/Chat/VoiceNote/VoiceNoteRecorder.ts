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

export interface VoiceNoteRecording {
    /** The level (0 to 1) of the latest slice, read by the meter. */
    readonly level: () => number;
    /** Stops recording and returns the note as a file (its length and shape are kept with it). */
    stop: () => Promise<{ file: File; details: VoiceNoteDetails }>;
    /** Stops recording and throws the audio away. */
    cancel: () => void;
}

/**
 * Starts recording the microphone. Rejects when the microphone is blocked or missing: the caller says how to allow it.
 * The level of each slice is read from the live stream, so the shape of the note is known without decoding the file.
 */
export async function startVoiceNoteRecording(format: RecordingFormat): Promise<VoiceNoteRecording> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    let context: AudioContext | undefined;
    try {
        context = new AudioContext();
        return await wire(stream, context, format);
    } catch (e) {
        // The microphone is open by now: let it go, or the browser keeps its light on.
        stream.getTracks().forEach((track) => track.stop());
        await context?.close().catch(() => {});
        throw e;
    }
}

async function wire(stream: MediaStream, context: AudioContext, format: RecordingFormat): Promise<VoiceNoteRecording> {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    if (context.state === "suspended") await context.resume();
    const samples = new Float32Array(analyser.fftSize);

    const recorder = new MediaRecorder(stream, {
        mimeType: format.recorderType,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
    };

    const levels: number[] = [];
    let level = 0;
    const meter = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        // Speech sits around 0.05 to 0.3 RMS: scale so a normal voice fills the meter without peaking.
        level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        levels.push(level);
    }, LEVEL_INTERVAL_MS);

    const startedAt = performance.now();
    let finished = false;
    const release = async () => {
        clearInterval(meter);
        stream.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => {});
    };

    // A slice each second, so a crash or a closed tab does not lose the whole note, and `stop` has little left to wait for.
    recorder.start(1000);

    return {
        level: () => level,
        stop: async () => {
            if (finished) throw new Error("The recording is already finished");
            finished = true;
            const stopped = new Promise<void>((resolve) => {
                recorder.onstop = () => resolve();
            });
            if (recorder.state !== "inactive") recorder.stop();
            await stopped;
            await release();
            const duration = Math.min(VOICE_NOTE_MAX_SECONDS, (performance.now() - startedAt) / 1000);
            const file = new File(chunks, voiceNoteFileName(format), { type: format.fileType });
            const details = { duration, waveform: waveformOf(levels, levels.length > 0 ? levels.length : 1) };
            voiceNoteDetails.set(file, details);
            return { file, details };
        },
        cancel: () => {
            if (finished) return;
            finished = true;
            recorder.onstop = null;
            if (recorder.state !== "inactive") recorder.stop();
            release().catch(() => {});
        },
    };
}
