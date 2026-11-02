/**
 * What a voice bot says out loud, and when (#1665): only a reply that is finished and checked, once, never over a
 * person who is talking, and never the claim a retry replaced.
 */
import { describe, expect, it } from 'vitest';
import { BotSpeech, type SpeechVoice } from '../voice/BotSpeech';
import { DEFAULT_REPLY_LIMITS } from '../voice/settings';
import { SPOKEN_PHRASES } from '../voice/SpokenText';

const SPACE = 'proximity-1';
const reply = (n: number, player = 7) => `bot-b1-player-${player}-0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;

function setup(options: { audience?: boolean; limits?: Partial<typeof DEFAULT_REPLY_LIMITS> } = {}) {
    let clock = 1000;
    const said: { segmentId: string; text: string; maxMs?: number }[] = [];
    const state = { audience: options.audience ?? true, speaking: false, spokenToAt: 0, sayWorks: true };
    const voice: SpeechVoice = {
        say: (_space, segmentId, text, maxMs) => {
            if (!state.sayWorks) return false;
            said.push({ segmentId, text, maxMs });
            return true;
        },
        hasAudience: () => state.audience,
        someoneSpeaking: () => state.speaking,
        lastSpokenToAt: () => state.spokenToAt,
    };
    const speech = new BotSpeech(voice, { ...DEFAULT_REPLY_LIMITS, ...options.limits }, () => clock);
    return { speech, said, state, tick: (ms: number) => (clock += ms), now: () => clock };
}

describe('a finished reply', () => {
    it('is said as it was written, for at most the time the settings allow', () => {
        const t = setup();
        expect(t.speech.final(SPACE, reply(1), 'Hi! What should we build?')).toBe('spoken');
        expect(t.said).toEqual([{ segmentId: 's1', text: 'Hi! What should we build?', maxMs: 60000 }]);
    });

    it('is shortened to the characters the settings allow, with the full text left to the chat', () => {
        const t = setup({ limits: { maxChars: 80, maxSeconds: 20 } });
        t.speech.final(SPACE, reply(1), 'First thing to say. '.repeat(20));
        expect(t.said[0].text.length).toBeLessThanOrEqual(80);
        expect(t.said[0].text.endsWith(SPOKEN_PHRASES.rest)).toBe(true);
        expect(t.said[0].maxMs).toBe(20000);
    });

    it('says a short line for a table and code, and nothing for a reply with nothing to say', () => {
        const t = setup();
        t.speech.final(SPACE, reply(1), '| a | b |\n| --- | --- |\n| 1 | 2 |');
        expect(t.said[0].text).toBe(SPOKEN_PHRASES.table);
        expect(t.speech.final(SPACE, reply(2), '   ')).toBe('unsaid');
        expect(t.said).toHaveLength(1);
    });

    it('is said once, however many times it is finished', () => {
        const t = setup();
        t.speech.final(SPACE, reply(1), 'Hello there.');
        expect(t.speech.final(SPACE, reply(1), 'Hello there.')).toBe('again');
        expect(t.said).toHaveLength(1);
    });
});

describe('only what has been checked', () => {
    it('is not said while a tool round or a retry is under way for that person, and is again once checked', () => {
        const t = setup();
        t.speech.hold(SPACE, 7);
        expect(t.speech.final(SPACE, reply(1), "I'll make that now.")).toBe('held');
        // Someone else's reply is not held back by it
        expect(t.speech.final(SPACE, reply(2, 8), 'Hello Sam.')).toBe('spoken');
        t.speech.release(SPACE, 7);
        expect(t.speech.final(SPACE, reply(3), 'Made it. It is in the chat.')).toBe('spoken');
        expect(t.said.map((s) => s.text)).toEqual(['Hello Sam.', 'Made it. It is in the chat.']);
    });

    it('says only the line that nothing was saved when a reply carries it, never the claim before it', () => {
        const t = setup();
        t.speech.final(SPACE, reply(1), 'Rebuilt it, v2 has the charts.\n\nNo new version was saved.');
        expect(t.said.map((s) => s.text)).toEqual(['No new version was saved.']);
    });

    it('lets a greeting, which has no turn to hold it, through', () => {
        const t = setup();
        t.speech.hold(SPACE, 7);
        expect(t.speech.final(SPACE, '4f0d6c1e-greeting-uuid', 'Welcome!')).toBe('spoken');
    });

    it('forgets what was held when the bot leaves the space', () => {
        const t = setup();
        t.speech.hold(SPACE, 7);
        t.speech.spaceLeft(SPACE);
        expect(t.speech.final(SPACE, reply(1), 'Back again.')).toBe('spoken');
    });
});

describe('a person talking wins', () => {
    it('is not talked over: a reply finished while they speak is not said, now or later', () => {
        const t = setup();
        t.state.speaking = true;
        expect(t.speech.final(SPACE, reply(1), 'Let me tell you.')).toBe('overtaken');
        t.state.speaking = false;
        expect(t.speech.final(SPACE, reply(1), 'Let me tell you.')).toBe('again');
        expect(t.said).toEqual([]);
    });

    it('drops a reply that was begun before they started to talk, but not one begun after', () => {
        const t = setup();
        t.speech.begin(reply(1));
        t.tick(500);
        t.state.spokenToAt = t.now();
        t.tick(500);
        expect(t.speech.final(SPACE, reply(1), 'My answer.')).toBe('overtaken');
        t.speech.begin(reply(2));
        t.tick(100);
        expect(t.speech.final(SPACE, reply(2), 'My next answer.')).toBe('spoken');
        expect(t.said.map((s) => s.text)).toEqual(['My next answer.']);
    });
});

describe('a greeting finished before anyone is connected', () => {
    it('waits for the first audio and is said once, however often audio connects after that', () => {
        const t = setup({ audience: false });
        expect(t.speech.final(SPACE, 'greeting-1', 'Welcome!')).toBe('waiting');
        expect(t.said).toEqual([]);
        t.state.audience = true;
        t.tick(2000);
        t.speech.audience(SPACE);
        expect(t.said.map((s) => s.text)).toEqual(['Welcome!']);
        // The worker restarts, or the person connects again: nothing is greeted twice
        t.speech.audience(SPACE);
        t.speech.audience(SPACE);
        expect(t.speech.final(SPACE, 'greeting-1', 'Welcome!')).toBe('again');
        expect(t.said).toHaveLength(1);
    });

    it('is dropped when the audio takes too long, so an old reply is not said out of the blue', () => {
        const t = setup({ audience: false });
        t.speech.final(SPACE, 'greeting-1', 'Welcome!');
        t.tick(DEFAULT_REPLY_LIMITS.greetingWaitSeconds * 1000 + 1);
        t.state.audience = true;
        t.speech.audience(SPACE);
        expect(t.said).toEqual([]);
    });

    it('waits as long as the setting says', () => {
        const t = setup({ audience: false, limits: { greetingWaitSeconds: 40 } });
        t.speech.final(SPACE, 'greeting-1', 'Welcome!');
        t.tick(30000);
        t.state.audience = true;
        t.speech.audience(SPACE);
        expect(t.said.map((s) => s.text)).toEqual(['Welcome!']);
    });

    it('is dropped when they have begun to talk by then, and when the bot has left', () => {
        const t = setup({ audience: false });
        t.speech.final(SPACE, 'greeting-1', 'Welcome!');
        t.state.speaking = true;
        t.speech.audience(SPACE);
        expect(t.said).toEqual([]);
        t.speech.final(SPACE, 'greeting-2', 'Hello again!');
        t.speech.spaceLeft(SPACE);
        t.state.speaking = false;
        t.speech.audience(SPACE);
        expect(t.said).toEqual([]);
    });
});

describe('a voice that was cut short', () => {
    it('names the reply, only in its own space', () => {
        const t = setup();
        t.speech.final(SPACE, reply(1), 'A long answer.');
        expect(t.speech.stopped(SPACE, 's1')).toBe(reply(1));
        expect(t.speech.stopped('elsewhere', 's1')).toBeUndefined();
        expect(t.speech.stopped(SPACE, 's9')).toBeUndefined();
    });
});

describe('a bot whose voice Orbit decides', () => {
    function withOrbit(decision: () => Promise<import('../voice/BotSpeech').TurnDecision>) {
        const t = setup();
        const asked: string[] = [];
        const voice: SpeechVoice = {
            say: (_space, segmentId, text, maxMs) => (t.said.push({ segmentId, text, maxMs }), true),
            hasAudience: () => true,
            someoneSpeaking: () => false,
            lastSpokenToAt: () => 0,
            beforeSpeaking: async (space) => (asked.push(space), decision()),
        };
        return { ...t, asked, speech: new BotSpeech(voice, DEFAULT_REPLY_LIMITS, t.now) };
    }
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('asks just before a reply is said, and says it when told to', async () => {
        const t = withOrbit(async () => ({ action: 'speak', limits: { maxChars: 30, maxSeconds: 5 } }));
        expect(t.speech.final(SPACE, reply(1), 'A reply that is longer than thirty characters, so it is cut.')).toBe('checking');
        expect(t.said).toEqual([]);
        await flush();
        expect(t.asked).toEqual([SPACE]);
        expect(t.said).toHaveLength(1);
        expect(t.said[0].text.length).toBeLessThanOrEqual(30);
        expect(t.said[0].maxMs).toBe(5000);
    });

    it('does not say a reply twice while Orbit is being asked', async () => {
        const t = withOrbit(async () => ({ action: 'speak' }));
        t.speech.final(SPACE, reply(1), 'Hello.');
        expect(t.speech.final(SPACE, reply(1), 'Hello.')).toBe('again');
        await flush();
        expect(t.said).toHaveLength(1);
    });

    it('leaves a reply in the chat when told to answer in text, or when Orbit cannot be asked', async () => {
        const text = withOrbit(async () => ({ action: 'text' }));
        text.speech.final(SPACE, reply(1), 'Hello.');
        const down = withOrbit(async () => {
            throw new Error('down');
        });
        down.speech.final(SPACE, reply(1), 'Hello.');
        await flush();
        expect(text.said).toEqual([]);
        expect(down.said).toEqual([]);
        // The same reply finished again is not said either
        expect(text.speech.final(SPACE, reply(1), 'Hello.')).toBe('again');
    });

    it('keeps a reply for when the audio is back, like a greeting, when told to wait', async () => {
        let action: 'wait' | 'speak' = 'wait';
        const t = withOrbit(async () => ({ action }));
        t.speech.final(SPACE, reply(1), 'Welcome back.');
        await flush();
        expect(t.said).toEqual([]);
        action = 'speak';
        t.speech.audience(SPACE);
        await flush();
        expect(t.said.map((s) => s.text)).toEqual(['Welcome back.']);
    });
});
