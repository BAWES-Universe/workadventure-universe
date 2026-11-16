// The test set, built the same way every run (seeded). Nothing here is tuned to a detector. Labels are NOT human labels:
// a speech clip's start and end are ESTIMATED from its own energy before any noise is added (a hum or a click in a bad
// recording can set them), and noise clips are grouped by their source's class name (nobody listened to every file).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readWav16k } from './wav.ts';

export const RATE = 16000;

export type Kind = 'noise' | 'speech' | 'burst';
export interface Item {
    id: string;
    kind: Kind;
    /** noise: the source's class. speech: the set (en-command, ar-command, en-sentence). */
    set: string;
    /** noise: nonspeech | scene | speechlike. speech: the word, or "sentence". */
    label: string;
    /** noise: whole-clip RMS in dBFS. speech: the condition (S20, S30, S40, N10, N5). */
    condition: string;
    /** Half the items are only ever used to pick settings, the other half only to report. */
    split: 'tune' | 'report';
    /** The recording this clip was made from. Several clips (levels, conditions) share one source: they are not independent. */
    source: string;
    /** Commands only: the contributor, from the file name as each dataset documents it. Sentences carry none. */
    speaker?: string;
    build(): Built;
}
export interface Built {
    pcm: Int16Array;
    /** Speech only: where the person starts and stops, in seconds, ESTIMATED from energy (see speechBounds). */
    onset?: number;
    offset?: number;
    /** What the level really came out as (dBFS): whole-clip RMS for noise, active-speech RMS for speech. */
    level: number;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hash(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
}
const fromDb = (db: number): number => 32768 * 10 ** (db / 20);
export const toDb = (rms: number): number => 20 * Math.log10(Math.max(rms, 1e-9) / 32768);

function rmsOf(x: ArrayLike<number>, from = 0, to = x.length): number {
    let s = 0;
    for (let i = from; i < to; i++) s += x[i] * x[i];
    return Math.sqrt(s / Math.max(1, to - from));
}

/** Active-speech level and an energy-based estimate of onset/offset of a clip, from 10 ms frame energies. A heuristic. */
export function speechBounds(x: Int16Array): { activeRms: number; onset: number; offset: number } {
    const F = 160;
    const n = Math.floor(x.length / F);
    const e = new Float64Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
        e[i] = rmsOf(x, i * F, (i + 1) * F);
        if (e[i] > peak) peak = e[i];
    }
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
        if (e[i] >= peak * 10 ** (-30 / 20)) {
            sum += e[i] * e[i];
            count++;
        }
    }
    const activeRms = Math.sqrt(sum / Math.max(1, count));
    const bar = activeRms * 10 ** (-20 / 20);
    let first = -1;
    let last = -1;
    for (let i = 0; i + 1 < n; i++) {
        if (e[i] >= bar && e[i + 1] >= bar) {
            if (first < 0) first = i;
            last = i + 1;
        }
    }
    if (first < 0) {
        first = 0;
        last = n - 1;
    }
    return { activeRms, onset: (first * F) / RATE, offset: ((last + 1) * F) / RATE };
}

