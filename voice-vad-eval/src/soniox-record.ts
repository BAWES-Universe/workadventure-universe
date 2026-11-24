// Real-provider timing (round-2 review, step 3): plays chosen clips, in real time, through the worker's own Recognition
// and its own Soniox connector (voice-worker/src/soniox.ts, unchanged), and records what Soniox said and when: every
// partial, endpoint, final and failure, in milliseconds from the start of the clip. Nothing is decided here: the
// recording is replayed afterwards through the real control (yield-replay.ts, provider `recorded`).
//
// PAID: every stream is billed by Soniox. A hard cap on the audio sent (SONIOX_CAP_MIN, default 120 minutes) stops
// starting new clips once reached, and the total sent is written out. The key is read from SONIOX_API_KEY and goes only
// into the Authorization header of each stream (as in the worker); it is never written anywhere.
//
// Which clips (report half only; the tune half picked the quiet window):
//   - steady non-speech noise, the first 10 s: every source at -35 dBFS, and half the sources at -25 dBFS
//   - scenes and speech-like noise (babble), the first 10 s, every source at -35 dBFS
//   - three knocks: all 20 report trials
//   - soft commands (S40): 40 English, 40 Arabic
//   - commands and sentences over sustained noise (N10, N5), with a varied noise lead-in: 0 to 2 s more before the person
//     starts (the fixtures all start them at 1.0 s), so onset times vary
//   - sentences at S30: 20
//   - the known hard cases from the scripted replay: every clip with a false resume, and every clip never stopped
//
//   tsx src/soniox-record.ts <data dir> <scripted replay rows.jsonl> <out dir> [--only N]
// Writes <out>/soniox-record.jsonl (one row per clip) and <out>/soniox-record-cost.json.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, type Item } from './fixtures.ts';
import { audioOf, hash } from './played.ts';

import './proxy.ts';

const { Counters } = await import('../../voice-worker/src/counters.ts');
const { Recognition } = await import('../../voice-worker/src/recognition.ts');
const { SonioxRecognition, SONIOX_CURRENT_MODEL } = await import('../../voice-worker/src/soniox.ts');

const RATE = 16000;
const FRAME = 320;
const TAIL_MS = 3000;
const CONCURRENT = 6;
const CAP_MS = Number(process.env.SONIOX_CAP_MIN ?? 120) * 60_000;
const PRICE_PER_HOUR = 0.12;

export type RecordedEvent = [number, 'partial' | 'endpoint' | 'final' | 'failed', string?, number?];
export interface RecordedStream {
    openAt: number;
    finishAt?: number;
    events: RecordedEvent[];
    sentMs: number;
}
export interface RecordedClip {
    id: string;
    kind: string;
    set: string;
    label: string;
    condition: string;
    group: string;
    language: string;
    seconds: number;
    leadExtraMs: number;
    onsetMs?: number;
    offsetMs?: number;
    streams: RecordedStream[];
    sentMs: number;
}

const key = process.env.SONIOX_API_KEY;
if (!key) throw new Error('SONIOX_API_KEY is not set');
const [data, scriptedRows, out, flag, only] = process.argv.slice(2);
if (!data || !scriptedRows || !out) throw new Error('usage: soniox-record.ts <data dir> <scripted replay rows.jsonl> <out dir> [--only N]');
mkdirSync(out, { recursive: true });

// ---- The clips ----
const byHash = (seed: string) => (a: Item, b: Item) => hash(seed + a.id) - hash(seed + b.id);
const report = buildManifest(data).filter((i) => i.split === 'report');
const picked = new Map<string, { item: Item; group: string }>();
const take = (items: Item[], group: string) => {
    for (const item of items) if (!picked.has(item.id)) picked.set(item.id, { item, group });
};
const noise = report.filter((i) => i.kind === 'noise');
const nonspeech35 = noise.filter((i) => i.label === 'nonspeech' && i.condition === '-35');
take(nonspeech35, 'steady non-speech');
take(noise.filter((i) => i.label === 'nonspeech' && i.condition === '-25').sort(byHash('ns25')).slice(0, Math.ceil(nonspeech35.length / 2)), 'steady non-speech');
take(noise.filter((i) => i.label === 'scene' && i.condition === '-35'), 'scene');
take(noise.filter((i) => i.label === 'speechlike' && i.condition === '-35'), 'speech-like (babble)');
take(report.filter((i) => i.kind === 'burst'), 'three knocks');
const speech = report.filter((i) => i.kind === 'speech');
// The known hard cases first, so they are never left out by the cap
const hard = new Set<string>();
for (const line of readFileSync(scriptedRows, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { id: string; kind: string; provider: string; onsetMs?: number; result: Record<string, { stopAt?: number; events: [number, string][] }> };
    if (row.kind !== 'speech') continue;
    const hold = row.result.hold;
    const never = Object.values(row.result).every((o) => o.stopAt === undefined);
    const onset = row.onsetMs ?? 0;
    const change = hold.events.find(([t, e]) => (e === 'pause' || e === 'stop') && t >= 0);
    const falseResume = hold.events.some(([t, e]) => (e === 'continue' || e === 'resume') && t >= onset && change !== undefined);
    if (never || falseResume) hard.add(row.id);
}
const hardItems = speech.filter((i) => hard.has(i.id));
const queue: { item: Item; group: string }[] = hardItems.map((item) => ({ item, group: 'known hard case' }));
for (const h of hardItems) picked.set(h.id, { item: h, group: 'known hard case' });
take(speech.filter((i) => i.set === 'en-command' && i.condition === 'S40').sort(byHash('s40en')).slice(0, 40), 'soft command (S40), English');
take(speech.filter((i) => i.set === 'ar-command' && i.condition === 'S40').sort(byHash('s40ar')).slice(0, 40), 'soft command (S40), Arabic');
take(speech.filter((i) => i.set === 'en-command' && (i.condition === 'N10' || i.condition === 'N5')).sort(byHash('nen')).slice(0, 40), 'command over noise, English');
take(speech.filter((i) => i.set === 'ar-command' && (i.condition === 'N10' || i.condition === 'N5')).sort(byHash('nar')).slice(0, 40), 'command over noise, Arabic');
take(speech.filter((i) => i.set === 'en-sentence' && (i.condition === 'N10' || i.condition === 'N5')).sort(byHash('nsent')).slice(0, 20), 'sentence over noise');
take(speech.filter((i) => i.set === 'en-sentence' && i.condition === 'S30').sort(byHash('s30')).slice(0, 20), 'sentence (S30)');
for (const [id, entry] of picked) if (!hard.has(id)) queue.push(entry);
const plan = flag === '--only' ? queue.slice(0, Number(only)) : queue;
console.error(`clips: ${plan.length} (${hardItems.length} known hard cases); cap ${CAP_MS / 60000} min of audio sent`);

const languageOf = (item: Item) => (item.set === 'ar-command' ? 'ar' : 'en');
const sleepUntil = (at: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, at - performance.now())));

