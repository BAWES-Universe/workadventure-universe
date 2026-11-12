/** "What do you remember about me?" and "forget that", said in a direct message (game #2003). */
import { describe, it, expect, vi } from 'vitest';
import { ConversationMemory } from '../memory/ConversationMemory';
import { heardInDm } from '../memory/Heard';
import { memoryItemKey, memoryItemsOf } from '../memory/MemoryItems';
import { FORGET_MEMORY_TOOL, WHAT_I_REMEMBER_TOOL, isMemoryTool, itemsAbout, memoryToolDefinitions, memoryToolsNote, runMemoryTool } from '../ai/MemoryTools';
import { describeStep } from '../ai/ToolSteps';

function sara() {
    const memory = new ConversationMemory();
    memory.useHeard(() => heardInDm());
    memory.addMessage('bot', 1, 'call me Sara', 'person', 'dm');
    memory.addMessage('bot', 1, 'I love coffee, no sugar', 'person', 'dm');
    memory.addMessage('bot', 1, 'my birthday is June 5', 'person', 'dm');
    memory.addMessage('bot', 1, "I'm tired", 'person', 'dm');
    return memory.getMemory('bot', 1)!;
}

describe('the memory tools', () => {
    it('are two, and named so the chat can tell them from other tools', () => {
        expect(memoryToolDefinitions().map((tool) => tool.function.name)).toEqual([WHAT_I_REMEMBER_TOOL, FORGET_MEMORY_TOOL]);
        expect(isMemoryTool('forget_memory') && isMemoryTool('what_i_remember')).toBe(true);
        expect(isMemoryTool('make_brick')).toBe(false);
        expect(memoryToolsNote()).toContain('forget_memory');
    });

    it('tell the person what is remembered, in words, with a key for each', async () => {
        const answer = (await runMemoryTool(WHAT_I_REMEMBER_TOOL, {}, { memory: sara(), forget: vi.fn() })) as { things: { id: string; what: string }[] };
        expect(answer.things.map((thing) => thing.what).sort()).toEqual(['Their birthday is June 5', 'Their name is Sara', 'They like coffee, no sugar', 'They said they were tired']);
        expect(answer.things.find((thing) => thing.what.includes('Sara'))?.id).toBe(memoryItemKey('name', null, 'Sara'));
    });

    it('say so when nothing is remembered', async () => {
        const empty = new ConversationMemory().getOrCreateMemory('bot', 2);
        const answer = (await runMemoryTool(WHAT_I_REMEMBER_TOOL, {}, { memory: empty, forget: vi.fn() })) as { things: unknown[]; note: string };
        expect(answer.things).toEqual([]);
        expect(answer.note).toContain('nothing');
    });

    it('forget what the words are about, and say what went', async () => {
        const memory = sara();
        const forget = vi.fn(async () => 1);
        const answer = (await runMemoryTool(FORGET_MEMORY_TOOL, { about: 'that I like coffee' }, { memory, forget })) as { forgotten: string[] };
        expect(answer.forgotten).toEqual(['They like coffee, no sugar']);
        const [keys, kinds] = forget.mock.calls[0] as unknown as [Set<string>, Map<string, string>];
        expect([...keys]).toEqual([memoryItemKey('pref', null, 'coffee, no sugar')]);
        expect([...kinds.values()]).toEqual(['pref']);
    });

    it('forget by key when the model knows which', async () => {
        const memory = sara();
        const forget = vi.fn(async () => 1);
        await runMemoryTool(FORGET_MEMORY_TOOL, { ids: [memoryItemKey('name', null, 'Sara')] }, { memory, forget });
        expect([...(forget.mock.calls[0] as unknown as [Set<string>])[0]]).toEqual([memoryItemKey('name', null, 'Sara')]);
    });

    it('forget nothing for words that are about nothing it remembers, and never guess', async () => {
        const forget = vi.fn();
        const answer = (await runMemoryTool(FORGET_MEMORY_TOOL, { about: 'my cat' }, { memory: sara(), forget })) as { forgotten: string[] };
        expect(answer.forgotten).toEqual([]);
        expect(forget).not.toHaveBeenCalled();
        expect(await runMemoryTool(FORGET_MEMORY_TOOL, {}, { memory: sara(), forget })).toHaveProperty('error');
    });

    it('find a name or a birthday by what it is, not only by its words', () => {
        const items = memoryItemsOf(sara());
        expect(itemsAbout(items, 'my name').map((item) => item.kind)).toEqual(['name']);
        expect(itemsAbout(items, "when's my birthday").map((item) => item.kind)).toEqual(['birthday']);
        expect(itemsAbout(items, '')).toEqual([]);
    });

    it("never takes the person's own name or birthday for someone else's", () => {
        const items = memoryItemsOf(sara());
        for (const other of ["my dog's name", "my friend's birthday", 'her birthday', "Sam's name", 'their name', 'my dog name']) {
            expect(itemsAbout(items, other).map((item) => item.kind), other).not.toContain(other.includes('birthday') ? 'birthday' : 'name');
        }
        expect(itemsAbout(items, 'the name I gave you').map((item) => item.kind)).toEqual(['name']);
        expect(itemsAbout(items, "my name and my dog's name").map((item) => item.kind)).toEqual(['name']);
    });

    it('never matches on short or common words, because forgetting is for good', () => {
        const items = memoryItemsOf(sara());
        for (const vague of ['i', 'it', 'a', 'the', 'that', 'the thing I said about my cat', 'what I said', 'all of that', 'everything']) {
            expect(itemsAbout(items, vague), vague).toEqual([]);
        }
        // Not a piece of a longer word either
        expect(itemsAbout(items, 'cof')).toEqual([]);
        expect(itemsAbout(items, 'tire')).toEqual([]);
        // Common words next to a real one still find only the real one
        expect(itemsAbout(items, 'the thing I said about the coffee').map((item) => item.kind)).toEqual(['pref']);
    });

    it('still finds a thing said back whole, or by its one meaningful word', () => {
        const items = memoryItemsOf(sara());
        expect(itemsAbout(items, 'coffee, no sugar').map((item) => item.kind)).toEqual(['pref']);
        expect(itemsAbout(items, 'forget that I am tired').map((item) => item.kind)).toEqual(['fact']);
    });

    it('answer plainly when forgetting fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const answer = await runMemoryTool(FORGET_MEMORY_TOOL, { about: 'coffee' }, { memory: sara(), forget: async () => Promise.reject(new Error('down')) });
        expect(answer).toHaveProperty('error');
    });

    it('show as one step, "Forgot", with their own words under it', () => {
        const step = describeStep({ id: '1', name: FORGET_MEMORY_TOOL, arguments: JSON.stringify({ about: 'coffee' }) });
        expect(step).toMatchObject({ doing: 'Forgetting', done: 'Forgot', detail: 'coffee' });
    });
});
