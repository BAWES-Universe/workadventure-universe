/**
 * What a person is told when voice or an App step pauses (billing consensus v2, P3; Budget page mock, "What people see in the game").
 * Each of the five reasons has its own words, and only the person's own allowance has a date and a way to ask for more.
 */
import { describe, expect, it } from 'vitest';
import { ASKED_LINE, GIVEN_LINE, appStopResult, askMoreCard, backWhen, canAskForMore, dayWords, readAppStop, stopLine, stopQuestion } from '../voice/StopLines';

const NOW = Date.parse('2026-11-18T10:00:00Z');
const NEXT_MONTH = '2026-12-01T00:00:00Z';

describe('stopLine', () => {
    it('tells a person their own voice time is used up, with the day it comes back and Ask for more waiting under it', () => {
        expect(stopLine({ by: 'person', what: 'reply', resetsAt: NEXT_MONTH }, NOW)).toBe("I'll answer in text: you've used this month's voice time. It comes back on 1 Dec.");
        expect(stopLine({ by: 'person', what: 'hearing', resetsAt: NEXT_MONTH }, NOW)).toContain('on 1 Dec');
    });

    it('says hours, not a month, when the allowance is a window of hours, and says no date when none was given', () => {
        expect(stopLine({ by: 'person', what: 'reply', resetsAt: '2026-11-18T13:10:00Z' }, NOW)).toBe("I'll answer in text: you've used your voice time for now. It comes back in about 3 hours.");
        expect(stopLine({ by: 'person', what: 'reply' }, NOW)).toBe("I'll answer in text: you've used your voice time for now.");
    });

    it('gives the platform and a provider the same neutral line: no date, no number, no company, no blame', () => {
        for (const by of ['budget', 'provider'] as const) {
            const line = stopLine({ by, what: 'reply', resetsAt: NEXT_MONTH }, NOW)!;
            expect(line).toBe("Voice replies are paused for now, so I'll answer in text.");
            expect(line).not.toMatch(/Dec|month|\$|\d/);
        }
    });

    it('says nothing for a hold (it passes by itself) and "busy" for capacity', () => {
        expect(stopLine({ by: 'hold', what: 'reply' }, NOW)).toBeNull();
        expect(stopLine({ by: 'hold', what: 'hearing' }, NOW)).toBeNull();
        expect(stopLine({ by: 'capacity', what: 'reply' }, NOW)).toBe("Voice is busy for a moment, so I'll answer in text this time.");
    });

    describe('a voice note', () => {
        it('says whether it was read before it was turned down', () => {
            expect(stopLine({ by: 'budget', what: 'note', transcribed: true }, NOW)).toMatch(/^I read your voice message but I can't answer it: voice is paused for now\./);
            expect(stopLine({ by: 'budget', what: 'note', transcribed: false }, NOW)).toMatch(/^I couldn't listen to your voice message: voice is paused for now\./);
        });
        it('asks them to type it, and says everything else works', () => {
            expect(stopLine({ by: 'person', what: 'note', resetsAt: NEXT_MONTH }, NOW)).toBe(
                "I couldn't listen to your voice message: you've used this month's voice time. It comes back on 1 Dec. Could you type it? Everything else works as usual."
            );
        });
        it('asks to send it again when it is a hold or capacity (waiting helps)', () => {
            expect(stopLine({ by: 'hold', what: 'note' }, NOW)).toMatch(/send it again in a moment, or type it\?$/);
            expect(stopLine({ by: 'capacity', what: 'note' }, NOW)).toMatch(/voice is busy\. Could you send it again in a moment, or type it\?$/);
        });
    });

    describe('an App step', () => {
        it('tells the person their own App use is used up and offers to ask the Universe team', () => {
            expect(stopLine({ by: 'person', what: 'app', doing: 'add it to Notion', resetsAt: NEXT_MONTH }, NOW)).toBe(
                "I can't add it to Notion right now: this month's App use is used up. It comes back on 1 Dec. I can ask the Universe team for more."
            );
        });
        it('says "Nothing you need to do" for a platform or provider pause, and never a date', () => {
            for (const by of ['budget', 'provider'] as const) {
                expect(stopLine({ by, what: 'app', resetsAt: NEXT_MONTH }, NOW)).toBe("Apps are paused for now, so I can't do that right now. Nothing you need to do.");
            }
        });
        it('says nothing for a hold, and busy for capacity', () => {
            expect(stopLine({ by: 'hold', what: 'app' }, NOW)).toBeNull();
            expect(stopLine({ by: 'capacity', what: 'app' }, NOW)).toMatch(/Apps are busy for a moment/);
        });
    });

    it('never names a company, a price or a balance, in any line', () => {
        for (const by of ['person', 'budget', 'provider', 'capacity', 'hold'] as const) {
            for (const what of ['reply', 'hearing', 'note', 'app'] as const) {
                const line = stopLine({ by, what, resetsAt: NEXT_MONTH, transcribed: true }, NOW);
                if (line) expect(line).not.toMatch(/\$|dollar|price|balance|ElevenLabs|Deepgram|OpenAI|Soniox|Composio|Agent37|budget/i);
            }
        }
    });
});

describe('backWhen and dayWords', () => {
    it('names the day in UTC for a month away and hours for a window', () => {
        expect(dayWords(NEXT_MONTH)).toBe('1 Dec');
        expect(backWhen(NEXT_MONTH, NOW)).toBe('on 1 Dec');
        expect(backWhen('2026-11-18T10:20:00Z', NOW)).toBe('in about an hour');
        expect(backWhen('2026-11-18T09:00:00Z', NOW)).toBe('in a moment');
        expect(backWhen(undefined, NOW)).toBeNull();
        expect(backWhen('not a time', NOW)).toBeNull();
    });
});

describe('askMoreCard', () => {
    it('is a card under only the person\'s own stop, with Ask for more and Text is fine', () => {
        const card = askMoreCard({ by: 'person', what: 'reply', resetsAt: NEXT_MONTH }, NOW)!;
        expect(card.question).toBe('Voice time is used up');
        expect(card.choices.map((c) => c.label)).toEqual(['Ask for more', 'Text is fine']);
        expect(card.choices[0].action).toEqual({ kind: 'ask-for-more', category: 'speech' });
        expect(card.choices[1].action).toMatchObject({ kind: 'dismiss' });
    });
    it('has no card for any other reason', () => {
        for (const by of ['budget', 'provider', 'hold', 'capacity'] as const) expect(askMoreCard({ by, what: 'reply' }, NOW)).toBeNull();
        expect(canAskForMore('person')).toBe(true);
        expect(canAskForMore('budget')).toBe(false);
    });
    it('asks for Apps when it was an App step', () => {
        const card = askMoreCard({ by: 'person', what: 'app', resetsAt: NEXT_MONTH }, NOW)!;
        expect(card.question).toBe('App use is used up');
        expect(card.choices[0].action).toEqual({ kind: 'ask-for-more', category: 'apps' });
        expect(card.choices[1].label).toBe('Wait until it comes back');
    });
    it('fits the question card: two to four choices, short labels, its own ids', () => {
        const asked = stopQuestion(askMoreCard({ by: 'person', what: 'reply' }, NOW)!);
        expect(asked.choices.map((c) => c.id)).toEqual(['c1', 'c2']);
        expect(asked.multiple).toBe(false);
        for (const choice of asked.choices) {
            expect(choice.label.length).toBeLessThanOrEqual(60);
            expect((choice.line ?? '').length).toBeLessThanOrEqual(100);
        }
    });
    it('has the lines said once the ask went to Orbit and once it was added', () => {
        expect(ASKED_LINE).toBe("Asked. I'll tell you the moment it's added.");
        expect(GIVEN_LINE).toMatch(/^Good news/);
    });
});

describe('an App step Orbit held back', () => {
    it('reads only the five reasons, and a date only for the person\'s own allowance', () => {
        expect(readAppStop({ 'universe/stop': { by: 'person', resetsAt: NEXT_MONTH, canAskForMore: true } })).toEqual({ by: 'person', resetsAt: NEXT_MONTH, canAskForMore: true });
        expect(readAppStop({ 'universe/stop': { by: 'budget', resetsAt: NEXT_MONTH, canAskForMore: true } })).toEqual({ by: 'budget', canAskForMore: false });
        expect(readAppStop({ 'universe/stop': { by: 'somebody' } })).toBeNull();
        expect(readAppStop({ 'universe/stop': 'person' })).toBeNull();
        expect(readAppStop(undefined)).toBeNull();
        expect(readAppStop({})).toBeNull();
    });
    it('tells the model the line to say and that nothing was done', () => {
        const result = appStopResult({ by: 'budget', canAskForMore: false }, NOW);
        expect(result).toMatchObject({ error: "Apps are paused for now, so I can't do that right now. Nothing you need to do.", outcome: 'not_sent', stopped: { by: 'budget', canAskForMore: false } });
        expect(String(result.hint)).toContain('never suggest asking for more');
    });
    it('names the card for the person\'s own allowance so the model does not list its choices', () => {
        const result = appStopResult({ by: 'person', resetsAt: NEXT_MONTH, canAskForMore: true }, NOW);
        expect(String(result.error)).toContain('on 1 Dec');
        expect(String(result.hint)).toContain('A card under it lets them ask for more');
    });
    it('tells the model to say nothing and try once more for a hold', () => {
        const result = appStopResult({ by: 'hold', canAskForMore: false }, NOW);
        expect(result.outcome).toBe('not_sent');
        expect(String(result.hint)).toContain('say nothing');
    });
});
