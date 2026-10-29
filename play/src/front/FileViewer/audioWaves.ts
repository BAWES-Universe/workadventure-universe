/** How loud the low, middle and high sounds of the music are right now, each from 0 to 1. */
export interface Bands {
    bass: number;
    mids: number;
    highs: number;
}

/** A song that is paused, or one the page can't listen to: the ribbons lie calm. */
export const QUIET_BANDS: Bands = { bass: 0.06, mids: 0.05, highs: 0.04 };

/** The average level, 0 to 1, of the frequencies from `from` to `to` Hz in an analyser's reading. */
export function bandLevel(bins: Uint8Array, sampleRate: number, from: number, to: number): number {
    if (bins.length === 0) return 0;
    const nyquist = sampleRate / 2;
    const start = Math.min(bins.length - 1, Math.floor((from / nyquist) * bins.length));
    const end = Math.min(bins.length, Math.max(start + 1, Math.ceil((to / nyquist) * bins.length)));
    let sum = 0;
    for (let i = start; i < end; i++) sum += bins[i];
    return sum / (end - start) / 255;
}

/** The music's bands from an analyser's reading. The quieter high sounds are lifted, so every ribbon moves. */
export function bandsOf(bins: Uint8Array, sampleRate: number): Bands {
    return {
        bass: Math.pow(bandLevel(bins, sampleRate, 35, 160), 1.6),
        mids: Math.min(1, bandLevel(bins, sampleRate, 250, 2000) * 1.4),
        highs: Math.min(1, bandLevel(bins, sampleRate, 3000, 9000) * 3),
    };
}

/** The bands shown move toward the music's: up at once on a beat, down slowly after it. */
export function easeBands(shown: Bands, target: Bands): Bands {
    return {
        bass: shown.bass + (target.bass - shown.bass) * (target.bass > shown.bass ? 0.5 : 0.12),
        mids: shown.mids + (target.mids - shown.mids) * 0.2,
        highs: shown.highs + (target.highs - shown.highs) * (target.highs > shown.highs ? 0.6 : 0.15),
    };
}

/** Whether the bands shown have come to rest at `target`, so the stage can stop drawing. */
export function bandsSettled(shown: Bands, target: Bands): boolean {
    return (
        Math.abs(shown.bass - target.bass) < 0.002 &&
        Math.abs(shown.mids - target.mids) < 0.002 &&
        Math.abs(shown.highs - target.highs) < 0.002
    );
}

interface Ribbon {
    amplitude: number;
    /** How many waves fit across the stage. */
    waves: number;
    speed: number;
    color: string;
    width: number;
}

/** The ribbons: violet with the bass, blue with the middle, lavender with the high sounds, and a thin gold one. */
export function ribbonsOf(bands: Bands): Ribbon[] {
    return [
        { amplitude: 0.1 + bands.bass * 0.55, waves: 1.3, speed: 0.9, color: "134, 41, 252", width: 5 },
        { amplitude: 0.08 + bands.mids * 0.45, waves: 2.1, speed: -1.3, color: "65, 86, 246", width: 4 },
        { amplitude: 0.06 + bands.highs * 0.4, waves: 3.4, speed: 1.9, color: "196, 181, 253", width: 3 },
        { amplitude: 0.05 + (bands.bass + bands.mids) * 0.2, waves: 0.8, speed: -0.6, color: "251, 191, 36", width: 2 },
    ];
}

/** Draws the ribbons of light across a stage `width` by `height`, each with a soft glow, at `time` seconds. */
export function drawWaves(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    bands: Bands,
    time: number
): void {
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    const middle = height / 2;
    for (const ribbon of ribbonsOf(bands)) {
        for (const pass of [
            { blur: 18, alpha: 0.35, extra: 8 },
            { blur: 0, alpha: 0.95, extra: 0 },
        ]) {
            context.shadowBlur = pass.blur;
            context.shadowColor = `rgb(${ribbon.color})`;
            context.strokeStyle = `rgba(${ribbon.color}, ${pass.alpha})`;
            context.lineWidth = ribbon.width + pass.extra;
            context.beginPath();
            for (let x = 0; x <= width; x += 4) {
                // The ribbons meet at both ends, and breathe a little along their length.
                const edge = Math.sin((x / width) * Math.PI);
                const breath = 0.75 + 0.25 * Math.sin(time * 1.7 + x / 90);
                const wave = Math.sin((x / width) * Math.PI * 2 * ribbon.waves + time * ribbon.speed * 2);
                const y = middle + wave * ribbon.amplitude * height * 0.5 * edge * breath;
                if (x === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.stroke();
        }
    }
    context.shadowBlur = 0;
    context.globalCompositeOperation = "source-over";
}

let sharedContext: AudioContext | undefined;

/**
 * The one AudioContext the window's players listen to the music with. It is made on the first play, inside the tap, so
 * that phones let it run, and kept for the next song: one picked from the list then plays with its stage at once.
 */
export function stageAudioContext(): AudioContext | undefined {
    if (!sharedContext) {
        try {
            sharedContext = new AudioContext();
        } catch (error) {
            console.warn("No AudioContext for the music stage", error);
            return undefined;
        }
    }
    return sharedContext;
}
