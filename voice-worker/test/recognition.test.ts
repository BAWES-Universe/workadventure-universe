import { describe, expect, it } from 'vitest';
import { Counters } from '../src/counters.ts';
import { FakeEars, type FakeUtterance } from '../src/recognizer.ts';
import { Recognition } from '../src/recognition.ts';
import type { WorkerToBot } from '../src/protocol.ts';
import type { OutgoingMessage } from '../src/session.ts';
import { checkMessage } from '../src/validate.ts';
import { sleep } from './harness.ts';

const FRAME = 20;
const loud = (): Int16Array => Int16Array.from({ length: 320 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 16000)));
const quiet = (): Int16Array => new Int16Array(320);

interface Rig {
    ears: FakeEars;
    recognition: Recognition;
    sent: OutgoingMessage[];
    tapped: number[];
    speak(ms: number, who?: string, epoch?: number, droppedMs?: number): void;
    pause(ms: number, who?: string, epoch?: number): void;
    turns(): Extract<OutgoingMessage, { type: 'user.turn' }>[];
    partials(): string[];
}

function rig(script: (string | FakeUtterance)[], options: { maxUtteranceMs?: number; pauseMs?: number; idleMs?: number } = {}): Rig {
    const sent: OutgoingMessage[] = [];
    const tapped: number[] = [];
    const ears = new FakeEars(script);
    const recognition = new Recognition({
        factory: ears.factory,
        maxUtteranceMs: options.maxUtteranceMs ?? 180000,
        pauseMs: options.pauseMs ?? 400,
        idleMs: options.idleMs,
        counters: new Counters(),
        send: (message) => {
            sent.push(message);
            // Every message is checked against the schema, as the bridge does
            expect(checkMessage('fromWorker', { ...message, sessionId: 's' })).toBeNull();
        },
        next: (frame) => tapped.push(frame.pcm16k.length),
    });
    const feed = (pcm: () => Int16Array, ms: number, who: string, epoch: number, droppedMs = 0) => {
        for (let t = 0; t < ms; t += FRAME) recognition.sink({ participantId: who, epoch, pcm16k: pcm(), droppedMs: t === 0 ? droppedMs : 0 });
    };
    return {
        ears,
        recognition,
        sent,
        tapped,
        speak: (ms, who = 'p1', epoch = 1, droppedMs = 0) => feed(loud, ms, who, epoch, droppedMs),
        pause: (ms, who = 'p1', epoch = 1) => feed(quiet, ms, who, epoch),
        turns: () => sent.filter((m): m is Extract<WorkerToBot, { type: 'user.turn' }> => m.type === 'user.turn'),
        partials: () => sent.filter((m) => m.type === 'user.partial').map((m) => (m as { text: string }).text),
    };
}

