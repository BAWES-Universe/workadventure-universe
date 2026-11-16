// How a row of speech probabilities (one per 32 ms window) becomes "a person is speaking over the bot".
// Evidence must be recent and sustained: windows at or above `on` add up; a short dip is forgiven (`gapMs`); a longer
// one throws the evidence away, so separate noises never add up the way today's counter does. One trigger per stretch;
// it re-arms after `rearmMs` without speech, the same quiet the baseline's provider waits for.
import { WINDOW_MS } from './silero.ts';

export interface Rule {
    name: string;
    on: number;
    minMs: number;
    gapMs: number;
}

export function ruleName(on: number, minMs: number): string {
    return `silero p>=${on.toFixed(2)} for ${minMs} ms`;
}

export const RULES: Rule[] = [];
for (const on of [0.5, 0.6, 0.7, 0.8, 0.9]) for (const minMs of [32, 64, 96, 160, 256]) RULES.push({ name: ruleName(on, minMs), on, minMs, gapMs: 96 });

/** Seconds at which the rule fires. A window's verdict exists only once its last sample has arrived. */
export function applyRule(probs: ArrayLike<number>, rule: Rule, rearmMs: number): number[] {
    const triggers: number[] = [];
    let evidence = 0;
    let gap = 0;
    let armed = true;
    let quiet = 0;
    for (let i = 0; i < probs.length; i++) {
        const p = probs[i];
        if (p >= rule.on) {
            evidence += WINDOW_MS;
            gap = 0;
            quiet = 0;
            if (armed && evidence >= rule.minMs) {
                triggers.push(((i + 1) * WINDOW_MS) / 1000);
                armed = false;
            }
        } else {
            gap += WINDOW_MS;
            if (gap > rule.gapMs) evidence = 0;
            if (p < 0.35) quiet += WINDOW_MS;
            else quiet = 0;
            if (!armed && quiet >= rearmMs) armed = true;
        }
    }
    return triggers;
}
