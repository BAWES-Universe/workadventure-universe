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
        // Unusual wording is not clearly theirs: nothing goes, and the tool sends the model to the ids
        expect(itemsAbout(items, 'the name I gave you').map((item) => item.kind)).toEqual([]);
        for (const own of ['my name', 'name', 'forget my name now', 'forget that my name is Sara', 'when is my birthday']) {
            expect(itemsAbout(items, own).map((item) => item.kind), own).toEqual([own.includes('birthday') ? 'birthday' : 'name']);
        }
        for (const other of ['the name of my dog', "my dog's name", 'her birthday', 'the name I gave my cat', 'my birthday cake', 'birthday party for Sam']) {
            expect(itemsAbout(items, other).map((item) => item.kind), other).not.toContain(other.includes('birthday') ? 'birthday' : 'name');
        }
        // Time and polite words after it do not make it someone else's: a person asking to be forgotten is not refused
        for (const own of ['forget my name now', 'forget my name again', 'forget my name please', 'forget my name, thanks']) {
            expect(itemsAbout(items, own).map((item) => item.kind), own).toEqual(['name']);
        }
        for (const own of ['forget my birthday please', 'forget my birthday today', 'forget my birthday again, thanks']) {
            expect(itemsAbout(items, own).map((item) => item.kind), own).toEqual(['birthday']);
        }
        // Mixed with someone else's, it is not clearly theirs: nothing goes
        expect(itemsAbout(items, "my name and my dog's name").map((item) => item.kind)).toEqual([]);
        expect(itemsAbout(items, 'my name and my birthday').map((item) => item.kind)).toEqual(['name', 'birthday']);
    });

    it("does not take the person's own name or birthday because other words hold its value", () => {
        const name = (value: string) => ({ id: 'n', kind: 'name', label: null, value }) as any;
        const birthday = (value: string) => ({ id: 'b', kind: 'birthday', label: null, value }) as any;
        const kinds = (items: any[], about: string) => itemsAbout(items, about).map((item) => item.kind);
        // The person is Mark and Sam's birthday is someone else's: forgetting is for good
        const mark = [name('Mark'), birthday('12 June'), { id: 'p', kind: 'pref', label: null, value: 'coffee' }] as any[];
        expect(kinds(mark, 'my friend Mark')).toEqual([]);
        expect(kinds(mark, "Mark's birthday")).not.toContain('name');
        expect(kinds(mark, 'forget that my sister Mark likes tea')).not.toContain('name');
        expect(kinds(mark, 'my name')).toEqual(['name']);
        expect(kinds(mark, 'forget that my name is Mark')).toEqual(['name']);
        expect(kinds(mark, 'the party on 12 June')).not.toContain('birthday');
        expect(kinds(mark, 'my birthday')).toEqual(['birthday']);
        expect(kinds(mark, 'forget June')).not.toContain('birthday');
        // Someone else's named after the word, not before it
        for (const other of ['the name of my dog', 'the birthday of my friend', 'the name for my cat', "the birthday of Sam"]) {
            expect(kinds(mark, other), other).toEqual([]);
        }
        expect(kinds(mark, 'the name of me')).toEqual(['name']);
        expect(kinds(mark, 'the birthday of mine')).toEqual(['birthday']);
        // A normal thing still matches by its words
        expect(kinds(mark, 'coffee')).toEqual(['pref']);
        const sam = [name('Sam'), birthday('June 5')];
        expect(kinds(sam, "Sam's birthday")).not.toContain('name');
        expect(kinds(sam, "Sam's birthday")).not.toContain('birthday');
    });

    it('does not let the word "birthday" or "name" pick out another thing that shares it', () => {
        const items: any[] = [
            ...memoryItemsOf(sara()),
            { id: 'cake', kind: 'pref', label: null, value: 'birthday cake' },
            { id: 'tag', kind: 'fact', label: 'badge', value: 'name tag' },
        ];
        // "my birthday" is the birthday, and not the cake that shares its word
        expect(itemsAbout(items, 'my birthday').map((item) => item.id)).toEqual(items.filter((item) => item.kind === 'birthday').map((item) => item.id));
        expect(itemsAbout(items, 'my name').map((item) => item.id)).toEqual(items.filter((item) => item.kind === 'name').map((item) => item.id));
        // "my birthday cake" is the cake, and not the birthday
        expect(itemsAbout(items, 'my birthday cake').map((item) => item.id)).toEqual(['cake']);
    });

    it('needs all that was asked to be part of the thing, or all of the thing to be said, not one shared word', () => {
        const items: any[] = [
            { id: 'place', kind: 'pref', label: null, value: 'pizza' },
            { id: 'dough', kind: 'pref', label: null, value: 'pizza dough recipe' },
            { id: 'coffee', kind: 'pref', label: null, value: 'coffee, no sugar' },
        ];
        // The false match: only "pizza" is shared with the dough recipe
        expect(itemsAbout(items, 'my favourite pizza place').map((item) => item.id)).toEqual(['place']);
        // What must still work: the whole thing said back among other words, a part of it, and a part of a longer one
        expect(itemsAbout(items, 'forget that I like pizza').map((item) => item.id)).toEqual(['place']);
        expect(itemsAbout(items, 'the dough recipe').map((item) => item.id)).toEqual(['dough']);
        expect(itemsAbout(items, 'the coffee').map((item) => item.id)).toEqual(['coffee']);
        expect(itemsAbout(items, 'the thing about my pizza dough recipe').map((item) => item.id)).toEqual(['dough']);
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
