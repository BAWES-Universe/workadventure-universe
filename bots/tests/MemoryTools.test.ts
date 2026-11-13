/** "What do you remember about me?" and "forget that", said in a direct message (game #2003). */
import { describe, it, expect, vi } from 'vitest';
import { ConversationMemory } from '../memory/ConversationMemory';
import { heardInDm } from '../memory/Heard';
import { memoryItemKey, memoryItemsOf } from '../memory/MemoryItems';
import { FORGET_MEMORY_TOOL, WHAT_I_REMEMBER_TOOL, isMemoryTool, itemsAbout, resolveForgetting, memoryToolDefinitions, memoryToolsNote, runMemoryTool } from '../ai/MemoryTools';
import { describeStep, resultOf } from '../ai/ToolSteps';

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
        expect(itemsAbout(items, 'forget my birthday').map((item) => item.kind)).toEqual(['birthday']);
        // Asking for it told is not asking for it forgotten
        expect(itemsAbout(items, "when's my birthday")).toEqual([]);
        expect(itemsAbout(items, '')).toEqual([]);
    });

    it("never takes the person's own name or birthday for someone else's", () => {
        const items = memoryItemsOf(sara());
        for (const other of ["my dog's name", "my friend's birthday", 'her birthday', "Sam's name", 'their name', 'my dog name']) {
            expect(itemsAbout(items, other).map((item) => item.kind), other).not.toContain(other.includes('birthday') ? 'birthday' : 'name');
        }
        // Unusual wording is not clearly theirs: nothing goes, and the tool sends the model to the ids
        expect(itemsAbout(items, 'the name I gave you').map((item) => item.kind)).toEqual([]);
        for (const own of ['my name', 'name', 'forget everything about my name', 'forget my name now', 'forget that my name is Sara', 'can you forget my name', 'could you please forget my birthday', 'will you forget my name', 'delete my birthday']) {
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
        // A pizza place and liking pizza are different memories: one shared word takes neither
        expect(itemsAbout(items, 'my favourite pizza place').map((item) => item.id)).toEqual([]);
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

const thing = (kind: string, value: string, label: string | null = null, id = `${kind}:${label ?? ''}:${value}`) => ({ id, kind, label, value, at: null, private: true }) as any;
const ids = (found: any[]) => found.map((item) => item.id);

describe('forgetting that keeps kind, label, owner, "not" and what is said to keep (GPT B1)', () => {
    it('keeps a fact with another label when the words name one', () => {
        const items = [thing('fact', 'Paris', 'home_city'), thing('fact', 'Paris', 'next_trip')];
        expect(ids(itemsAbout(items, 'forget my next trip to Paris'))).toEqual(['fact:next_trip:Paris']);
        expect(ids(itemsAbout(items, 'my home city'))).toEqual(['fact:home_city:Paris']);
        // Only the value, and two things hold it: nothing goes, and both are offered
        expect(itemsAbout(items, 'Paris')).toEqual([]);
        expect(ids(resolveForgetting(items, 'Paris').unsure).sort()).toEqual(['fact:home_city:Paris', 'fact:next_trip:Paris']);
    });

    it("never takes the person's own thing for somebody else's", () => {
        const items = [thing('pref', 'coffee'), thing('pref', 'tea')];
        for (const other of ['forget that my sister likes coffee', "my friend's coffee", 'he likes coffee', 'forget that they love coffee']) {
            expect(itemsAbout(items, other), other).toEqual([]);
        }
        expect(ids(itemsAbout(items, 'forget that I like coffee'))).toEqual(['pref::coffee']);
    });

    it('keeps what is said to be kept', () => {
        const items = [thing('pref', 'coffee'), thing('pref', 'tea')];
        expect(ids(itemsAbout(items, 'forget coffee but not tea'))).toEqual(['pref::coffee']);
        expect(ids(itemsAbout(items, 'forget coffee, not tea'))).toEqual(['pref::coffee']);
        expect(ids(itemsAbout(items, 'forget coffee except tea'))).toEqual(['pref::coffee']);
        expect(ids(itemsAbout(items, 'forget coffee and tea')).sort()).toEqual(['pref::coffee', 'pref::tea']);
        const named = [thing('name', 'Mark'), thing('birthday', '12 June')];
        expect(ids(itemsAbout(named, 'forget my name and remember my birthday'))).toEqual(['name::Mark']);
        expect(ids(itemsAbout(named, 'forget my name, remember my birthday'))).toEqual(['name::Mark']);
        // Two kinds with nothing between them are two requests said as one: nothing goes
        expect(itemsAbout(named, 'forget my name remember my birthday')).toEqual([]);
        // Asking to keep is never asking to forget
        for (const keep of ["don't forget my name", 'do not forget my birthday', 'remember my name', 'keep my birthday', 'never forget my name']) {
            const result = resolveForgetting(named, keep);
            expect(result.chosen, keep).toEqual([]);
            expect(result.keepOnly, keep).toBe(true);
        }
    });

    it('does not mix "tired" and "not tired"', () => {
        const items = [thing('fact', 'tired', 'current_state', 'a'), thing('fact', 'not tired', 'current_state', 'b')];
        expect(ids(itemsAbout(items, 'tired'))).toEqual(['a']);
        expect(ids(itemsAbout(items, 'forget that I am tired'))).toEqual(['a']);
        expect(ids(itemsAbout(items, 'forget that I am not tired'))).toEqual(['b']);
        // "sugar" is only what comes after "no" in "coffee, no sugar"; "coffee" is the start of it
        const coffee = [thing('pref', 'coffee, no sugar')];
        expect(ids(itemsAbout(coffee, 'sugar'))).toEqual([]);
        expect(ids(itemsAbout(coffee, 'coffee'))).toEqual(['pref::coffee, no sugar']);
    });

    it('keeps the pizza preference when the recipe or the place is asked for', () => {
        const items = [thing('pref', 'pizza'), thing('fact', 'pizza dough recipe', 'recipe')];
        expect(ids(itemsAbout(items, 'pizza dough recipe'))).toEqual(['fact:recipe:pizza dough recipe']);
        expect(ids(itemsAbout(items, 'my favourite pizza place'))).toEqual([]);
        expect(ids(itemsAbout(items, 'I like pizza'))).toEqual(['pref::pizza']);
        expect(ids(itemsAbout(items, 'the dough recipe'))).toEqual(['fact:recipe:pizza dough recipe']);
    });

    it('does not take a name because the name of someone is the stored value', () => {
        const items = [thing('name', 'Mark')];
        for (const other of ['the name of Mark', 'forget Mark', 'the name for Mark', 'my friend Mark']) expect(itemsAbout(items, other), other).toEqual([]);
        expect(ids(itemsAbout(items, 'forget that my name is Mark'))).toEqual(['name::Mark']);
    });

    it('takes natural ways of asking for a name or a birthday', () => {
        const items = [thing('name', 'Zoë Müller-O’Brien'), thing('birthday', '12 June')];
        for (const own of ['please forget my name for now', 'forget my full name', 'erase my first name', 'my name']) expect(ids(itemsAbout(items, own)), own).toEqual(['name:' + ':Zoë Müller-O’Brien']);
        for (const own of ['erase my date of birth', 'forget my bday', 'forget my b-day', 'delete my birthday please']) expect(ids(itemsAbout(items, own)), own).toEqual(['birthday::12 June']);
        // The stored name with an apostrophe, a hyphen and an accent, said after "is" in either spelling of the same letters
        expect(ids(itemsAbout(items, 'forget that my name is Zoë Müller-O’Brien'))).toEqual(['name::Zoë Müller-O’Brien']);
        expect(ids(itemsAbout(items, "forget that my name is zoë müller-o'brien"))).toEqual(['name::Zoë Müller-O’Brien']);
        expect(ids(itemsAbout(items, 'forget that my name is Zoe'))).toEqual([]);
        // Somebody else's, with the same marks
        expect(itemsAbout(items, "my dog's full name")).toEqual([]);
        expect(itemsAbout(items, "forget O’Brien's birthday")).toEqual([]);
    });
});

describe('forget_memory as the model calls it (GPT B2, B3, B4)', () => {
    const run = (args: Record<string, unknown>, forget = vi.fn(async (keys: ReadonlySet<string>) => keys.size), memory = sara()) => runMemoryTool(FORGET_MEMORY_TOOL, args, { memory, forget }).then((answer) => ({ answer: answer as any, forget }));
    const keysOf = (forget: any) => [...(forget.mock.calls[0] as [Set<string>])[0]];

    it('acts only on the ids when ids are given, and never widens them with words (B2)', async () => {
        const name = memoryItemKey('name', null, 'Sara');
        const { forget } = await run({ ids: [name], about: 'coffee' });
        expect(keysOf(forget)).toEqual([name]);
    });

    it('does not fall back to the words when an id is stale (B2)', async () => {
        const { answer, forget } = await run({ ids: ['not-a-thing'], about: 'my name' });
        expect(forget).not.toHaveBeenCalled();
        expect(answer.unclear).toBe(true);
        expect(answer.things.length).toBe(4);
        // The ones that are there still go, and the stale one is said
        const name = memoryItemKey('name', null, 'Sara');
        const mixed = await run({ ids: [name, 'stale'], about: 'coffee' });
        expect(keysOf(mixed.forget)).toEqual([name]);
        expect(mixed.answer.note).toContain('1 of the ids');
    });

    it('rejects a request too long to be weighed instead of cutting it (B3)', async () => {
        const padded = `my name${' '.repeat(200 - 'my name'.length)} and my dog's name`;
        expect(padded.length).toBeGreaterThan(200);
        const { answer, forget } = await run({ about: padded });
        expect(forget).not.toHaveBeenCalled();
        expect(answer).toMatchObject({ forgotten: [], unclear: true });
        expect(answer.note).toContain('Nothing was forgotten');
        // Words at the limit are still weighed
        const { forget: ok } = await run({ about: `my name${' '.repeat(193)}` });
        expect(ok).toHaveBeenCalledTimes(1);
    });

    it('says it has not forgotten anything yet, and offers the list, when the words settle nothing (B4)', async () => {
        const { answer, forget } = await run({ about: 'forget Sara' });
        expect(forget).not.toHaveBeenCalled();
        expect(answer).toMatchObject({ forgotten: [], unclear: true });
        expect(answer.note).toContain("I haven't forgotten anything yet. Which memory do you mean?");
        expect(answer.note).not.toContain('do not remember anything like that');
        expect(answer.things.map((one: any) => one.what).sort()).toEqual(['Their birthday is June 5', 'Their name is Sara', 'They like coffee, no sugar', 'They said they were tired']);
        // Only the ones the words could mean, when they say
        const two = new ConversationMemory();
        two.useHeard(() => heardInDm());
        two.addMessage('bot', 2, 'I love coffee, no sugar', 'person', 'dm');
        two.addMessage('bot', 2, 'I love coffee with milk', 'person', 'dm');
        two.addMessage('bot', 2, 'I love tea', 'person', 'dm');
        const asked = await run({ about: 'coffee' }, undefined, two.getMemory('bot', 2)!);
        expect(asked.forget).not.toHaveBeenCalled();
        expect(asked.answer.things.map((one: any) => one.what).sort()).toEqual(['They like coffee with milk', 'They like coffee, no sugar']);
    });

    it('says plainly that there is nothing to forget when nothing is remembered', async () => {
        const { answer, forget } = await run({ about: 'coffee' }, undefined, (() => { const empty = new ConversationMemory(); empty.useHeard(() => heardInDm()); empty.addMessage('bot', 3, 'hello', 'person', 'dm'); return empty.getMemory('bot', 3)!; })());
        expect(forget).not.toHaveBeenCalled();
        expect(answer.note).toContain('nothing');
    });

    it('does not report success when nothing went, or only some went (B4)', async () => {
        const none = await run({ about: 'my name' }, vi.fn(async () => 0));
        expect(none.answer.forgotten).toEqual([]);
        expect(none.answer.note).toContain('already gone');
        expect(none.answer.note).not.toContain('It is forgotten');
        const name = memoryItemKey('name', null, 'Sara');
        const birthday = memoryItemKey('birthday', null, 'June 5');
        const some = await run({ ids: [name, birthday] }, vi.fn(async () => 1));
        expect(some.answer.forgotten).toBeUndefined();
        expect(some.answer).toMatchObject({ count: 1, asked: 2 });
        expect(some.answer.note).toContain('do not say all of it');
        const all = await run({ ids: [name, birthday] });
        expect(all.answer.forgotten.sort()).toEqual(['Their birthday is June 5', 'Their name is Sara']);
    });

    it('forgets nothing for a question or for a request to keep', async () => {
        for (const about of ['when is my birthday', "when's my birthday", 'what is my name?', 'do you know my name', 'my name?']) {
            const { answer, forget } = await run({ about });
            expect(forget, about).not.toHaveBeenCalled();
            expect(answer.note, about).toContain('question');
        }
        for (const about of ["don't forget my name", 'remember my birthday']) {
            const { answer, forget } = await run({ about });
            expect(forget, about).not.toHaveBeenCalled();
            expect(answer.note, about).toContain('keep');
        }
        // A polite request that starts like a question is still a request
        expect((await run({ about: 'can you forget my name' })).forget).toHaveBeenCalledTimes(1);
    });

    it('forgets at once what is clearly meant, and asks nothing', async () => {
        const { answer, forget } = await run({ about: 'please forget my name for now' });
        expect(keysOf(forget)).toEqual([memoryItemKey('name', null, 'Sara')]);
        expect(answer.forgotten).toEqual(['Their name is Sara']);
        expect((await run({ about: 'forget my name and my birthday' })).forget).toHaveBeenCalledTimes(1);
        expect(keysOf((await run({ about: 'forget coffee' })).forget)).toEqual([memoryItemKey('pref', null, 'coffee, no sugar')]);
    });

    it('tells the model to ask when it is not clear, and never to confirm what is clear', () => {
        const text = memoryToolDefinitions().find((tool) => tool.function.name === FORGET_MEMORY_TOOL)!.function.description;
        expect(text).toContain('without asking them to confirm');
        expect(text).toContain('not clear which memory');
        expect(text).toContain('Never use it for a question');
        expect(text).not.toContain('Never ask them to confirm first');
    });
});

describe('asking to be told or to keep is never asking to forget (audit)', () => {
    const named = [thing('name', 'Mark'), thing('birthday', '12 June'), thing('pref', 'coffee'), thing('pref', 'tea')];
    const recall = [
        'can you tell me my birthday', 'tell me my name', 'you know my name', 'can you remember my name', 'will you remember my birthday',
        'could you tell me what my name is', 'tell me everything about my birthday', 'do remember my birthday', 'you remember my birthday right',
        'my birthday is when', 'remind me of my name', 'do you know my birthday', 'what is my name',
    ];

    it('takes nothing for a request to be told, and asks which memory is meant', async () => {
        for (const about of recall) {
            expect(itemsAbout(named, about), about).toEqual([]);
            const forget = vi.fn(async () => 1);
            const answer = (await runMemoryTool(FORGET_MEMORY_TOOL, { about }, { memory: sara(), forget })) as any;
            expect(forget, about).not.toHaveBeenCalled();
            expect(answer.forgotten, about).toEqual([]);
        }
    });

    it('still forgets when forgetting is what is asked, however politely', () => {
        for (const about of ['forget my name', 'please forget my name', 'can you forget my name', 'could you please erase my name', 'will you delete my name now', 'forget my birthday', 'would you forget my birthday for now']) {
            expect(ids(itemsAbout(named, about)), about).toEqual([about.includes('birthday') ? 'birthday::12 June' : 'name::Mark']);
        }
    });

    it('treats "remember" or "keep" anywhere in a clause as a request to keep', () => {
        for (const about of ['remember my name', 'please remember my birthday', 'you should keep my name', 'keep coffee', 'I want you to remember coffee']) {
            const result = resolveForgetting(named, about);
            expect(result.chosen, about).toEqual([]);
            expect(result.keepOnly, about).toBe(true);
        }
    });

    it('is not keep-only when the request also says to forget', () => {
        for (const about of ['keep coffee forget tea', 'remember coffee but forget tea', 'keep my name, forget my birthday', 'forget everything you remember about my name']) {
            const result = resolveForgetting(named, about);
            expect(result.keepOnly, about).toBe(false);
        }
        // What is clear is still done, and what is kept stays
        expect(ids(itemsAbout(named, 'remember coffee but forget tea'))).toEqual(['pref::tea']);
        expect(ids(itemsAbout(named, 'remember my name and forget my birthday'))).toEqual(['birthday::12 June']);
        // Said as one run with no joint, it settles nothing: the model is told it is unclear, and never that it will keep it
        expect(itemsAbout(named, 'keep coffee forget tea')).toEqual([]);
    });

    it('never tells the person it will keep something when they also asked to forget', async () => {
        const forget = vi.fn(async () => 1);
        const answer = (await runMemoryTool(FORGET_MEMORY_TOOL, { about: 'keep coffee forget tea' }, { memory: sara(), forget })) as any;
        expect(forget).not.toHaveBeenCalled();
        expect(answer.unclear).toBe(true);
        expect(answer.note).not.toContain('keep it, not to forget');
    });
});

describe('a keep that names nothing keeps what was just said (audit)', () => {
    const named = [thing('name', 'Mark'), thing('birthday', '12 June'), thing('pref', 'coffee'), thing('pref', 'tea')];
    it('never forgets what the person asks to keep with "it" or "that"', () => {
        for (const about of ['my name, remember it', 'my birthday, keep that', 'my name - remember this', 'coffee, keep them', 'forget my name and remember it', 'my name; remember that', 'my name, do not forget it', "my birthday, don't forget that"]) {
            expect(itemsAbout(named, about), about).toEqual([]);
            expect(resolveForgetting(named, about).clear, about).toBe(false);
        }
    });
    it('still takes the other thing, and never tells them it will keep what they asked to forget', async () => {
        expect(ids(itemsAbout(named, 'my name and my birthday, remember it'))).toEqual(['name::Mark']);
        const forget = vi.fn(async () => 1);
        const answer = (await runMemoryTool(FORGET_MEMORY_TOOL, { about: 'my name, remember it' }, { memory: sara(), forget })) as any;
        expect(forget).not.toHaveBeenCalled();
        expect(answer.forgotten).toEqual([]);
    });
});

describe('CodeRabbit on #2020: a thing with "and" in it, and a keep that says its verb', () => {
    it('asks which one when "fish and chips" could also be cut into "fish" and "chips"', () => {
        const both = [thing('pref', 'fish'), thing('pref', 'fish and chips')];
        expect(itemsAbout(both, 'forget fish and chips')).toEqual([]);
        expect(ids(resolveForgetting(both, 'forget fish and chips').unsure).sort()).toEqual(['pref::fish', 'pref::fish and chips']);
        // Alone, "fish and chips" is the one thing it says
        expect(ids(itemsAbout([thing('pref', 'fish and chips')], 'forget fish and chips'))).toEqual(['pref::fish and chips']);
        // Plain "coffee and tea" with each stored alone still forgets both
        expect(ids(itemsAbout([thing('pref', 'coffee'), thing('pref', 'tea')], 'forget coffee and tea')).sort()).toEqual(['pref::coffee', 'pref::tea']);
    });

    it('keeps what a keep clause names, with its verb said', () => {
        const items = [thing('pref', 'coffee'), thing('pref', 'tea')];
        expect(itemsAbout(items, 'forget coffee but keep coffee')).toEqual([]);
        expect(ids(itemsAbout(items, 'forget coffee and tea but keep coffee'))).toEqual(['pref::tea']);
        const named = [thing('name', 'Mark'), thing('birthday', '12 June')];
        expect(itemsAbout(named, 'forget my name and remember my name')).toEqual([]);
    });

    it('forgets nothing when a keep could mean the thing to be forgotten', () => {
        const paris = [thing('fact', 'Paris', 'home_city'), thing('fact', 'Paris', 'next_trip')];
        expect(itemsAbout(paris, 'forget my home city but keep Paris')).toEqual([]);
        expect(ids(resolveForgetting(paris, 'forget my home city but keep Paris').unsure).sort()).toEqual(['fact:home_city:Paris', 'fact:next_trip:Paris']);
        // A keep that names the other one outright still lets the first go
        expect(ids(itemsAbout(paris, 'forget my home city but keep my next trip'))).toEqual(['fact:home_city:Paris']);
    });

    it('says the saved copy is still going, for a partial removal as well as a whole one', async () => {
        const memory = sara();
        const waiting = async (went: number) => (await runMemoryTool(FORGET_MEMORY_TOOL, { about: 'that I like coffee' }, { memory, forget: vi.fn(async () => ({ went, waiting: 1 })) })) as Record<string, unknown>;
        const whole = await waiting(1);
        expect(whole).toMatchObject({ count: 1, saving: 'waiting' });
        expect(String(whole.note)).toContain('saved copy');
        const both = await runMemoryTool(FORGET_MEMORY_TOOL, { ids: [memoryItemKey('name', null, 'Sara'), memoryItemKey('pref', null, 'coffee, no sugar')] }, { memory, forget: vi.fn(async () => ({ went: 1, waiting: 1 })) });
        expect(both).toMatchObject({ count: 1, asked: 2, saving: 'waiting' });
        expect(String((both as { note: string }).note)).toContain('saved copy');
        // Orbit took it: no such warning
        const done = (await runMemoryTool(FORGET_MEMORY_TOOL, { about: 'that I like coffee' }, { memory, forget: vi.fn(async () => ({ went: 1, waiting: 0 })) })) as Record<string, unknown>;
        expect(done.saving).toBeUndefined();
    });

    it('shows a forget that removed nothing as a step that did not run', () => {
        expect(resultOf('a', { forgotten: [], unclear: true, note: 'x' })).toMatchObject({ id: 'a', ok: false, done: 'Forgot nothing yet' });
        expect(resultOf('a', { forgotten: ['They like coffee'], count: 1 })).toEqual({ id: 'a', ok: true });
        expect(resultOf('a', { things: [] })).toEqual({ id: 'a', ok: true });
    });
});
