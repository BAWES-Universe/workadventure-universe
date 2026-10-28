import { describe, expect, it } from 'vitest';
import { charsToFree, contextNumbersOf, StepRoom, saysTooLong, stepMessages, stepOf, stepsAsText, tooLongOf, withStepsAsText, type ReplyStep } from '../ai/replySteps';

/**
 * A reply keeps its own steps (#1508): each round of tool calls goes back to the model as chat messages, within
 * "Room for tool results in one reply", and a model that turns them down for length gets them smaller.
 */

const step = (round: number, text: string, reasoning?: string): ReplyStep =>
    stepOf(round, `round ${round}`, [{ id: `call_${round}`, name: 'read_web_page', arguments: '{"url":"x"}' }], [{ id: `call_${round}`, name: 'read_web_page', text }], reasoning);

describe('a step', () => {
    it('pairs each call that ran with what it gave back, and gives an id to a call without one', () => {
        const made = stepOf(
            2,
            'Let me look.',
            [
                { id: '', name: 'get_bot_position', arguments: '' },
                { id: 'x', name: '', arguments: '{}' },
                { id: 'call_b', name: 'get_areas_on_map', arguments: '{}' },
            ],
            [
                { id: '', name: 'get_bot_position', text: 'get_bot_position: x: 1, y: 2' },
                { id: 'call_b', name: 'get_areas_on_map', text: 'get_areas_on_map: Library' },
            ]
        );
        expect(made.calls).toEqual([
            { id: 'call_2_0', name: 'get_bot_position', arguments: '{}' },
            { id: 'call_b', name: 'get_areas_on_map', arguments: '{}' },
        ]);
        expect(made.results.map((result) => result.id)).toEqual(['call_2_0', 'call_b']);
        expect(made).not.toHaveProperty('reasoning');
    });

    it('goes to the model as what it said and called, then each result, then how to carry on', () => {
        const steps = { steps: [step(1, 'page one', 'I should read it')], after: 'Carry on.' };
        expect(stepMessages(steps)).toEqual([
            { role: 'assistant', content: 'round 1', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_web_page', arguments: '{"url":"x"}' } }] },
            { role: 'tool', tool_call_id: 'call_1', content: 'page one' },
            { role: 'user', content: 'Carry on.' },
        ]);
        // A thinking model gets its reasoning back, only when its provider sent it
        expect(stepMessages(steps, { reasoning: true })[0]).toMatchObject({ reasoning_content: 'I should read it' });
        expect(stepMessages({ steps: [step(1, 'page one')] }, { reasoning: true })[0]).not.toHaveProperty('reasoning_content');
        expect(stepMessages(undefined)).toEqual([]);
    });

    it('sends back only arguments a provider takes: repaired when the stream cut them, else an empty object', () => {
        const callWith = (args: string) => stepOf(1, '', [{ id: 'c', name: 'make_artifact', arguments: args }], [{ id: 'c', name: 'make_artifact', text: 'saved' }]).calls[0]!.arguments;
        expect(callWith('{"title":"Plan","html":"<p>hi')).toBe(JSON.stringify({ title: 'Plan', html: '<p>hi' }));
        expect(callWith('{"title":"Plan"}')).toBe('{"title":"Plan"}');
        expect(callWith('not json at all')).toBe('{}');
        expect(callWith('[1, 2]')).toBe('{}');
        expect(callWith('')).toBe('{}');
    });

    it('can be read as text by a call that takes one message', () => {
        const steps = [step(1, 'page one'), step(2, 'page two')];
        expect(stepsAsText(steps)).toBe('=== Step 1 ===\npage one\n\n=== Step 2 ===\npage two');
        expect(withStepsAsText('hello', { steps, after: 'Carry on.' })).toBe('hello\n\n=== Step 1 ===\npage one\n\n=== Step 2 ===\npage two\n\nCarry on.');
        expect(withStepsAsText('hello', undefined)).toBe('hello');
    });
});

describe('a call turned down for length', () => {
    it('is told apart from other errors', () => {
        expect(saysTooLong("OpenAI API error: 400 This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.")).toBe(true);
        expect(saysTooLong('LMStudio API error: 400 The number of tokens to keep from the initial prompt is greater than the context length.')).toBe(true);
        expect(saysTooLong('OpenAI API error: 400 {"error":{"code":"context_length_exceeded"}}')).toBe(true);
        expect(saysTooLong('OpenAI API error: 401 Invalid API key')).toBe(false);
        expect(saysTooLong('OpenAI API error: 429 Rate limit reached')).toBe(false);
    });

    it('says how far over it went when the error gives the numbers', () => {
        expect(contextNumbersOf("This model's maximum context length is 131072 tokens. However, you requested 140,000 tokens (108000 in the messages, 32000 in the completion).")).toEqual({ limit: 131072, asked: 140000 });
        expect(contextNumbersOf("maximum context length is 8192 tokens. However, your messages resulted in 9100 tokens.")).toEqual({ limit: 8192, asked: 9100 });
        expect(contextNumbersOf('Trying to keep the first 9000 tokens when context the overflows. However, the model is loaded with context length of only 8192 tokens')).toEqual({ limit: 8192, asked: 9000 });
        expect(contextNumbersOf('prompt is too long: 210000 tokens > 200000 maximum')).toEqual({ limit: 200000, asked: 210000 });
        expect(contextNumbersOf('The number of tokens to keep from the initial prompt is greater than the context length.')).toBeUndefined();
        expect(tooLongOf('401 Invalid API key')).toEqual({});
        expect(tooLongOf('prompt is too long: 210000 tokens > 200000 maximum')).toEqual({ tooLong: true, context: { limit: 200000, asked: 210000 } });
        // 10% over, at 4 characters a token, with a fifth more for the guess
        expect(charsToFree({ limit: 9000, asked: 10000 }, 40000)).toBe(4800);
        expect(charsToFree(undefined, 40000)).toBeUndefined();
    });
});

describe("a reply's room for tool results", () => {
    it('keeps every step whole while they fit', () => {
        const room = new StepRoom(100);
        room.add(step(1, 'a'.repeat(40)));
        room.add(step(2, 'b'.repeat(40)));
        expect(room.steps.map((s) => s.results[0]!.content)).toEqual(['a'.repeat(40), 'b'.repeat(40)]);
    });

    it('sets the older results aside, once, when a step would pass it, and keeps adding', () => {
        const room = new StepRoom(300);
        room.add(step(1, 'a'.repeat(200)));
        room.add(step(2, 'b'.repeat(200)));
        expect(room.steps[0]!.results[0]!.content).toBe('[read_web_page: 200 characters, set aside to make room. Call it again if you need it.]');
        expect(room.steps[1]!.results[0]!.content).toBe('b'.repeat(200));
        room.add(step(3, 'c'.repeat(200)));
        // Set aside once: the first line stays as it was
        expect(room.steps[0]!.results[0]!.content).toBe('[read_web_page: 200 characters, set aside to make room. Call it again if you need it.]');
        expect(room.steps[1]!.results[0]!.content).toContain('200 characters, set aside');
        expect(room.steps).toHaveLength(3);
    });

    it('leaves a result shorter than its set-aside line as it is, and stops when nothing gets smaller', () => {
        const room = new StepRoom(100_000);
        room.add(step(1, 'short'));
        room.add(step(2, 'tiny'));
        // Cutting these would only add a note: nothing gets smaller, so the model is not asked again
        expect(room.makeRoom()).toBe(false);
        expect(room.makeRoom(50)).toBe(false);
        expect(room.steps.map((s) => s.results[0]!.content)).toEqual(['short', 'tiny']);
    });

    it('counts the note a cut adds, so a small overage still frees what was asked in one go', () => {
        const room = new StepRoom(100_000);
        room.add(step(1, 'b'.repeat(4000)));
        const before = room.size();
        expect(room.makeRoom(50)).toBe(true);
        expect(room.size()).toBeLessThanOrEqual(before - 50);
    });

    it('keeps as much of one step larger than the room as fits, and says so', () => {
        const room = new StepRoom(1000);
        room.add(step(1, 'a'.repeat(1500)));
        expect(room.steps[0]!.results[0]!.content).toBe(
            `${'a'.repeat(1000)}\n[Only the first 1,000 of 1,500 characters fit in this reply's room for tool results ("Room for tool results in one reply").]`
        );
    });

    it('makes room when the model turns the steps down: older results first, then half of the newest, until nothing is left to cut', () => {
        const room = new StepRoom(100_000);
        room.add(step(1, 'a'.repeat(400)));
        room.add(step(2, 'b'.repeat(400)));
        expect(room.makeRoom()).toBe(true);
        expect(room.steps[0]!.results[0]!.content).toContain('400 characters, set aside');
        expect(room.steps[1]!.results[0]!.content).toBe('b'.repeat(400));
        expect(room.makeRoom()).toBe(true);
        expect(room.steps[1]!.results[0]!.content).toMatch(/^b{200}\n\[Only the first 200 of 400 characters fit/);
        // Cutting again cuts the text, never its note, and ends
        let rounds = 0;
        while (room.makeRoom()) rounds++;
        expect(rounds).toBeLessThan(10);
        expect(room.steps[1]!.results[0]!.content).toMatch(/^b{1,9}\n\[Only the first \d of 400 characters fit/);
    });

    it('cuts by how far over it went when the error said, settling in one go', () => {
        const room = new StepRoom(100_000);
        room.add(step(1, 'a'.repeat(400)));
        room.add(step(2, 'b'.repeat(4000)));
        // Setting the older one aside frees too little, so the newest gives up the rest
        expect(room.makeRoom(1000)).toBe(true);
        expect(room.steps[0]!.results[0]!.content).toContain('400 characters, set aside');
        expect(room.steps[1]!.results[0]!.content).toMatch(/^b+\n\[Only the first 3,\d{3} of 4,000 characters fit/);
        expect(room.size()).toBeLessThan(4400 - 1000 + 300);
        // More than the steps hold: as small as they go, once, then nothing is left to cut
        expect(room.makeRoom(1_000_000)).toBe(true);
        expect(room.steps[1]!.results[0]!.content).toMatch(/^b\n\[Only the first 1 of 4,000/);
        expect(room.makeRoom(1_000_000)).toBe(false);
    });

    it('never cuts half an emoji', () => {
        const room = new StepRoom(3);
        room.add(step(1, 'ab😀cd'));
        expect(room.steps[0]!.results[0]!.content.startsWith('ab\n[Only the first 2 of 6')).toBe(true);
    });
});

describe('what a call was made with', () => {
    const made = (round: number, html: string, result = 'Saved the artifact "Plan".'): ReplyStep =>
        stepOf(round, '', [{ id: `c${round}`, name: 'make_artifact', arguments: JSON.stringify({ title: 'Plan', html }) }], [{ id: `c${round}`, name: 'make_artifact', text: result }]);

    it('counts in the room, and an older page is set aside to a line while the call still says what it did', () => {
        const room = new StepRoom(5000);
        room.add(made(1, 'x'.repeat(4000)));
        expect(room.size()).toBeGreaterThan(4000);
        room.add(made(2, 'y'.repeat(2000)));
        const older = JSON.parse(room.steps[0]!.calls[0]!.arguments);
        expect(older).toEqual({ title: 'Plan', html: '[4,000 characters, set aside to make room]' });
        // What it gave back is short, so it stays
        expect(room.steps[0]!.results[0]!.content).toBe('Saved the artifact "Plan".');
        expect(room.size()).toBeLessThan(5000);
    });

    it('sets the newest page aside before its results when the model turns the steps down for length', () => {
        const room = new StepRoom(100_000);
        room.add(made(1, 'z'.repeat(20_000), 'r'.repeat(3000)));
        const before = room.size();
        expect(room.makeRoom(5000)).toBe(true);
        expect(room.size()).toBeLessThanOrEqual(before - 5000);
        expect(JSON.parse(room.steps[0]!.calls[0]!.arguments).html).toBe('[20,000 characters, set aside to make room]');
        // Its results, which it still needs, are whole
        expect(room.steps[0]!.results[0]!.content).toBe('r'.repeat(3000));
    });
});