describe('a short noise is not someone speaking', () => {
    it('sends no speech_started for a click shorter than the barge-in, and only the cleared end', () => {
        const r = rig(['']);
        r.speak(40);
        r.pause(1200);
        expect(r.sent.some((m) => m.type === 'user.speech_started')).toBe(false);
        expect(r.turns()).toHaveLength(1);
        expect(r.turns()[0]).toMatchObject({ outcome: 'cleared' });
    });

    it('sends speech_started once the voiced audio reaches the barge-in', () => {
        const r = rig(['hello there']);
        r.speak(40);
        expect(r.sent.some((m) => m.type === 'user.speech_started')).toBe(false);
        r.speak(100);
        expect(r.sent.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        r.speak(600);
        expect(r.sent.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
    });
});

describe('words while someone talks', () => {
    it('fills in as they speak, each replacing the one before, and ends with one final line after a pause', () => {
        const r = rig(['Actually which of them replied this week']);
        r.speak(900);
        expect(r.sent[0]).toMatchObject({ type: 'user.speech_started', participantId: 'p1', epoch: 1 });
        expect(r.partials()).toEqual(['Actually', 'Actually which', 'Actually which of']);
        expect(r.turns()).toEqual([]);
        r.speak(1200);
        expect(r.partials().at(-1)).toBe('Actually which of them replied this week');
        r.pause(400);
        expect(r.turns()).toHaveLength(1);
        expect(r.turns()[0]).toMatchObject({ outcome: 'final', text: 'Actually which of them replied this week', participantId: 'p1', epoch: 1 });
        // Words only reach the bot server; the same turn id ties it all together
        const ids = new Set(r.sent.map((m) => (m as { turnId?: string }).turnId));
        expect(ids.size).toBe(1);
    });

    it('does not repeat words that did not change', () => {
        const r = rig(['one two three']);
        r.speak(2000);
        const texts = r.partials();
        expect(new Set(texts).size).toBe(texts.length);
    });

    it('takes the next stretch as its own turn, with its own id', () => {
        const r = rig(['first words', 'second words']);
        r.speak(700);
        r.pause(400);
        r.speak(700);
        r.pause(400);
        expect(r.turns().map((t) => t.text)).toEqual(['first words', 'second words']);
        expect(new Set(r.turns().map((t) => t.turnId)).size).toBe(2);
    });

    it('keeps each person apart: one turn per speaker, never a mix', () => {
        const r = rig(['from the first', 'from the second']);
        r.speak(700, 'p1');
        r.speak(700, 'p2');
        r.pause(400, 'p1');
        r.pause(400, 'p2');
        expect(r.turns().map((t) => [t.participantId, t.text])).toEqual([
            ['p1', 'from the first'],
            ['p2', 'from the second'],
        ]);
    });

    it('is cleared when nothing was said', () => {
        const r = rig(['']);
        r.speak(300);
        r.pause(400);
        expect(r.turns()).toMatchObject([{ outcome: 'cleared' }]);
        expect(r.turns()[0].text).toBeUndefined();
    });

    it('waits for the recognizer when its final words are slow, and says nothing meanwhile', async () => {
        const r = rig([{ text: 'late words here', finalDelayMs: 30 }]);
        r.speak(1000);
        r.pause(400);
        expect(r.turns()).toEqual([]);
        await sleep(80);
        expect(r.turns()).toMatchObject([{ outcome: 'final', text: 'late words here' }]);
    });

    it('takes it as a pause when the audio simply stops (a sender that sends nothing while silent)', async () => {
        const r = rig(['one two three'], { idleMs: 60 });
        r.speak(1000);
        expect(r.turns()).toEqual([]);
        await sleep(150);
        expect(r.turns()).toMatchObject([{ outcome: 'final', text: 'one two three' }]);
        // And a stretch that goes on is not cut by the timer
        const s = rig(['one two three four five six'], { idleMs: 60 });
        for (let i = 0; i < 6; i++) {
            s.speak(300);
            await sleep(30);
        }
        expect(s.turns()).toEqual([]);
    });

    it('still passes every frame to the worker-wide tap', () => {
        const r = rig(['hi']);
        r.speak(100);
        expect(r.tapped).toHaveLength(5);
    });

    it('keeps no audio: the recognizer of a finished turn is closed and nothing is held for the next', () => {
        const r = rig(['hello there']);
        r.speak(700);
        r.pause(400);
        expect(r.ears.closed).toBe(1);
    });
});

describe('words that did not come through are only offered back', () => {
    it('stops at the limit with the words so far, never final, and takes nothing more until a pause', () => {
        const r = rig(['one two three four five six seven eight nine ten'], { maxUtteranceMs: 1700 });
        r.speak(3000);
        expect(r.turns()).toMatchObject([{ outcome: 'lost', reason: 'cap', text: 'one two three four five' }]);
        // Still talking: not taken as a new stretch
        expect(r.ears.started).toBe(1);
        r.pause(400);
        r.speak(300);
        expect(r.ears.started).toBe(2);
    });

    it('counts the audio of the limit in the person\'s speech, so the default of 180 s means three minutes of it', () => {
        const r = rig(['word'], { maxUtteranceMs: 180000 });
        r.speak(179000);
        expect(r.turns()).toEqual([]);
        r.speak(2000);
        expect(r.turns()).toMatchObject([{ outcome: 'lost', reason: 'cap' }]);
    });

    it('offers back the words when the connection drops mid-sentence, and a late final does nothing', async () => {
        const r = rig([{ text: 'Actually which of them replied', finalDelayMs: 30 }]);
        r.speak(900);
        r.recognition.interrupt('p1', 1, 'lost');
        expect(r.turns()).toMatchObject([{ outcome: 'lost', reason: 'path', text: 'Actually which of' }]);
        await sleep(60);
        expect(r.turns()).toHaveLength(1);
    });

    it('offers back the words of a stretch that already paused but had no final yet', async () => {
        const r = rig([{ text: 'Actually which of them replied', finalDelayMs: 200 }]);
        r.speak(900);
        r.pause(400);
        r.recognition.interrupt('p1', 1, 'lost');
        // The pause counted as audio too: what the recognizer had by then
        expect(r.turns()).toMatchObject([{ outcome: 'lost', text: 'Actually which of them' }]);
        await sleep(240);
        expect(r.turns()).toHaveLength(1);
    });

    it('offers back the words when the recognizer gives up, and waits for a pause before listening again', () => {
        const r = rig([{ text: 'one two three four five', failAfterWords: 2 }, 'six seven']);
        r.speak(1500);
        expect(r.turns()).toMatchObject([{ outcome: 'lost', reason: 'provider', text: 'one two' }]);
        expect(r.ears.started).toBe(1);
        r.pause(400);
        r.speak(700);
        r.pause(400);
        expect(r.turns().map((t) => t.outcome)).toEqual(['lost', 'final']);
    });

    it('does not trust words from audio with a hole in it', () => {
        const r = rig(['one two three four']);
        r.speak(300);
        r.speak(20, 'p1', 1, 500);
        r.speak(700);
        r.pause(400);
        expect(r.turns()).toMatchObject([{ outcome: 'lost', reason: 'gap', text: 'one two three four' }]);
    });

    it('lets a small loss of packets go', () => {
        const r = rig(['one two three four']);
        r.speak(300);
        r.speak(20, 'p1', 1, 60);
        r.speak(700);
        r.pause(400);
        expect(r.turns()).toMatchObject([{ outcome: 'final' }]);
    });

    it('offers back what was said on an older path when a newer one starts, and the old path is heard no more', () => {
        const r = rig(['one two three four', 'five six']);
        r.speak(900, 'p1', 1);
        r.speak(300, 'p1', 2);
        expect(r.turns()).toMatchObject([{ outcome: 'lost', reason: 'path', epoch: 1, text: 'one two three' }]);
        // Late audio from the old path is dropped
        const before = r.sent.length;
        r.speak(400, 'p1', 1);
        expect(r.sent).toHaveLength(before);
        r.pause(400, 'p1', 2);
        expect(r.turns().at(-1)).toMatchObject({ outcome: 'final', epoch: 2, text: 'five six' });
    });

    it('offers back the words of everyone on a room that closes, and of everyone when voice stops', () => {
        const r = rig(['one two three', 'four five six']);
        r.speak(700, 'p1', 7);
        r.speak(700, 'p2', 7);
        r.recognition.interruptEpoch(7, 'lost');
        expect(r.turns().map((t) => [t.participantId, t.text, t.reason])).toEqual([
            ['p1', 'one two', 'path'],
            ['p2', 'four five', 'path'],
        ]);

        const s = rig(['one two three']);
        s.speak(700);
        s.recognition.interruptAll('lost', 'stopped');
        expect(s.turns()).toMatchObject([{ outcome: 'lost', reason: 'stopped', text: 'one two' }]);
    });
});

describe('words nobody asked to keep', () => {
    it('go nowhere, not even back to the person, when they are no longer heard on purpose', () => {
        const r = rig(['one two three']);
        r.speak(700);
        r.recognition.forget(() => false);
        expect(r.turns()).toMatchObject([{ outcome: 'cleared' }]);
        expect(r.turns()[0].text).toBeUndefined();
    });

    it('leave people who are still heard alone', () => {
        const r = rig(['one two three', 'four five']);
        r.speak(700, 'p1');
        r.speak(700, 'p2');
        r.recognition.forget((id) => id === 'p1');
        expect(r.turns().map((t) => [t.participantId, t.outcome])).toEqual([['p2', 'cleared']]);
    });

    it('say nothing at all once the session is over', () => {
        const r = rig(['one two three']);
        r.speak(700);
        const before = r.sent.length;
        r.recognition.dispose();
        r.speak(400);
        expect(r.sent).toHaveLength(before);
        expect(r.ears.closed).toBe(1);
    });
});
