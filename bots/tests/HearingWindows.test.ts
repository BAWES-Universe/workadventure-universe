/**
 * Live hearing on Universe's account is admitted in windows Orbit sets aside, renewed in the background (billing consensus v2, 6.3 point 2): never per
 * audio frame, nothing waits on Orbit, a refusal stops hearing at the end of the window in hand and says which of the five reasons it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HearingWindows, parseHearingWindow, type HearingOrbit, type HearingWindowAnswer } from '../voice/HearingWindows';
import type { SpeechStop } from '../voice/VoiceAllowance';

const who = { userId: 'u1', isGuest: false };

function setup(answers: Array<HearingWindowAnswer | 'unsupported' | null>) {
    const asked: Array<{ windowId: string; model?: string }> = [];
    const released: string[] = [];
    const refused: Array<{ key: string; stop: SpeechStop }> = [];
    let next = 0;
    const orbit: HearingOrbit = {
        async admitHearingWindow(_botId, input) {
            asked.push({ windowId: input.windowId, ...(input.model ? { model: input.model } : {}) });
            const answer = answers[Math.min(next++, answers.length - 1)];
            // A grant names the id it was asked with, as Orbit does
            return answer && answer !== 'unsupported' && answer.allowed ? { ...answer, windowId: input.windowId } : answer;
        },
        async releaseHearingWindow(_botId, input) {
            released.push(input.windowId);
            return true;
        },
    };
    const windows = new HearingWindows('bot1', orbit, (key, stop) => refused.push({ key, stop }));
    return { windows, asked, released, refused };
}

const grant = (admittedSeconds: number, renewAfterSeconds = admittedSeconds / 2): HearingWindowAnswer => ({ allowed: true, windowId: 'w', admittedSeconds, renewAfterSeconds });
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('HearingWindows', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('asks for the first window in the background, with the model, and counts hearing under it once admitted', async () => {
        const { windows, asked } = setup([grant(60)]);
        windows.start('room\np1', who, 'nova-3');
        // The call is not held: start returned before Orbit answered
        expect(windows.windowOf('room\np1')).toBeUndefined();
        await settle();
        expect(asked).toHaveLength(1);
        expect(asked[0].model).toBe('nova-3');
        expect(windows.windowOf('room\np1')).toBe(asked[0].windowId);
    });

    it('asks for the next window before the one in hand is used up, and takes it into use when that one ends', async () => {
        const { windows, asked, released } = setup([grant(60, 30), grant(60, 30)]);
        windows.start('room\np1', who);
        await settle();
        const first = asked[0].windowId;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(asked).toHaveLength(2);
        expect(windows.windowOf('room\np1')).toBe(first);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(windows.windowOf('room\np1')).toBe(asked[1].windowId);
        // What the first window did not use is given back
        expect(released).toEqual([first]);
    });

    it('never asks more than once for one person at a time and not at all when started twice', async () => {
        const { windows, asked } = setup([grant(600)]);
        windows.start('room\np1', who);
        windows.start('room\np1', who);
        await settle();
        expect(asked).toHaveLength(1);
    });

    it('stops hearing at the end of the window in hand when the next is refused, and says why', async () => {
        const { windows, asked, refused } = setup([grant(60, 30), { allowed: false, stoppedBy: 'person', resetsAt: '2026-12-01T00:00:00Z' }]);
        windows.start('room\np1', who);
        await settle();
        await vi.advanceTimersByTimeAsync(30_000);
        // Refused, but hearing goes on until the window they have is used up
        expect(asked).toHaveLength(2);
        expect(refused).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(refused).toEqual([{ key: 'room\np1', stop: { by: 'person', resetsAt: '2026-12-01T00:00:00Z' } }]);
        expect(windows.keys()).toEqual([]);
    });

    it('stops at once when the first window is refused, with each of the five reasons as it was given', async () => {
        for (const by of ['person', 'budget', 'provider', 'capacity', 'hold'] as const) {
            const { windows, refused } = setup([{ allowed: false, stoppedBy: by }]);
            windows.start('room\np1', who);
            await settle();
            expect(refused.map((r) => r.stop.by)).toEqual([by]);
        }
    });

    it('asks again for a hold or capacity before the window in hand is over, so waiting is enough', async () => {
        const { windows, asked, refused } = setup([grant(60, 10), { allowed: false, stoppedBy: 'hold', retryAfterSeconds: 5 }, grant(60, 30)]);
        windows.start('room\np1', who);
        await settle();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(asked).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(asked).toHaveLength(3);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(refused).toHaveLength(0);
        expect(windows.windowOf('room\np1')).toBe(asked[2].windowId);
    });

    it('carries on hearing when Orbit cannot be asked (not a refusal) and asks again later', async () => {
        const { windows, asked, refused } = setup([null, grant(60)]);
        windows.start('room\np1', who);
        await settle();
        expect(refused).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(asked).toHaveLength(2);
        expect(windows.windowOf('room\np1')).toBe(asked[1].windowId);
    });

    it('never asks again, and carries on as before, with an Orbit from before windows', async () => {
        const { windows, asked, refused } = setup(['unsupported']);
        windows.start('room\np1', who);
        await settle();
        expect(windows.active).toBe(false);
        windows.start('room\np2', who);
        await settle();
        expect(asked).toHaveLength(1);
        expect(refused).toHaveLength(0);
    });

    it('gives back what it held when the person stops, and when the bot goes away, safe to repeat', async () => {
        const { windows, asked, released } = setup([grant(600, 300)]);
        windows.start('room\np1', who);
        windows.start('room\np2', who);
        await settle();
        windows.stop('room\np1');
        windows.stop('room\np1');
        expect(released).toEqual([asked[0].windowId]);
        windows.shutdown();
        expect(released).toHaveLength(2);
        expect(windows.keys()).toEqual([]);
    });

    it('gives back a window that was admitted after the person had already stopped', async () => {
        let answer: ((value: HearingWindowAnswer) => void) | undefined;
        const released: string[] = [];
        const orbit: HearingOrbit = {
            admitHearingWindow: () => new Promise((resolve) => (answer = resolve)),
            releaseHearingWindow: async (_b, input) => {
                released.push(input.windowId);
                return true;
            },
        };
        const windows = new HearingWindows('bot1', orbit, () => undefined);
        windows.start('room\np1', who);
        windows.stop('room\np1');
        answer?.({ allowed: true, windowId: 'late', admittedSeconds: 60, renewAfterSeconds: 30 });
        await settle();
        expect(released).toEqual(['late']);
    });
});

describe('parseHearingWindow', () => {
    it('reads a grant, with a renewal never later than the window itself', () => {
        expect(parseHearingWindow({ allowed: true, windowId: 'w1', admittedSeconds: 60, renewAfterSeconds: 500, rateVersion: 3 }, 'mine')).toMatchObject({ allowed: true, windowId: 'w1', admittedSeconds: 60, renewAfterSeconds: 60, rateVersion: 3 });
        expect(parseHearingWindow({ allowed: true, admittedSeconds: 60 }, 'mine')).toMatchObject({ windowId: 'mine', renewAfterSeconds: 30 });
    });
    it('reads a refusal with one of the five reasons, and nothing else as a refusal', () => {
        expect(parseHearingWindow({ allowed: false, stoppedBy: 'budget' }, 'w')).toEqual({ allowed: false, stoppedBy: 'budget' });
        expect(parseHearingWindow({ allowed: false, stoppedBy: 'who knows' }, 'w')).toBeNull();
        expect(parseHearingWindow({ allowed: true, admittedSeconds: 0 }, 'w')).toBeNull();
        expect(parseHearingWindow(null, 'w')).toBeNull();
        expect(parseHearingWindow('x', 'w')).toBeNull();
    });
});
