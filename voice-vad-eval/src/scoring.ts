// How one speech clip is scored for one detector. None of this is a human label (see fixtures.ts).
//   clip start        where the person's recording was placed. Anything before it is only the added background.
//   estimated onset   where the recording's energy rises (speechBounds). A soft first sound ("s", "y") comes before it.
//   VALID             the detector fires between 200 ms before the estimated onset (never before the clip start) and
//                     600 ms after the estimated end
//   EARLY (ambiguous) it fires inside the recording but more than 200 ms before the estimated onset: a soft first
//                     sound, or the recording's own noise. Counted separately, never as a catch.
//   BACKGROUND        it fires before the clip start: on the background, not on the person
//   NONE              no VALID and no EARLY firing
export const TOLERANCE = 0.2;
export const AFTER = 0.6;

export type Outcome = 'valid' | 'early' | 'none';
export interface Scored {
    outcome: Outcome;
    background: boolean;
    /** Seconds from the onset to the VALID firing; negative when it fires on a soft first sound. Never clamped. */
    delay?: number;
}
export function scoreSpeech(firings: number[], clipStart: number, onset: number, offset: number): Scored {
    const from = Math.max(clipStart, onset - TOLERANCE);
    const valid = firings.find((t) => t >= from && t <= offset + AFTER);
    const early = firings.some((t) => t >= clipStart && t < from);
    return { outcome: valid !== undefined ? 'valid' : early ? 'early' : 'none', background: firings.some((t) => t < clipStart), delay: valid === undefined ? undefined : valid - onset };
}
export const percentile = (xs: number[], p: number): number => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