let sentTotal = 0;
let streamsTotal = 0;
async function record(item: Item, group: string): Promise<RecordedClip> {
    const { pcm, onsetMs, offsetMs, leadExtraMs } = audioOf(item);
    const language = languageOf(item);
    const connector = new SonioxRecognition();
    const streams: RecordedStream[] = [];
    const start = performance.now();
    const now = () => Math.round(performance.now() - start);
    let open = 0;
    const recognition = new Recognition({
        factory: (events) => {
            const s: RecordedStream = { openAt: now(), events: [], sentMs: 0 };
            streams.push(s);
            streamsTotal++;
            open++;
            let over = false;
            const settle = () => {
                if (!over) (over = true), open--;
            };
            const inner = connector.listen(
                { adapter: 'soniox', model: SONIOX_CURRENT_MODEL, key: { reveal: () => key } as never, language },
                {
                    partial: (text) => (s.events.push([now(), 'partial', text]), events.partial(text)),
                    final: (text) => (s.events.push([now(), 'final', text]), settle(), events.final(text)),
                    endpoint: () => (s.events.push([now(), 'endpoint']), events.endpoint?.()),
                    failed: (text, failure) => (s.events.push([now(), 'failed', text, failure?.status]), settle(), events.failed(text, failure)),
                }
            );
            return {
                pauseMs: inner.pauseMs,
                push: (frame: Int16Array) => {
                    if (s.finishAt === undefined && !over) {
                        s.sentMs += frame.length / 16;
                        sentTotal += frame.length / 16;
                    }
                    inner.push(frame);
                },
                finish: () => {
                    s.finishAt ??= now();
                    inner.finish();
                },
                close: () => {
                    settle();
                    inner.close();
                },
            };
        },
        maxUtteranceMs: 180000,
        counters: new Counters(),
        send: () => undefined,
    });
    const total = pcm.length + (TAIL_MS * RATE) / 1000;
    const silence = new Int16Array(FRAME);
    for (let at = 0, i = 0; at + FRAME <= total; at += FRAME, i++) {
        await sleepUntil(start + i * 20);
        const frame = at + FRAME <= pcm.length ? pcm.subarray(at, at + FRAME) : silence;
        recognition.sink({ participantId: 'p', epoch: 1, pcm16k: frame, droppedMs: 0 });
    }
    // The last words: Soniox answers within its own final timeout (10 s) or the stream counts as failed
    for (const until = performance.now() + 12_000; open > 0 && performance.now() < until; ) await sleepUntil(performance.now() + 50);
    recognition.dispose();
    return { id: item.id, kind: item.kind, set: item.set, label: item.label, condition: item.condition, group, language, seconds: pcm.length / RATE, leadExtraMs, onsetMs, offsetMs, streams, sentMs: Math.round(streams.reduce((a, s) => a + s.sentMs, 0)) };
}

const outPath = join(out, 'soniox-record.jsonl');
writeFileSync(outPath, '');
let next = 0;
let done = 0;
let capped = 0;
async function lane(): Promise<void> {
    for (;;) {
        const i = next++;
        if (i >= plan.length) return;
        if (sentTotal >= CAP_MS) {
            capped++;
            continue;
        }
        const { item, group } = plan[i];
        const row = await record(item, group);
        appendFileSync(outPath, JSON.stringify(row) + '\n');
        if (++done % 20 === 0) console.error(`${done}/${plan.length}, ${(sentTotal / 60000).toFixed(1)} min sent, ${streamsTotal} streams`);
    }
}
await Promise.all(Array.from({ length: CONCURRENT }, lane));
const cost = { clips: done, notRunForTheCap: capped, streams: streamsTotal, sentMinutes: +(sentTotal / 60000).toFixed(2), pricePerHourUsd: PRICE_PER_HOUR, estimatedUsd: +((sentTotal / 3600000) * PRICE_PER_HOUR).toFixed(3) };
writeFileSync(join(out, 'soniox-record-cost.json'), JSON.stringify(cost, null, 2) + '\n');
console.error(JSON.stringify(cost));
