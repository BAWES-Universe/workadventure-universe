/**
 * Records the microphone into a WAV file (16 kHz, mono, 16-bit): the one audio format every browser plays, so a
 * voice note recorded on a laptop plays on a phone and the other way round. Also keeps a level per chunk for the
 * meter while recording, and draws the shape of a recording or a file for the review step.
 */

export const VOICE_NOTE_SAMPLE_RATE = 16000;
export const WAVE_BARS = 40;

export interface VoiceRecorder {
    /** The level (0 to 1) of the last chunk, read by the meter. */
    readonly level: () => number;
    /** Stops recording and returns the WAV and the audio as one channel of samples (for the shape). */
    stop: () => Promise<{ blob: Blob; samples: Float32Array; sampleRate: number }>;
}

export async function startVoiceRecorder(): Promise<VoiceRecorder> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    let context: AudioContext | undefined;
    try {
        context = new AudioContext();
        return await wire(stream, context);
    } catch (e) {
        // The microphone is open by now: let it go, or the browser keeps its light on.
        stream.getTracks().forEach((track) => track.stop());
        await context?.close().catch(() => {});
        throw e;
    }
}

async function wire(stream: MediaStream, context: AudioContext): Promise<VoiceRecorder> {
    const source = context.createMediaStreamSource(stream);
    // A ScriptProcessor runs everywhere, and keeps every sample; a silent gain feeds it to the output it needs.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silence = context.createGain();
    silence.gain.value = 0;
    const chunks: Float32Array[] = [];
    let level = 0;

    processor.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(data));
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        // Speech sits around 0.05 to 0.3 RMS: scale so a normal voice fills the meter without peaking.
        level = Math.min(1, Math.sqrt(sum / data.length) * 4);
    };
    source.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);
    if (context.state === "suspended") await context.resume();

    return {
        level: () => level,
        stop: async () => {
            processor.disconnect();
            source.disconnect();
            silence.disconnect();
            stream.getTracks().forEach((track) => track.stop());
            const samples = concat(chunks);
            const resampled = resample(samples, context.sampleRate, VOICE_NOTE_SAMPLE_RATE);
            await context.close();
            return {
                blob: encodeWav(resampled, VOICE_NOTE_SAMPLE_RATE),
                samples: resampled,
                sampleRate: VOICE_NOTE_SAMPLE_RATE,
            };
        },
    };
}

function concat(chunks: Float32Array[]): Float32Array {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const out = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function resample(samples: Float32Array, from: number, to: number): Float32Array {
    if (from === to) return samples;
    const ratio = from / to;
    const length = Math.floor(samples.length / ratio);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        // Average the source samples each output sample covers: cheaper than a filter, and no aliasing hiss.
        const start = Math.floor(i * ratio);
        const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = start; j < end; j++) sum += samples[j];
        out[i] = end > start ? sum / (end - start) : 0;
    }
    return out;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
}

/** The shape of a recording: one bar per slice, its peak, scaled so the loudest slice fills the meter. */
export function waveShape(samples: Float32Array, bars = WAVE_BARS): number[] {
    if (samples.length === 0) return new Array<number>(bars).fill(0.08);
    const slice = Math.max(1, Math.floor(samples.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
        let peak = 0;
        const start = i * slice;
        const end = Math.min(samples.length, start + slice);
        for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]));
        peaks.push(peak);
    }
    const max = Math.max(...peaks, 0.01);
    return peaks.map((peak) => Math.max(0.08, peak / max));
}

/** Decodes an audio file for its shape and length. Rejects when the browser cannot read it. */
export async function describeAudioFile(file: Blob): Promise<{ levels: number[]; duration: number }> {
    const context = new AudioContext();
    try {
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        return { levels: waveShape(decoded.getChannelData(0)), duration: decoded.duration };
    } finally {
        await context.close();
    }
}

export function formatDuration(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    const rest = whole % 60;
    return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
