// How long a voice bot takes to answer (#1865): the timing store and the speaker's first-sound timing. A spoken turn timed end to
// end through the real bridge is in connectors.test.ts. Times and provider names only.
import { describe, expect, it } from 'vitest';
import { Latency, LATENCY_WINDOW_MS } from '../src/latency.ts';
import { TTS_FRAME_SAMPLES } from '../src/audioFormat.ts';
import { Speaker } from '../src/speaker.ts';
import { Counters } from '../src/counters.ts';
import type { OutputTarget } from '../src/transport.ts';
import { sleep, waitFor } from './harness.ts';

const tone = (ms: number): Int16Array => Int16Array.from({ length: (ms / 20) * TTS_FRAME_SAMPLES }, (_, i) => Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / 24000)));

describe('the timing store', () => {
    it('gives the median and the 95th percentile per stage and provider, and counts the turns', () => {
        const latency = new Latency();
        for (let ms = 1; ms <= 100; ms++) latency.record('hear', 'soniox', ms * 10, 1000);
        latency.record('hear', 'deepgram', 400, 1000);
        latency.record('speak', 'elevenlabs', 250, 1000);
        expect(latency.snapshot(1000)).toEqual({
            hear: { soniox: { samples: 100, p50: 500, p95: 950 }, deepgram: { samples: 1, p50: 400, p95: 400 } },
            speak: { elevenlabs: { samples: 1, p50: 250, p95: 250 } },
        });
    });

    it('keeps the last ten minutes only, at most 200 turns each, and lets go of what is older', () => {
        const latency = new Latency();
        latency.record('hear', 'soniox', 900, 0);
        latency.record('hear', 'soniox', 100, LATENCY_WINDOW_MS);
        expect(latency.snapshot(LATENCY_WINDOW_MS + 1).hear?.soniox).toEqual({ samples: 1, p50: 100, p95: 100 });
        expect(latency.snapshot(2 * LATENCY_WINDOW_MS + 2)).toEqual({});
        for (let i = 0; i < 300; i++) latency.record('play', 'x', i, 5);
        expect(latency.snapshot(5).play?.x.samples).toBe(200);
    });

    it('keeps nothing that is not a sensible time, and does not grow without end', () => {
        const latency = new Latency();
        for (const bad of [NaN, Infinity, -1, LATENCY_WINDOW_MS + 1]) latency.record('hear', 'soniox', bad);
        expect(latency.snapshot()).toEqual({});
        for (let i = 0; i < 200; i++) latency.record('hear', `provider-${i}`, 1);
        expect(Object.keys(latency.snapshot().hear ?? {}).length).toBeLessThanOrEqual(64);
    });
});

describe('the speaker times the first sound', () => {
    it('says how long the voice took for its first audio and how long it then took to send it, once per reply', async () => {
        const timings: { segmentId: string; speakMs: number; playMs: number; sentAt: number }[] = [];
        const frames: unknown[] = [];
        const target: OutputTarget = { participantId: 'p', epoch: 1, plays: () => true, sendFrame: (f) => frames.push(f), clear: () => undefined };
        const speaker = new Speaker({
            counters: new Counters(),
            voice: {
                async *speak() {
                    await sleep(120);
                    yield tone(200);
                    yield tone(200);
                },
            },
            maxReplyMs: 60000,
            speechTimeoutMs: 5000,
            targets: () => [target],
            active: () => true,
            progress: () => undefined,
            firstFrame: (timing) => timings.push(timing),
        });
        speaker.enqueue('s1', 'hello');
        await waitFor('the reply', () => frames.length >= 20, 3000);
        expect(timings).toHaveLength(1);
        expect(timings[0].segmentId).toBe('s1');
        expect(timings[0].speakMs).toBeGreaterThanOrEqual(100);
        expect(timings[0].speakMs).toBeLessThan(600);
        expect(timings[0].playMs).toBeLessThan(100);
        await speaker.shutdown();
    });

    it('says nothing for a reply nobody could hear, or that never made any audio', async () => {
        const timings: unknown[] = [];
        const silent = new Speaker({
            counters: new Counters(),
            voice: {
                async *speak() {
                    yield tone(100);
                },
            },
            maxReplyMs: 60000,
            speechTimeoutMs: 5000,
            targets: () => [],
            active: () => true,
            progress: () => undefined,
            firstFrame: (timing) => timings.push(timing),
        });
        silent.enqueue('s1', 'hello');
        await sleep(300);
        await silent.shutdown();
        expect(timings).toEqual([]);
    });
});
