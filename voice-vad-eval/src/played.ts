// The audio of a clip as the real-provider run played it (soniox-record.ts), shared with the replay of that run.
import { LEAD, type Item } from './fixtures.ts';

const RATE = 16000;
/** Noise clips are played for their first 10 s. */
export const NOISE_CLIP_S = 10;
/** Speech over noise gets 0 to 2 s more of the same noise before the person starts (the fixtures all start them at 1.0 s). */
export const MAX_LEAD_EXTRA_MS = 2000;

export function hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

/** The audio as played: noise trimmed to 10 s; speech over noise given a varied extra lead-in of the same noise. */
export function audioOf(item: Item): { pcm: Int16Array; onsetMs?: number; offsetMs?: number; leadExtraMs: number } {
    const built = item.build();
    let pcm = built.pcm;
    if (item.kind === 'noise') pcm = pcm.subarray(0, NOISE_CLIP_S * RATE);
    let leadExtraMs = 0;
    if (item.kind === 'speech' && (item.condition === 'N10' || item.condition === 'N5')) {
        leadExtraMs = Math.round((((hash('lead' + item.id) % 1000) / 1000) * MAX_LEAD_EXTRA_MS) / 20) * 20;
        const extra = (leadExtraMs * RATE) / 1000;
        const lead = Math.round(LEAD * RATE * 0.9);
        const longer = new Int16Array(extra + pcm.length);
        for (let i = 0; i < extra; i++) longer[i] = pcm[i % lead];
        longer.set(pcm, extra);
        pcm = longer;
    }
    const shift = (s?: number) => (s === undefined ? undefined : Math.round(s * 1000) + leadExtraMs);
    return { pcm, onsetMs: shift(built.onset), offsetMs: shift(built.offset), leadExtraMs };
}
