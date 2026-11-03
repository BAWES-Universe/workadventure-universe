/**
 * What a voice bot says out loud, and when (#1665): only a reply that is finished and checked, once, never over a
 * person who is talking, and never the claim a retry replaced.
 */
import { describe, expect, it, vi } from 'vitest';
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

describe('a reply that will not be spoken after all', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    function track(options: { audience?: boolean; decision?: () => Promise<import('../voice/BotSpeech').TurnDecision>; sayWorks?: boolean; throws?: boolean } = {}) {
        let clock = 1000;
        const state = { audience: options.audience ?? true, speaking: false, spokenToAt: 0 };
        const given: string[] = [];
        const said: string[] = [];
        const voice: SpeechVoice = {
            say: (_space, _segment, text) => (options.sayWorks === false ? false : (said.push(text), true)),
            hasAudience: () => state.audience,
            someoneSpeaking: () => state.speaking,
            lastSpokenToAt: () => state.spokenToAt,
            beforeSpeaking: async () => (options.decision ? options.decision() : { action: 'speak' }),
            unspoken: (_space, turn) => {
                given.push(turn.turnId);
                if (options.throws) throw new Error('boom');
            },
        };
        const speech = new BotSpeech(voice, DEFAULT_REPLY_LIMITS, () => clock);
        return { speech, state, given, said, tick: (ms: number) => (clock += ms) };
    }

    it('is not let go when it was spoken', async () => {
        const t = track();
        t.speech.final(SPACE, reply(1), 'Hello.');
        await flush();
        expect(t.said).toEqual(['Hello.']);
        expect(t.given).toEqual([]);
    });

    it('is let go when a person started talking while Orbit was being asked', async () => {
        const t = track({
            decision: async () => {
                t.state.speaking = true;
                return { action: 'speak' };
            },
        });
        t.speech.final(SPACE, reply(1), 'Hello.');
        await flush();
        expect(t.said).toEqual([]);
        expect(t.given).toEqual([reply(1)]);
    });

    it('is let go when told to stay in text, or when the answer fails (a bubble that went away after it was counted)', async () => {
        const text = track({ decision: async () => ({ action: 'text' }) });
        text.speech.final(SPACE, reply(1), 'Hello.');
        const failed = track({ decision: async () => Promise.reject(new Error('gone')) });
        failed.speech.final(SPACE, reply(2), 'Hello.');
        await flush();
        expect(text.given).toEqual([reply(1)]);
        expect(failed.given).toEqual([reply(2)]);
    });

    it('is let go when the voice cannot say it', async () => {
        const t = track({ sayWorks: false });
        t.speech.final(SPACE, reply(1), 'Hello.');
        await flush();
        expect(t.given).toEqual([reply(1)]);
    });

    it('is let go when it waited for an audience too long, or when someone was talking by the time it came', async () => {
        const late = track({ audience: false });
        late.speech.final(SPACE, reply(1), 'Welcome.');
        late.tick(DEFAULT_REPLY_LIMITS.greetingWaitSeconds * 1000 + 1);
        late.state.audience = true;
        late.speech.audience(SPACE);
        expect(late.said).toEqual([]);
        expect(late.given).toEqual([reply(1)]);

        const busy = track({ audience: false });
        busy.speech.final(SPACE, reply(2), 'Welcome.');
        busy.state.speaking = true;
        busy.speech.audience(SPACE);
        expect(busy.given).toEqual([reply(2)]);
    });

    it('is let go by itself when nobody ever comes to hear it', () => {
        vi.useFakeTimers();
        try {
            const t = track({ audience: false });
            t.speech.final(SPACE, reply(1), 'Welcome.');
            vi.advanceTimersByTime(DEFAULT_REPLY_LIMITS.greetingWaitSeconds * 1000 - 1);
            expect(t.given).toEqual([]);
            vi.advanceTimersByTime(2);
            expect(t.given).toEqual([reply(1)]);
            // And it is not let go a second time
            t.speech.spaceLeft(SPACE);
            expect(t.given).toEqual([reply(1)]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('is not let go when the audience came in time and it was spoken', () => {
        vi.useFakeTimers();
        try {
            const t = track({ audience: false, decision: undefined });
            t.speech.final(SPACE, reply(1), 'Welcome.');
            t.state.audience = true;
            t.speech.audience(SPACE);
            vi.advanceTimersByTime(60_000);
            expect(t.given).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('is let go when a newer one takes its place, when the space is left, and when the bot stops', () => {
        const t = track({ audience: false });
        t.speech.final(SPACE, reply(1), 'First.');
        t.speech.final(SPACE, reply(2), 'Second.');
        expect(t.given).toEqual([reply(1)]);
        t.speech.spaceLeft(SPACE);
        expect(t.given).toEqual([reply(1), reply(2)]);
        t.speech.final('other', reply(3), 'Third.');
        t.speech.shutdown();
        expect(t.given).toEqual([reply(1), reply(2), reply(3)]);
    });

    it('is let go when the worker ended its segment without any of it heard, and only then', async () => {
        const t = track();
        t.speech.final(SPACE, reply(1), 'One.');
        t.speech.final(SPACE, reply(2), 'Two.');
        await flush();
        t.speech.unplayed('elsewhere', 's1');
        t.speech.unplayed(SPACE, 's9');
        expect(t.given).toEqual([]);
        t.speech.unplayed(SPACE, 's1');
        t.speech.unplayed(SPACE, 's1');
        expect(t.given).toEqual([reply(1)]);
    });

    it('is let go when its session ends before any of it began to play, and kept when some was heard', async () => {
        const t = track();
        t.speech.final(SPACE, reply(1), 'One.');
        await flush();
        t.speech.final(SPACE, reply(2), 'Two.');
        await flush();
        t.speech.heard(SPACE, 's2');
        t.speech.heard('elsewhere', 's1');
        t.speech.sessionEnded('elsewhere');
        expect(t.given).toEqual([]);
        t.speech.sessionEnded(SPACE);
        expect(t.given).toEqual([reply(1)]);
        // Once is enough
        t.speech.sessionEnded(SPACE);
        expect(t.given).toEqual([reply(1)]);
    });

    it('never gets in the way when giving it back throws', async () => {
        const t = track({ sayWorks: false, throws: true });
        expect(() => t.speech.final(SPACE, reply(1), 'Hello.')).not.toThrow();
        await flush();
        expect(t.given).toEqual([reply(1)]);
    });
});

describe('two voice bots in one bubble (#1670)', () => {
    function crowdedSetup() {
        const retracted: string[] = [];
        const said: string[] = [];
        const state = { crowded: false };
        const voice: SpeechVoice = {
            say: (_space, _id, text) => (said.push(text), true),
            hasAudience: () => true,
            someoneSpeaking: () => false,
            lastSpokenToAt: () => 0,
            crowded: () => state.crowded,
            retract: (_space, segmentId) => void retracted.push(segmentId),
        };
        return { speech: new BotSpeech(voice, DEFAULT_REPLY_LIMITS, () => 1000), said, retracted, state };
    }

    it('keeps a reply in the chat while another voice bot is here, and never says it later', () => {
        const t = crowdedSetup();
        t.state.crowded = true;
        expect(t.speech.final(SPACE, reply(1), 'Noted.')).toBe('unsaid');
        t.state.crowded = false;
        expect(t.speech.final(SPACE, reply(1), 'Noted.')).toBe('again');
        expect(t.said).toEqual([]);
        expect(t.speech.final(SPACE, reply(2), 'Next one.')).toBe('spoken');
        expect(t.said).toEqual(['Next one.']);
    });

    it('takes back what is still playing, and only that, when a second voice bot arrives', () => {
        const t = crowdedSetup();
        t.speech.final(SPACE, reply(1), 'First.');
        t.speech.final(SPACE, reply(2), 'Second.');
        t.speech.final('other-space', reply(3), 'Elsewhere.');
        t.speech.played('s1');
        t.speech.crowded(SPACE);
        expect(t.retracted).toEqual(['s2']);
    });

    it('drops a greeting that was waiting for someone to connect', () => {
        const t = crowdedSetup();
        let audience = false;
        const voice: SpeechVoice = { say: () => true, hasAudience: () => audience, someoneSpeaking: () => false, lastSpokenToAt: () => 0, crowded: () => t.state.crowded };
        const speech = new BotSpeech(voice, DEFAULT_REPLY_LIMITS, () => 1000);
        expect(speech.final(SPACE, reply(1), 'Welcome!')).toBe('waiting');
        speech.crowded(SPACE);
        audience = true;
        speech.audience(SPACE);
        expect(speech.final(SPACE, reply(1), 'Welcome!')).toBe('again');
    });

    it('gives back what was counted for a greeting dropped because a second voice bot arrived', () => {
        const given: string[] = [];
        const voice: SpeechVoice = {
            say: () => true,
            hasAudience: () => false,
            someoneSpeaking: () => false,
            lastSpokenToAt: () => 0,
            unspoken: (_space, turn) => void given.push(turn.turnId),
        };
        const speech = new BotSpeech(voice, DEFAULT_REPLY_LIMITS, () => 1000);
        speech.final(SPACE, reply(1), 'Welcome!');
        speech.crowded(SPACE);
        expect(given).toEqual([reply(1)]);
    });

    it('gives back a reply that was counted and then reaches the voice while a second voice bot is here', () => {
        const given: string[] = [];
        let crowded = false;
        let audience = false;
        const voice: SpeechVoice = {
            say: () => true,
            hasAudience: () => audience,
            someoneSpeaking: () => false,
            lastSpokenToAt: () => 0,
            crowded: () => crowded,
            unspoken: (_space, turn) => void given.push(turn.turnId),
        };
        const speech = new BotSpeech(voice, DEFAULT_REPLY_LIMITS, () => 1000);
        speech.final(SPACE, reply(1), 'Welcome!');
        crowded = true;
        audience = true;
        speech.audience(SPACE);
        expect(given).toEqual([reply(1)]);
    });

    it('does not say a reply that was waiting for its turn once a second voice bot is here', () => {
        const t = crowdedSetup();
        let audience = false;
        const said: string[] = [];
        const voice: SpeechVoice = { say: (_s, _i, text) => (said.push(text), true), hasAudience: () => audience, someoneSpeaking: () => false, lastSpokenToAt: () => 0, crowded: () => t.state.crowded };
        const speech = new BotSpeech(voice, DEFAULT_REPLY_LIMITS, () => 1000);
        speech.final(SPACE, reply(1), 'Welcome!');
        t.state.crowded = true;
        audience = true;
        speech.audience(SPACE);
        expect(said).toEqual([]);
    });
});

describe('the person a spoken reply is for (#1220)', () => {
    it('is being spoken to until the audio is over, and their follow-up window starts then', () => {
        const t = setup();
        const over: [string, number][] = [];
        t.speech.onOver = (space, person) => over.push([space, person]);
        t.speech.final(SPACE, reply(1, 7), 'A long answer.');
        expect(t.speech.isSpeakingTo(7)).toBe(true);
        expect(t.speech.isSpeakingTo(8)).toBe(false);
        expect(over).toEqual([]);

        t.speech.played('s1');
        expect(t.speech.isSpeakingTo(7)).toBe(false);
        expect(over).toEqual([[SPACE, 7]]);
        // A segment that is not ours changes nothing
        t.speech.played('s9');
        expect(over).toHaveLength(1);
    });

    it('is no longer being spoken to once the audio session ends mid-playback, and only for that bubble', () => {
        const t = setup();
        t.speech.final(SPACE, reply(1, 7), 'A long answer.');
        t.speech.heard(SPACE, 's1');
        expect(t.speech.isSpeakingTo(7)).toBe(true);
        t.speech.sessionEnded('elsewhere');
        expect(t.speech.isSpeakingTo(7)).toBe(true);
        t.speech.sessionEnded(SPACE);
        expect(t.speech.isSpeakingTo(7)).toBe(false);
    });
});

describe('a person who says they are done (#1670)', () => {
    function withRetract() {
        const retracted: string[] = [];
        const t = setup();
        const voice: SpeechVoice = {
            say: (_space, segmentId, text, maxMs) => (t.said.push({ segmentId, text, maxMs }), true),
            hasAudience: () => true,
            someoneSpeaking: () => false,
            lastSpokenToAt: () => 0,
            retract: (_space, segmentId) => void retracted.push(segmentId),
        };
        const speech = new BotSpeech(voice, DEFAULT_REPLY_LIMITS, t.now);
        const over: number[] = [];
        speech.onOver = (_space, person) => void over.push(person);
        return { speech, said: t.said, retracted, over };
    }

    it('stops what is playing for them, and its end does not open their window again', () => {
        const t = withRetract();
        t.speech.final(SPACE, reply(1, 7), 'Here is my answer to Khalid.');
        t.speech.endFor(SPACE, 7);
        expect(t.retracted).toEqual(['s1']);
        expect(t.speech.isSpeakingTo(7)).toBe(false);
        t.speech.played('s1');
        expect(t.over).toEqual([]);
    });

    it('leaves what is playing for someone else alone', () => {
        const t = withRetract();
        t.speech.final(SPACE, reply(1, 7), 'To Khalid.');
        t.speech.final(SPACE, reply(2, 8), 'To Sara.');
        t.speech.endFor(SPACE, 7);
        expect(t.retracted).toEqual(['s1']);
        expect(t.speech.isSpeakingTo(8)).toBe(true);
        t.speech.played('s2');
        expect(t.over).toEqual([8]);
    });
});