function scaled(x: ArrayLike<number>, gain: number): Float64Array {
    const out = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] * gain;
    return out;
}
function toInt16(x: Float64Array): Int16Array {
    const out = new Int16Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] > 32767 ? 32767 : x[i] < -32768 ? -32768 : Math.round(x[i]);
    return out;
}
function gaussian(rand: () => number): number {
    return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

const NONSPEECH = new Set(['AirConditioner', 'CopyMachine', 'Munching', 'ShuttingDoor', 'SqueakyChair', 'Typing', 'VacuumCleaner', 'WasherDryer', 'Washing', 'Car', 'Traffic', 'Field', 'water_tap', 'washing_machine', 'walking_machine', 'cooking', 'boiler', 'battery_charger']);
const SPEECHLIKE = new Set(['Babble', 'Neighbor', 'NeighborSpeaking', 'AirportAnnouncement', 'AirportAnnouncements', 'Cafe', 'CafeTeria', 'Restaurant']);
/** By the source's own class name; nobody listened to every file. Scenes may contain voices. */
export function noiseGroup(cls: string): 'nonspeech' | 'scene' | 'speechlike' {
    if (NONSPEECH.has(cls)) return 'nonspeech';
    if (SPEECHLIKE.has(cls)) return 'speechlike';
    return 'scene';
}

const speakerOf = (key: string): string => (key.split('/').pop() ?? '').split('_')[0];
const wavs = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.wav')).sort() : []);
const classOf = (file: string): string => file.replace(/\.wav$/, '').replace(/_\d+$/, '');

export const NOISE_LEVELS = [-45, -35, -25];
export const NOISE_SECONDS = 60;
export const SPEECH_CONDITIONS = ['S20', 'S30', 'S40', 'N10', 'N5'] as const;
export const LEAD = 1.0;
const TAIL = 1.0;

export function buildManifest(data: string): Item[] {
    const items: Item[] = [];
    const split = (key: string): 'tune' | 'report' => (hash('split:' + key) % 2 === 0 ? 'tune' : 'report');

    // 1. Noise only
    const noiseFiles: { path: string; cls: string; key: string }[] = [];
    for (const dir of ['ms-snsd/noise_test', 'ms-snsd/noise_train', 'asc/background_noise']) {
        for (const f of wavs(join(data, dir))) noiseFiles.push({ path: join(data, dir, f), cls: classOf(f), key: `${dir}/${f}` });
    }
    for (const nf of noiseFiles) {
        for (const level of NOISE_LEVELS) {
            items.push({
                id: `noise|${nf.key}|${level}`,
                kind: 'noise',
                set: nf.cls,
                label: noiseGroup(nf.cls),
                condition: String(level),
                split: split(nf.key),
                source: nf.key,
                build: () => {
                    const src = readWav16k(nf.path).subarray(0, NOISE_SECONDS * RATE);
                    let gain = fromDb(level) / Math.max(1, rmsOf(src));
                    let peak = 0;
                    for (const v of src) if (Math.abs(v) > peak) peak = Math.abs(v);
                    if (peak * gain > 32000) gain = 32000 / peak;
                    const pcm = toInt16(scaled(src, gain));
                    return { pcm, level: toDb(rmsOf(pcm)) };
                },
            });
        }
    }

    // 2. Speech: short commands (English, Arabic) and sentences (English)
    const speech: { path: string; set: string; label: string; key: string }[] = [];
    const pick = (dir: string, count: number, seed: string): string[] => {
        const all = wavs(dir);
        const rand = mulberry32(hash(seed));
        const chosen = all.map((f) => ({ f, r: rand() })).sort((a, b) => a.r - b.r).slice(0, count).map((x) => x.f);
        return chosen.sort();
    };
    for (const word of ['stop', 'no', 'yes', 'go']) {
        const dir = join(data, 'mini_speech_commands', word);
        for (const f of pick(dir, 150, 'en:' + word)) speech.push({ path: join(dir, f), set: 'en-command', label: word, key: `en/${word}/${f}` });
    }
    for (const word of ['stop', 'no', 'yes', 'cancel', 'close', 'ok']) {
        const dir = join(data, 'asc/dataset', word);
        for (const f of pick(dir, 100, 'ar:' + word)) speech.push({ path: join(dir, f), set: 'ar-command', label: word, key: `ar/${word}/${f}` });
    }
    {
        const dir = join(data, 'ms-snsd/clean_test');
        for (const f of pick(dir, 150, 'en:sentence')) speech.push({ path: join(dir, f), set: 'en-sentence', label: 'sentence', key: `sent/${f}` });
    }
    const mixNoise = noiseFiles.filter((n) => n.key.startsWith('ms-snsd/noise_test') && noiseGroup(n.cls) === 'nonspeech');
    for (const sp of speech) {
        for (const condition of SPEECH_CONDITIONS) {
            items.push({
                id: `speech|${sp.key}|${condition}`,
                kind: 'speech',
                set: sp.set,
                label: sp.label,
                condition,
                // Commands: a contributor is on one side of the split only, in every word and condition. Both datasets document
                // that the file name starts with the contributor's id (Speech Commands: "<hash>_nohash_<n>.wav"; Arabic Speech
                // Commands: first eight digits). Sentences: the source gives no speaker identity, so they are split by FILE only.
                split: split(sp.set === 'en-sentence' ? sp.key : `${sp.set}/${speakerOf(sp.key)}`),
                source: sp.key,
                speaker: sp.set === 'en-sentence' ? undefined : `${sp.set}/${speakerOf(sp.key)}`,
                build: () => {
                    const rand = mulberry32(hash(`${sp.key}|${condition}`));
                    let clip = readWav16k(sp.path);
                    if (sp.set === 'en-sentence') clip = clip.subarray(0, 4 * RATE);
                    const { activeRms, onset, offset } = speechBounds(clip);
                    const target = condition === 'S20' ? -20 : condition === 'S30' ? -30 : condition === 'S40' ? -40 : -26;
                    const total = Math.round((LEAD + TAIL) * RATE) + clip.length;
                    const mix = new Float64Array(total);
                    // A digital-silence floor so nothing is exactly zero
                    const floor = fromDb(-75);
                    for (let i = 0; i < total; i++) mix[i] = gaussian(rand) * floor;
                    if (condition === 'N10' || condition === 'N5') {
                        const snr = condition === 'N10' ? 10 : 5;
                        const nf = mixNoise[Math.floor(rand() * mixNoise.length)];
                        const noise = readWav16k(nf.path);
                        const start = Math.floor(rand() * Math.max(1, noise.length - total));
                        const seg = noise.subarray(start, start + total);
                        const g = fromDb(target - snr) / Math.max(1, rmsOf(seg));
                        for (let i = 0; i < seg.length; i++) mix[i] += seg[i] * g;
                    }
                    const gain = fromDb(target) / Math.max(1, activeRms);
                    const at = Math.round(LEAD * RATE);
                    for (let i = 0; i < clip.length; i++) mix[at + i] += clip[i] * gain;
                    return { pcm: toInt16(mix), onset: LEAD + onset, offset: LEAD + offset, level: target };
                },
            });
        }
    }

    // 3. Three 100 ms bursts with half-second gaps (a door, a cup put down three times): must not count as speech
    for (const level of [-30, -20]) {
        for (let k = 0; k < 20; k++) {
            items.push({
                id: `burst|${level}|${k}`,
                kind: 'burst',
                set: 'three-bursts',
                label: 'nonspeech',
                condition: String(level),
                split: k % 2 === 0 ? 'tune' : 'report',
                source: `synthetic/burst/${level}/${k}`,
                build: () => {
                    const rand = mulberry32(hash(`burst|${level}|${k}`));
                    const total = 4 * RATE;
                    const mix = new Float64Array(total);
                    const floor = fromDb(-75);
                    for (let i = 0; i < total; i++) mix[i] = gaussian(rand) * floor;
                    const g = fromDb(level);
                    for (let b = 0; b < 3; b++) {
                        const at = Math.round((1 + b * 0.6) * RATE);
                        for (let i = 0; i < 0.1 * RATE; i++) mix[at + i] += gaussian(rand) * g;
                    }
                    return { pcm: toInt16(mix), level };
                },
            });
        }
    }
    return items;
}
