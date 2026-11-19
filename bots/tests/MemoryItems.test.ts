/**
 * What a bot remembers about a person, one thing at a time, and Forget (game #2003). The keys are the same values Orbit
 * tests: a person names a thing by its key in their list there, and the bot server must find the same thing by it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
    axios: { get: vi.fn(), post: vi.fn(), put: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError },
}));
vi.mock('axios', () => ({ default: hoisted.axios, ...hoisted.axios }));

import { ConversationMemory, type BotPlayerMemory } from '../memory/ConversationMemory';
import { PersistentMemory } from '../memory/PersistentMemory';
import { forgetKeyOf, RedisForgetQueue, type ForgetFileContents, type ForgetQueueChanges, type ForgetQueueRedis, type ForgetQueueStore } from '../memory/ForgetQueue';
import { parseItemForgets } from '../memory/ForgetNotice';
import { dropItems, memoryItemKey, memoryItemsOf, visibleItems } from '../memory/MemoryItems';
import { heardInDm } from '../memory/Heard';

const BOT = 'bot-1';
const SARA = 7;

/** Orbit tests these exact values too (`__tests__/lib/bot-memory-items.test.ts`). Change them on both sides together. */
describe('memoryItemKey: the same key as Orbit', () => {
    it('makes the keys Orbit makes', () => {
        expect(memoryItemKey('name', null, 'Sara')).toBe('bb1c30c5e1d0cd2b3ab27793126097dc');
        expect(memoryItemKey('pref', null, 'coffee, no sugar')).toBe('58235559cd2895d1002b2acd76359a19');
        expect(memoryItemKey('fact', 'current_state', 'tired')).toBe('305e45c0f202f984dae645195abeacec');
        expect(memoryItemKey('birthday', null, 'June 5')).toBe('a6907634748425cf18d7793cf028f961');
    });

    it('ignores case and the space around the text, as Orbit does', () => {
        expect(memoryItemKey('name', null, '  SARA ')).toBe(memoryItemKey('name', null, 'Sara'));
    });
});

/** A memory that was told where each line is said: a direct message, or a talk with someone else nearby. */
function talking(others: string[] = []): ConversationMemory {
    const memory = new ConversationMemory();
    memory.useHeard((_botId, _playerId, spaceName) => (spaceName === 'dm' ? heardInDm() : { place: 'nearby', with: [...others] }));
    return memory;
}

function say(memory: ConversationMemory, text: string, at: number, space = 'dm') {
    vi.spyOn(Date, 'now').mockReturnValue(at);
    memory.addMessage(BOT, SARA, text, 'person', space);
    vi.mocked(Date.now).mockRestore();
}
function reply(memory: ConversationMemory, text: string, at: number) {
    vi.spyOn(Date, 'now').mockReturnValue(at);
    memory.addMessage(BOT, SARA, text, 'bot', 'dm');
    vi.mocked(Date.now).mockRestore();
}

describe('what a bot remembers, as a list', () => {
    it('lists each thing with its key, when it was said, and whether it was said privately', () => {
        const memory = talking(['uuid-omar']);
        say(memory, 'call me Sara', 1000, 'dm');
        say(memory, 'I love coffee, no sugar', 2000, 'bubble');
        say(memory, "I'm tired", 3000, 'dm');
        const items = memoryItemsOf(memory.getMemory(BOT, SARA)!);
        expect(items.map((item) => [item.kind, item.value, item.at])).toEqual([
            ['fact', 'tired', 3000],
            ['pref', 'coffee, no sugar', 2000],
            ['name', 'Sara', 1000],
        ]);
        expect(items.find((item) => item.kind === 'name')?.id).toBe('bb1c30c5e1d0cd2b3ab27793126097dc');
        // A direct message is private; a talk with Omar there is not
        expect(items.map((item) => [item.value, item.private])).toEqual([
            ['tired', true],
            ['coffee, no sugar', false],
            ['Sara', true],
        ]);
    });

    it('never lists what the bot keeps for itself', () => {
        const memory = talking();
        say(memory, "It's my birthday", 1000);
        const items = memoryItemsOf(memory.getMemory(BOT, SARA)!);
        expect(items.map((item) => item.kind)).toEqual(['birthday']);
        expect(items[0].at).toBe(1000);
    });

    it('gives a reply others read only what everyone there heard', () => {
        const memory = talking(['uuid-omar']);
        say(memory, 'call me Sara', 1000, 'dm');
        say(memory, 'I love lo-fi', 2000, 'bubble');
        const view = visibleItems(memory.getMemory(BOT, SARA)!, { present: ['uuid-omar'] });
        expect(view.map((item) => item.value)).toEqual(['lo-fi']);
        expect(visibleItems(memory.getMemory(BOT, SARA)!, 'all')).toHaveLength(2);
    });
});

describe('dropItems: a forgotten thing goes, with what was built from it', () => {
    let memory: ConversationMemory;
    const mine = () => memory.getMemory(BOT, SARA)!;
    beforeEach(() => {
        memory = talking();
        say(memory, 'hello there', 500);
        say(memory, 'call me Sara', 1000);
        reply(memory, 'Nice to meet you, Sara!', 1001);
        say(memory, 'I love lo-fi', 2000);
        say(memory, "my birthday is June 5", 3000);
        say(memory, "I'm tired", 4000);
    });

    it('takes the thing, the line it was said in, the bot lines that say it back, and where it was said', () => {
        const removed = dropItems(mine(), new Set([memoryItemKey('name', null, 'Sara')]));
        expect(removed).toBe(1);
        expect(mine().personalInfo.name).toBeUndefined();
        expect(mine().personalInfo.heard?.name).toBeUndefined();
        expect(mine().personalInfo.drawnFrom?.name).toBeUndefined();
        const lines = mine().conversationHistory.map((line) => line.message);
        expect(lines).not.toContain('call me Sara');
        expect(lines).not.toContain('Nice to meet you, Sara!');
        // What else was said stays
        expect(lines).toEqual(expect.arrayContaining(['hello there', 'I love lo-fi', 'my birthday is June 5']));
    });

    it('takes every bot line that says the person\'s short name back, and keeps what the person said (CodeRabbit)', () => {
        const short = talking();
        say(short, 'hello there', 500);
        say(short, 'call me Amy', 1000);
        reply(short, 'Hello, Amy!', 1001);
        say(short, 'what is the weather', 2000);
        reply(short, 'Amy, it is sunny', 2001);
        say(short, 'my friend Amy is coming', 3000);
        const record = short.getMemory(BOT, SARA)!;
        expect(dropItems(record, new Set([memoryItemKey('name', null, 'Amy')]))).toBe(1);
        const lines = record.conversationHistory.map((line) => line.message);
        expect(lines).not.toContain('call me Amy');
        expect(lines).not.toContain('Hello, Amy!');
        expect(lines).not.toContain('Amy, it is sunny');
        // What the person said about someone else stays
        expect(lines).toEqual(expect.arrayContaining(['hello there', 'what is the weather', 'my friend Amy is coming']));
    });

    it('takes the bot\'s reply right after the line a general fact came from when it says the value back, and no other line with the word', () => {
        const talk = talking();
        say(talk, 'I live in Paris', 1000);
        reply(talk, 'Paris, lovely!', 1001);
        say(talk, 'tell me about Paris history', 2000);
        reply(talk, 'Paris has a long history', 2001);
        const record = talk.getMemory(BOT, SARA)!;
        record.personalInfo.facts.set('city', 'Paris');
        record.personalInfo.drawnFrom = { ...(record.personalInfo.drawnFrom ?? {}), 'fact:city': 1000 };
        expect(dropItems(record, new Set([memoryItemKey('fact', 'city', 'Paris')]))).toBe(1);
        const lines = record.conversationHistory.map((line) => line.message);
        expect(lines).not.toContain('I live in Paris');
        expect(lines).not.toContain('Paris, lovely!');
        // The value is not taken out of every line for a general fact
        expect(lines).toEqual(expect.arrayContaining(['tell me about Paris history', 'Paris has a long history']));
    });

    it('finds a name written with a capital only as written, so the word it is also stays (Sentry)', () => {
        const short = talking();
        say(short, 'call me Will', 1000);
        reply(short, 'Nice to meet you, Will!', 1001);
        say(short, 'I will go to the shop later', 2000);
        reply(short, 'Sure, I will remind you', 2001);
        const record = short.getMemory(BOT, SARA)!;
        expect(dropItems(record, new Set([memoryItemKey('name', null, 'Will')]))).toBe(1);
        const lines = record.conversationHistory.map((line) => line.message);
        expect(lines).not.toContain('call me Will');
        expect(lines).not.toContain('Nice to meet you, Will!');
        expect(lines).toEqual(expect.arrayContaining(['I will go to the shop later', 'Sure, I will remind you']));
    });

    it('takes only the reply right after the line a short preference came from', () => {
        const short = talking();
        say(short, 'I love tea', 1000);
        reply(short, 'Tea is lovely!', 1001);
        say(short, 'what is the weather', 2000);
        reply(short, 'Sunny, good for tea outside', 2001);
        const record = short.getMemory(BOT, SARA)!;
        expect(dropItems(record, new Set([memoryItemKey('pref', null, 'tea')]))).toBe(1);
        const lines = record.conversationHistory.map((line) => line.message);
        expect(lines).not.toContain('I love tea');
        expect(lines).not.toContain('Tea is lovely!');
        expect(lines).toEqual(expect.arrayContaining(['what is the weather', 'Sunny, good for tea outside']));
    });

    it('takes a later bot line that tells a short preference back, and the model never sees it, keeping other mentions (CodeRabbit)', () => {
        const short = talking();
        say(short, 'I love tea', 1000);
        reply(short, 'Tea is lovely!', 1001);
        say(short, 'what is the weather', 2000);
        reply(short, 'You love tea, so a warm day is good news', 2001);
        say(short, 'what should I eat', 3000);
        reply(short, 'Since you really enjoy tea, a scone goes well', 3001);
        say(short, 'and outside?', 4000);
        reply(short, 'Sunny, good for tea outside', 4001);
        say(short, 'anything else?', 5000);
        reply(short, 'Tea is your favorite, so I would stay in', 5001);
        // Words that only contain "you" or "like": not about what the person likes
        say(short, 'and the evening?', 6000);
        reply(short, 'Yourself and the young ones will likely want tea', 6001);
        const record = short.getMemory(BOT, SARA)!;
        expect(dropItems(record, new Set([memoryItemKey('pref', null, 'tea')]))).toBe(1);
        const context = short.getConversationContext(BOT, SARA);
        expect(context).not.toMatch(/love tea/i);
        expect(context).not.toMatch(/enjoy tea/i);
        expect(context).not.toMatch(/Tea is your favorite/i);
        expect(context).not.toContain('Tea is lovely!');
        // What the person asked and an unrelated mention stay
        expect(context).toContain('what is the weather');
        expect(context).toContain('Sunny, good for tea outside');
        expect(context).toContain('Yourself and the young ones will likely want tea');
    });

    it('takes a birthday with the events written for it', () => {
        expect(mine().relationship.importantEvents.some((event) => event.event.startsWith('birthday'))).toBe(true);
        dropItems(mine(), new Set([memoryItemKey('birthday', null, 'June 5')]));
        expect(mine().personalInfo.birthday).toBeUndefined();
        expect(mine().relationship.importantEvents.some((event) => event.event.startsWith('birthday'))).toBe(false);
        expect(mine().personalInfo.facts.has('birthday_mentioned_at')).toBe(false);
    });

    it('judges a birthday and a state by the same time it is listed with, so one said after the forget stays and one said before goes', () => {
        const info = mine().personalInfo;
        // Nothing says where these were drawn from: the time comes from the note kept with each (as the list shows it)
        delete info.drawnFrom;
        const birthday = memoryItemKey('birthday', null, 'June 5');
        const tired = memoryItemKey('fact', 'current_state', 'tired');
        info.facts.set('birthday_mentioned_at', '3000');
        info.facts.set('tired_mentioned_at', '4000');
        expect(memoryItemsOf(mine()).filter((item) => item.id === birthday || item.id === tired).map((item) => item.at)).toEqual([4000, 3000]);
        // Forgotten at 3500: the birthday (3000) goes, the state (4000) was said after and stays
        expect(dropItems(mine(), new Set([birthday, tired]), new Map([[birthday, 3500], [tired, 3500]]))).toBe(1);
        expect(mine().personalInfo.birthday).toBeUndefined();
        expect(mine().personalInfo.facts.get('current_state')).toBe('tired');
        // Forgotten at 2500: the birthday was said after that, and stays
        const again = talking();
        say(again, 'my birthday is June 5', 3000);
        const noted = again.getMemory(BOT, SARA)!;
        delete noted.personalInfo.drawnFrom;
        noted.personalInfo.facts.set('birthday_mentioned_at', '3000');
        expect(dropItems(noted, new Set([birthday]), new Map([[birthday, 2500]]))).toBe(0);
        expect(noted.personalInfo.birthday).toBe('June 5');
    });

    it('takes a like, and a state with the note of when it was said', () => {
        dropItems(mine(), new Set([memoryItemKey('pref', null, 'lo-fi'), memoryItemKey('fact', 'current_state', 'tired')]));
        expect(mine().personalInfo.preferences).toEqual([]);
        expect(mine().personalInfo.facts.has('current_state')).toBe(false);
        expect(mine().personalInfo.facts.has('tired_mentioned_at')).toBe(false);
        expect(mine().conversationHistory.map((line) => line.message)).not.toContain("I'm tired");
    });

    it('takes nothing for a key the bot does not hold', () => {
        expect(dropItems(mine(), new Set(['0'.repeat(32)]))).toBe(0);
        expect(mine().personalInfo.name).toBe('Sara');
    });

    it('keeps a thing the person said again after they forgot it', () => {
        const key = memoryItemKey('pref', null, 'lo-fi');
        // Forgotten at 1500, said at 2000: it is new
        expect(dropItems(mine(), new Set([key]), new Map([[key, 1500]]))).toBe(0);
        expect(mine().personalInfo.preferences).toEqual(['lo-fi']);
        // Forgotten at 2500: what was said at 2000 goes
        expect(dropItems(mine(), new Set([key]), new Map([[key, 2500]]))).toBe(1);
    });

    it('drops a thing whose forget carries no time, whenever it was said', () => {
        const key = memoryItemKey('pref', null, 'lo-fi');
        // Orbit sent no time (0): it cannot say what came after, so the thing goes
        expect(dropItems(mine(), new Set([key]), new Map([[key, 0]]))).toBe(1);
    });

    it('drops by the words when no line was noted (what was kept before this), the person\'s lines too', () => {
        const old = mine();
        delete old.personalInfo.drawnFrom;
        dropItems(old, new Set([memoryItemKey('name', null, 'Sara')]));
        expect(old.conversationHistory.map((line) => line.message)).not.toContain('call me Sara');
    });
});

describe('what Orbit says to forget', () => {
    it('reads whole entries and drops the rest', () => {
        expect(
            parseItemForgets([
                { id: 'a', userUuid: 'u', itemKey: 'k', kind: 'pref', at: 5 },
                { id: 'b', userUuid: 'u' },
                null,
                { id: 'c', userUuid: 'u', itemKey: 'k2' },
            ])
        ).toEqual([
            { id: 'a', userUuid: 'u', itemKey: 'k', at: 5 },
            { id: 'c', userUuid: 'u', itemKey: 'k2', at: 0 },
        ]);
        expect(parseItemForgets(undefined)).toEqual([]);
        expect(parseItemForgets('x')).toEqual([]);
    });
});

describe('PersistentMemory: Forget of one thing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.axios.post.mockReset().mockResolvedValue({ data: { success: true } });
        process.env.BOT_SERVICE_TOKEN = 'service-secret';
    });

    function held() {
        const memory: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local' });
        memory.useHeard(() => heardInDm());
        memory.setUserUuid(BOT, SARA, 'uuid-sara', true);
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        memory.addMessage(BOT, SARA, 'call me Sara', 'person', 'dm');
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        vi.mocked(Date.now).mockRestore();
        const record = memory.getMemory(BOT, SARA);
        memory.loadedMemoriesByUuid.set(`${BOT}_uuid-sara`, memory.cloneMemory(record));
        memory.pendingSaves.set(`${BOT}_${SARA}`, record);
        // Typed loosely on purpose: the tests reach into its private maps and timers
        return memory;
    }

    const lofi = memoryItemKey('pref', null, 'lo-fi');

    it('drops the thing from what is active, what was loaded for them and the save waiting, and reports it', async () => {
        const memory = held();
        memory.forgetItems(BOT, [{ id: 'f1', userUuid: 'uuid-sara', itemKey: lofi, at: 2000 }]);
        expect(memory.getMemory(BOT, SARA)!.personalInfo.preferences).toEqual([]);
        expect(memory.loadedMemoriesByUuid.get(`${BOT}_uuid-sara`).personalInfo.preferences).toEqual([]);
        expect(memory.pendingSaves.get(`${BOT}_${SARA}`)!.personalInfo.preferences).toEqual([]);
        // The rest is kept
        expect(memory.getMemory(BOT, SARA)!.personalInfo.name).toBe('Sara');
        await vi.waitFor(() => expect(hoisted.axios.post.mock.calls.some((call) => String(call[0]).endsWith('/forgotten'))).toBe(true));
        const [url, body] = hoisted.axios.post.mock.calls.find((call) => String(call[0]).endsWith('/forgotten'))!;
        expect(url).toBe('http://orbit.local/api/bots/memory/bot-1/forgotten');
        expect(body).toEqual({ itemIds: ['f1'], items: [{ id: 'f1', at: 2000 }] });
    });

    it('drops it once: Orbit repeating the notice does not take what was said since', async () => {
        const memory = held();
        const notice = { id: 'f1', userUuid: 'uuid-sara', itemKey: lofi, at: 2000 };
        memory.forgetItems(BOT, [notice]);
        // She says it again, and Orbit's next answer still carries the same Forget
        vi.spyOn(Date, 'now').mockReturnValue(3000);
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        vi.mocked(Date.now).mockRestore();
        memory.forgetItems(BOT, [notice]);
        expect(memory.getMemory(BOT, SARA)!.personalInfo.preferences).toEqual(['lo-fi']);
    });

    it('keeps what was said after it was forgotten even when the notice arrives late', () => {
        const memory = held();
        memory.forgetItems(BOT, [{ id: 'f9', userUuid: 'uuid-sara', itemKey: lofi, at: 500 }]);
        expect(memory.getMemory(BOT, SARA)!.personalInfo.preferences).toEqual(['lo-fi']);
    });

    it('drops it when Orbit sent no time, or one that is not a time, however recently it was said', () => {
        for (const at of [undefined, 0, 'x', -5, Number.NaN]) {
            const memory = held();
            const [notice] = parseItemForgets([{ id: 'f0', userUuid: 'uuid-sara', itemKey: lofi, at }]);
            expect(notice.at, String(at)).toBe(0);
            memory.forgetItems(BOT, [notice]);
            expect(memory.getMemory(BOT, SARA)!.personalInfo.preferences, String(at)).toEqual([]);
        }
        // A real time later than what was said also takes it; a no-time forget is not undone by a timed one for the same thing
        const memory = held();
        memory.forgetItems(BOT, [{ id: 'g1', userUuid: 'uuid-sara', itemKey: lofi, at: 0 }, { id: 'g2', userUuid: 'uuid-sara', itemKey: lofi, at: 100 }]);
        expect(memory.getMemory(BOT, SARA)!.personalInfo.preferences).toEqual([]);
    });

    it('leaves another person and another bot alone', () => {
        const memory = held();
        memory.forgetItems('bot-2', [{ id: 'f2', userUuid: 'uuid-sara', itemKey: lofi, at: 2000 }]);
        memory.forgetItems(BOT, [{ id: 'f3', userUuid: 'uuid-omar', itemKey: lofi, at: 2000 }]);
        expect(memory.getMemory(BOT, SARA)!.personalInfo.preferences).toEqual(['lo-fi']);
    });

    it('forgets in the chat: drops it now and tells Orbit by key', async () => {
        const memory = held();
        const removed = await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(removed).toBe(1);
        expect(memory.getMemory(BOT, SARA)!.personalInfo.preferences).toEqual([]);
        expect(memory.loadedMemoriesByUuid.get(`${BOT}_uuid-sara`).personalInfo.preferences).toEqual([]);
        const [url, body, config] = hoisted.axios.post.mock.calls.find((call) => String(call[0]).endsWith('/items'))!;
        expect(url).toBe('http://orbit.local/api/bots/memory/bot-1/items');
        expect(body).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref', at: expect.any(Number) });
        expect(config.headers.Authorization).toBe('Bearer service-secret');
    });

    it('takes out every line a thing was said in, not only the last, and leaves longer words alone', () => {
        const memory = held();
        const record = memory.getMemory(BOT, SARA)!;
        // Said twice: only the later line is noted, the earlier one is found by its words
        record.conversationHistory.unshift({ sender: 'person', message: 'I really love lo-fi', timestamp: 500 } as any);
        record.conversationHistory.push({ sender: 'bot', message: 'Lo-fi is great, noted.', timestamp: 1500 } as any);
        record.conversationHistory.push({ sender: 'bot', message: 'That was a remarkable bookmark of a day', timestamp: 1600 } as any);
        const named = memory.getMemory(BOT, SARA)!;
        named.personalInfo.name = 'Mark';
        named.personalInfo.drawnFrom = { ...(named.personalInfo.drawnFrom ?? {}), name: 1000 };
        record.conversationHistory.push({ sender: 'bot', message: 'Bookmark saved, remarkable.', timestamp: 1700 } as any);
        dropItems(record, new Set([lofi, memoryItemKey('name', null, 'Mark')]));
        const left = record.conversationHistory.map((line) => line.message);
        expect(left.some((line) => /lo-fi/i.test(line))).toBe(false);
        expect(left).toContain('That was a remarkable bookmark of a day');
        expect(left).toContain('Bookmark saved, remarkable.');
    });

    // A forget Orbit did not take
    it('is told again before the next save, so it is not left for want of one failed call', async () => {
        const memory = held();
        hoisted.axios.post.mockClear();
        hoisted.axios.post.mockRejectedValueOnce(new Error('Orbit is down'));
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(memory.unreportedItemForgets.size).toBe(1);
        await memory.reportUnreportedForgets(BOT);
        const told = hoisted.axios.post.mock.calls.filter((call) => String(call[0]).endsWith('/items'));
        expect(told).toHaveLength(2);
        expect(told[1][1]).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref', at: expect.any(Number) });
        expect(memory.unreportedItemForgets.size).toBe(0);
    });

    it('keeps trying while Orbit stays down, and lets it go once Orbit takes it', async () => {
        const memory = held();
        hoisted.axios.post.mockRejectedValue(new Error('Orbit is down'));
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(1);
        hoisted.axios.post.mockReset().mockResolvedValue({ data: {} });
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(0);
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('lets go of a forget Orbit took even when an overlapping run re-kept the same ask meanwhile (Sentry)', async () => {
        const memory = held();
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'busy', response: { status: 503 } });
        await memory.forgetThingsReported(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        const [entry] = [...memory.unreportedItemForgets.values()];
        hoisted.axios.post.mockReset().mockImplementation(async () => {
            // Another run keeps the same ask again (a new object, the same time) while Orbit is still answering this one
            memory.keepToReport({ ...entry });
            return { data: {} };
        });
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(0);
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('does not queue a forget to tell again when there is no Orbit to tell', async () => {
        const memory: any = new PersistentMemory({});
        memory.useHeard(() => heardInDm());
        memory.setUserUuid(BOT, SARA, 'uuid-sara', true);
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        hoisted.axios.post.mockClear();
        expect(await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]))).toBe(1);
        expect(hoisted.axios.post).not.toHaveBeenCalled();
        expect(memory.unreportedItemForgets.size).toBe(0);
        expect(memory.unreportedRetryTimer ?? null).toBeNull();
    });

    it('does not queue a forget with nothing to name, or when Orbit has no service token, and still queues one Orbit could not take', async () => {
        const memory = held();
        hoisted.axios.post.mockClear();
        const storage = (memory as any).memoryStorage;
        // Nothing to name: it can never be reported
        expect(await storage.reportForgottenItem(BOT, 'uuid-sara', '', 'pref')).toBe(true);
        expect(await storage.reportForgottenItem('', 'uuid-sara', lofi, 'pref')).toBe(true);
        // A URL with no service token cannot change while this runs (the process would have to be restarted, which empties the queue)
        const saved = process.env.BOT_SERVICE_TOKEN;
        delete process.env.BOT_SERVICE_TOKEN;
        try {
            const noToken: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local' });
            expect(await noToken.memoryStorage.reportForgottenItem(BOT, 'uuid-sara', lofi, 'pref')).toBe(true);
        } finally {
            process.env.BOT_SERVICE_TOKEN = saved;
        }
        expect(hoisted.axios.post.mock.calls.filter((call) => String(call[0]).endsWith('/items'))).toEqual([]);
        // Orbit that could not be reached is still tried again
        hoisted.axios.post.mockRejectedValueOnce({ isAxiosError: true, message: 'busy', response: { status: 503 } });
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(memory.unreportedItemForgets.size).toBe(1);
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('says how many forgets Orbit has not taken yet, and keeps the latest ask for reporting (CodeRabbit)', async () => {
        const memory = held();
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'busy', response: { status: 503 } });
        const first = await memory.forgetThingsReported(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(first).toEqual({ went: 1, waiting: 1, durable: true });
        const [entry] = [...memory.unreportedItemForgets.values()];
        const firstAt = entry.first;
        expect(entry.since).toBeGreaterThanOrEqual(firstAt);
        // Asked again later: the report carries the later time, and the day it is let go from stays the first one
        memory.keepToReport({ ...entry, since: entry.since + 500 });
        const [again] = [...memory.unreportedItemForgets.values()];
        expect(again.since).toBe(entry.since + 500);
        expect(again.first).toBe(firstAt);
        // Orbit takes the older entry's report while a newer one replaced it: the newer one stays
        hoisted.axios.post.mockReset().mockImplementation(async () => {
            memory.keepToReport({ ...again, since: again.since + 500 });
            return { status: 200, data: {} };
        });
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(1);
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('lets go a forget that Orbit refuses for good, but keeps one it only could not take yet', async () => {
        const memory = held();
        // A busy Orbit or a refused token is tried again
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'busy', response: { status: 503 } });
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(memory.unreportedItemForgets.size).toBe(1);
        // A route that is missing for now (404, an Orbit not yet updated) is tried again
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'no route', response: { status: 404 } });
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(1);
        // An answer that can never change (410 gone) is let go
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'gone', response: { status: 410 } });
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(0);
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('tells Orbit when the person asked, also on a retry, so a late report does not make the forget newer', async () => {
        const memory = held();
        vi.spyOn(Date, 'now').mockReturnValue(7000);
        hoisted.axios.post.mockReset().mockRejectedValue(new Error('Orbit is down'));
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(hoisted.axios.post.mock.calls[0][1]).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref', at: 7000 });
        vi.mocked(Date.now).mockReturnValue(9000);
        hoisted.axios.post.mockReset().mockResolvedValue({ data: {} });
        await memory.reportUnreportedForgets(BOT);
        vi.mocked(Date.now).mockRestore();
        expect(hoisted.axios.post.mock.calls[0][1]).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref', at: 7000 });
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('keeps a forget Orbit has not taken however long Orbit stays down (#2031)', async () => {
        const memory = held();
        hoisted.axios.post.mockReset().mockRejectedValue(new Error('Orbit is down'));
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        const [entry] = [...memory.unreportedItemForgets.values()];
        entry.first = Date.now() - 10 * 24 * 60 * 60 * 1000;
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(1);
        clearTimeout(memory.unreportedRetryTimer);
    });
});

describe('PersistentMemory: a forgotten thing is not brought back by a snapshot, a waiting save or a save that was waiting on Orbit', () => {
    const lofi = memoryItemKey('pref', null, 'lo-fi');

    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.axios.post.mockReset().mockResolvedValue({ data: { success: true } });
        process.env.BOT_SERVICE_TOKEN = 'service-secret';
    });

    function held() {
        const memory: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local' });
        memory.useHeard(() => heardInDm());
        memory.setUserUuid(BOT, SARA, 'uuid-sara', true);
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        memory.addMessage(BOT, SARA, 'call me Sara', 'person', 'dm');
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        vi.mocked(Date.now).mockRestore();
        return memory;
    }

    /** What Orbit holds for her: read before the forget, so it still has the thing. */
    function oldSnapshot(memory: any): BotPlayerMemory {
        const snapshot = memory.cloneMemory(memory.getMemory(BOT, SARA));
        snapshot.userUuid = 'uuid-sara';
        return snapshot;
    }

    it('drops a thing forgotten while the memories were being read, from the snapshot that finishes after it', async () => {
        const memory = held();
        const snapshot = oldSnapshot(memory);
        let finish: (memories: BotPlayerMemory[]) => void = () => undefined;
        vi.spyOn(memory.memoryStorage, 'loadMemories').mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const loading = memory.loadMemories(BOT);
        memory.forgetItems(BOT, [{ id: 'f1', userUuid: 'uuid-sara', itemKey: lofi, at: 2000 }]);
        finish([snapshot]);
        await loading;
        expect(memory.loadedMemoriesByUuid.get(`${BOT}_uuid-sara`).personalInfo.preferences).toEqual([]);
        expect(memory.loadedMemoriesByUuid.get(`${BOT}_uuid-sara`).personalInfo.name).toBe('Sara');
        expect(memory.forgetsDuringLoad.size).toBe(0);
    });

    it('drops a thing forgotten in the chat while they were being read, and a thing Orbit has not taken yet from the old snapshot it gives back', async () => {
        const memory = held();
        const snapshot = oldSnapshot(memory);
        let finish: (memories: BotPlayerMemory[]) => void = () => undefined;
        vi.spyOn(memory.memoryStorage, 'loadMemories').mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const loading = memory.loadMemories(BOT);
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'not found', response: { status: 404 } });
        await memory.forgetThingsReported(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        finish([snapshot]);
        await loading;
        expect(memory.loadedMemoriesByUuid.get(`${BOT}_uuid-sara`).personalInfo.preferences).toEqual([]);
        // Later, Orbit's old snapshot is read again while the report is still waiting
        vi.spyOn(memory.memoryStorage, 'loadMemories').mockResolvedValue([oldSnapshot(held())]);
        memory.loadedMemoriesByUuid.clear();
        await memory.loadMemories(BOT);
        expect(memory.loadedMemoriesByUuid.get(`${BOT}_uuid-sara`).personalInfo.preferences).toEqual([]);
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('does not keep a snapshot of a person who was forgotten as a whole while it was being read', async () => {
        const memory = held();
        const snapshot = oldSnapshot(memory);
        let finish: (memories: BotPlayerMemory[]) => void = () => undefined;
        vi.spyOn(memory.memoryStorage, 'loadMemories').mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const loading = memory.loadMemories(BOT);
        memory.forget(BOT, { everyone: false, userUuids: ['uuid-sara'], rows: [{ id: 'row-1', userUuid: 'uuid-sara' }] });
        finish([snapshot]);
        await loading;
        expect(memory.loadedMemoriesByUuid.has(`${BOT}_uuid-sara`)).toBe(false);
    });

    it('drops a thing forgotten in the chat from a copy that a waiting save holds apart from the active memory', async () => {
        const memory = held();
        const detached = oldSnapshot(memory);
        memory.pendingSaves.set(`${BOT}_99`, detached);
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(detached.personalInfo.preferences).toEqual([]);
    });

    it.each(['periodic', 'immediate'] as const)('does not write a person back over a Forget of them that came while Orbit was being told of other forgets (%s save)', async (kind) => {
        const memory = held();
        const save = vi.spyOn(memory.memoryStorage, 'saveMemory').mockResolvedValue(undefined);
        let finish: () => void = () => undefined;
        vi.spyOn(memory, 'reportUnreportedForgets').mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
        const saving = kind === 'periodic' ? (memory.scheduleDebouncedSave(BOT, SARA), memory.flushDebouncedSave(BOT, SARA)) : memory.saveMemoryImmediately(BOT, memory.getMemory(BOT, SARA));
        memory.forget(BOT, { everyone: false, userUuids: ['uuid-sara'], rows: [{ id: 'row-2', userUuid: 'uuid-sara' }] });
        finish();
        await saving;
        expect(save).not.toHaveBeenCalled();
    });

    it('still saves when nothing was forgotten while Orbit was being told', async () => {
        const memory = held();
        const save = vi.spyOn(memory.memoryStorage, 'saveMemory').mockResolvedValue(undefined);
        // Saves that the earlier messages started are not what is counted
        await new Promise((resolve) => setTimeout(resolve, 10));
        save.mockClear();
        memory.scheduleDebouncedSave(BOT, SARA);
        await memory.flushDebouncedSave(BOT, SARA);
        expect(save).toHaveBeenCalledTimes(1);
    });
});

/** The shared store of waiting forgets, in memory: what two bot servers (or one before and after a restart) would both see. */
class FakeForgetStore implements ForgetQueueStore {
    pending = new Map<string, Record<string, unknown>>();
    ledger = new Map<string, Record<string, unknown>>();
    /** Reads and writes fail while the store cannot be reached. */
    unreachable = false;
    /** False while there is no shared store at all (never reached). */
    present = true;
    inUse() {
        return this.present;
    }
    writes = 0;
    async load(): Promise<ForgetFileContents> {
        if (this.unreachable) throw new Error('Shared store is not connected');
        return { pending: [...this.pending.values()] as never, ledger: [...this.ledger.values()] as never };
    }
    async write(changes: ForgetQueueChanges): Promise<void> {
        if (this.unreachable) throw new Error('Shared store is not connected');
        this.writes++;
        // As in Redis: a put does not replace a later ask, and a removal does not remove one (0 is the latest of all)
        const rank = (since: unknown) => (since === 0 ? Infinity : (since as number));
        const apply = (map: Map<string, Record<string, unknown>>, put: Array<{ since: number }>, del: Array<{ key: string; since: number }>) => {
            for (const entry of put) {
                const key = forgetKeyOf(entry as never);
                const stored = map.get(key);
                if (!stored || rank(stored.since) <= rank(entry.since)) map.set(key, { ...entry });
            }
            for (const one of del) {
                const stored = map.get(one.key);
                if (stored && rank(stored.since) <= rank(one.since)) map.delete(one.key);
            }
        };
        apply(this.pending, changes.pending.put, changes.pending.del);
        apply(this.ledger, changes.ledger.put, changes.ledger.del);
    }
    contents() {
        return { pending: [...this.pending.values()], ledger: [...this.ledger.values()] };
    }
}

describe('PersistentMemory: a forget Orbit has not taken survives a restart (#2031)', () => {
    let store: FakeForgetStore;
    const lofi = memoryItemKey('pref', null, 'lo-fi');
    const down = () => hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'down', response: { status: 503 } });
    const up = () => hoisted.axios.post.mockReset().mockResolvedValue({ data: {} });
    const saved = () => store.contents().pending;
    const start = async () => {
        const memory: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local', forgetQueue: store });
        await memory.forgetQueueReady;
        memory.useHeard(() => heardInDm());
        // Typed loosely on purpose: the tests reach into its private maps and timers
        return memory;
    };
    const forgetWhileDown = async (memory: PersistentMemory & Record<string, any>) => {
        memory.setUserUuid(BOT, SARA, 'uuid-sara', true);
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        vi.mocked(Date.now).mockRestore();
        down();
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
    };

    beforeEach(() => {
        store = new FakeForgetStore();
    });

    it('writes a forget Orbit did not take to the shared store, and a new process finds it and tells Orbit', async () => {
        const first = await start();
        await forgetWhileDown(first);
        clearTimeout(first.unreportedRetryTimer);
        expect(saved()).toEqual([expect.objectContaining({ botId: BOT, userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref' })]);

        // The bot server restarts: a new process, the same shared store
        const second = await start();
        expect(second.unreportedItemForgets.size).toBe(1);
        up();
        await second.reportUnreportedForgets();
        const told = hoisted.axios.post.mock.calls.filter((call) => String(call[0]).endsWith('/items'));
        expect(told).toHaveLength(1);
        expect(told[0][1]).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref', at: expect.any(Number) });
        // Orbit took it: it is no longer waiting, in this process or in the shared store
        expect(second.unreportedItemForgets.size).toBe(0);
        expect(saved()).toEqual([]);
        clearTimeout(second.unreportedRetryTimer);
    });

    it('keeps it through a day of outage and a second restart', async () => {
        const first = await start();
        await forgetWhileDown(first);
        clearTimeout(first.unreportedRetryTimer);
        const later = await start();
        const [entry] = [...later.unreportedItemForgets.values()];
        entry.first = Date.now() - 3 * 24 * 60 * 60 * 1000;
        await later.reportUnreportedForgets();
        clearTimeout(later.unreportedRetryTimer);
        expect(saved()).toHaveLength(1);
        expect((await start()).unreportedItemForgets.size).toBe(1);
    });

    it('drops the thing again from what Orbit still has saved when the memories are loaded after the restart', async () => {
        const first = await start();
        await forgetWhileDown(first);
        clearTimeout(first.unreportedRetryTimer);

        const second = await start();
        clearTimeout(second.unreportedRetryTimer);
        // Orbit never heard of the forget, so what it saved still holds lo-fi
        const stale = first.cloneMemory(talkingRecord('uuid-sara', ['lo-fi', 'jazz']));
        vi.spyOn((second as any).memoryStorage, 'loadMemories').mockResolvedValue([stale]);
        await second.loadMemories(BOT);
        const loaded = (second as any).loadedMemoriesByUuid.get(`${BOT}_uuid-sara`);
        expect(loaded.personalInfo.preferences).toEqual(['jazz']);
    });

    it('keeps the latest ask when the same thing is forgotten twice while Orbit is down', async () => {
        const memory = await start();
        await forgetWhileDown(memory);
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(memory.unreportedRetryTimer);
        const rows = saved();
        expect(rows).toHaveLength(1);
        expect(rows[0].since as number).toBeGreaterThanOrEqual(rows[0].first as number);
    });

    it('lets go of one Orbit refuses for good, and says so', async () => {
        const memory = await start();
        await forgetWhileDown(memory);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'gone', response: { status: 410 } });
        await memory.reportUnreportedForgets();
        clearTimeout(memory.unreportedRetryTimer);
        expect(memory.unreportedItemForgets.size).toBe(0);
        expect(saved()).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not tell Orbit what was forgotten'));
        warn.mockRestore();
    });

    it('lets go of one Orbit has refused with a client error for over a week, but never one it could not reach (Sentry)', async () => {
        const memory = await start();
        await forgetWhileDown(memory);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const [entry] = [...memory.unreportedItemForgets.values()];
        const week = 8 * 24 * 60 * 60 * 1000;
        entry.first = Date.now() - week;
        // An outage, however long, keeps it
        down();
        await memory.reportUnreportedForgets();
        expect(memory.unreportedItemForgets.size).toBe(1);
        hoisted.axios.post.mockReset().mockRejectedValue(new Error('no answer'));
        await memory.reportUnreportedForgets();
        expect(memory.unreportedItemForgets.size).toBe(1);
        // Eight days of outage and then one refusal is not a week of refusals: the count starts at the refusal
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'no route', response: { status: 404 } });
        await memory.reportUnreportedForgets();
        expect(memory.unreportedItemForgets.size).toBe(1);
        const once = [...memory.unreportedItemForgets.values()][0];
        expect(once.refusedSince).toBeGreaterThan(Date.now() - 60 * 1000);
        // An outage in between ends the count
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'down', response: { status: 503 } });
        await memory.reportUnreportedForgets();
        expect([...memory.unreportedItemForgets.values()][0].refusedSince).toBeUndefined();
        // Refused for over a week running: let go
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'no route', response: { status: 404 } });
        await memory.reportUnreportedForgets();
        [...memory.unreportedItemForgets.values()][0].refusedSince = Date.now() - week;
        await memory.reportUnreportedForgets();
        clearTimeout(memory.unreportedRetryTimer);
        expect(memory.unreportedItemForgets.size).toBe(0);
        expect(saved()).toEqual([]);
        warn.mockRestore();
    });

    it('starts with nothing waiting when the shared store is empty, and does not stop when it cannot be read', async () => {
        expect((await start()).unreportedItemForgets.size).toBe(0);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        store.unreachable = true;
        const memory: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local', forgetQueue: store });
        await memory.forgetQueueReady;
        expect(memory.unreportedItemForgets.size).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not read the forgets kept in the shared store'));
        clearTimeout(memory.queueRestoreTimer);
        warn.mockRestore();
    });
});

describe('PersistentMemory: Forget is kept before it is promised, and stale data never brings it back (A31)', () => {
    let store: FakeForgetStore;
    const lofi = memoryItemKey('pref', null, 'lo-fi');
    const jazz = memoryItemKey('pref', null, 'jazz');
    const down = () => hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'down', response: { status: 503 } });
    const up = () => hoisted.axios.post.mockReset().mockResolvedValue({ data: {} });
    const contents = () => store.contents();
    const start = async () => {
        const memory: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local', forgetQueue: store });
        await memory.forgetQueueReady;
        memory.useHeard(() => heardInDm());
        memory.setUserUuid(BOT, SARA, 'uuid-sara', true);
        // Typed loosely on purpose: the tests reach into its private maps and timers
        return memory;
    };
    const told = () => hoisted.axios.post.mock.calls.filter((call) => String(call[0]).endsWith('/items'));
    /** What Orbit hands back after an archive is restored: everything the person had before the forget. */
    const restored = (preferences: string[], drawnAt?: number) => {
        const record = talkingRecord('uuid-sara', preferences);
        if (drawnAt) record.personalInfo.drawnFrom = Object.fromEntries(preferences.map((one) => [`pref:${one}`, drawnAt]));
        return record;
    };
    const load = async (memory: any, records: BotPlayerMemory[]) => {
        vi.spyOn(memory.memoryStorage, 'loadMemories').mockResolvedValue(records);
        await memory.loadMemories(BOT);
        return memory.loadedMemoriesByUuid.get(`${BOT}_uuid-sara`) as BotPlayerMemory;
    };

    beforeEach(() => {
        store = new FakeForgetStore();
    });

    it('writes the forget to the shared store before Orbit is told, so a crash while Orbit is being told still leaves it owed', async () => {
        const first = await start();
        first.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        let onDiskWhileTelling: Array<Record<string, unknown>> | null = null;
        // Orbit never answers: the process dies here
        hoisted.axios.post.mockReset().mockImplementation(() => {
            onDiskWhileTelling = contents().pending;
            return new Promise(() => undefined);
        });
        void first.forgetThingsReported(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        await new Promise((resolve) => setImmediate(resolve));
        expect(onDiskWhileTelling).toEqual([expect.objectContaining({ botId: BOT, userUuid: 'uuid-sara', itemKey: lofi })]);

        const second = await start();
        expect(second.unreportedItemForgets.size).toBe(1);
        up();
        await second.reportUnreportedForgets();
        expect(told()).toHaveLength(1);
        expect(contents().pending).toEqual([]);
        clearTimeout(second.unreportedRetryTimer);
    });

    it('tells the person the forget is kept only when the shared store was written', async () => {
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        expect(await memory.forgetThingsReported(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]))).toEqual({ went: 1, waiting: 1, durable: true });
        clearTimeout(memory.unreportedRetryTimer);

        // A shared store that cannot be written just now: a restart would lose it, and it is said so
        const other = await start();
        other.addMessage(BOT, SARA, 'I love jazz', 'person', 'dm');
        store.unreachable = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        down();
        expect(await other.forgetThingsReported(BOT, SARA, new Set([jazz]), new Map([[jazz, 'pref']]))).toEqual({ went: 1, waiting: 1, durable: false });
        clearTimeout(other.unreportedRetryTimer);
        warn.mockRestore();
    });

    it('writes what it could not write as soon as the shared store is back, and keeps trying meanwhile', async () => {
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        store.unreachable = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        down();
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(store.contents().pending).toEqual([]);
        // It is still owed in this process, and told to Orbit again
        expect(memory.unreportedItemForgets.size).toBe(1);
        store.unreachable = false;
        await memory.reportUnreportedForgets();
        // Orbit is still down, so it is still owed, and now written
        expect(store.contents().pending).toHaveLength(1);
        expect(store.contents().ledger).toHaveLength(1);
        clearTimeout(memory.unreportedRetryTimer);
        warn.mockRestore();
    });

    it('is seen by another bot server: what one wrote, the other reads before it loads memories and drops the thing from them', async () => {
        const first = await start();
        first.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        await first.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(first.unreportedRetryTimer);

        // A second server started before the forget, with nothing in the store then
        const empty = new FakeForgetStore();
        const second: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local', forgetQueue: empty });
        await second.forgetQueueReady;
        expect(second.unreportedItemForgets.size).toBe(0);
        // The forget reaches the shared store; the second server reads it when it next loads memories
        empty.pending = new Map(store.pending);
        empty.ledger = new Map(store.ledger);
        second.queueRefreshedAt = 0;
        vi.spyOn(second.memoryStorage, 'loadMemories').mockResolvedValue([first.cloneMemory(talkingRecord('uuid-sara', ['lo-fi', 'jazz']))]);
        await second.loadMemories(BOT);
        expect(second.loadedMemoriesByUuid.get(`${BOT}_uuid-sara`).personalInfo.preferences).toEqual(['jazz']);
        clearTimeout(second.unreportedRetryTimer);
    });

    it('does not bring back a forget Orbit took while the shared store was being read (Sentry)', async () => {
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(memory.unreportedRetryTimer);
        expect(store.contents().pending).toHaveLength(1);
        // A read of the store starts and will answer with what is there now
        const before = await store.load();
        let answer: () => void = () => undefined;
        vi.spyOn(store, 'load').mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve(before))));
        memory.queueRefreshedAt = 0;
        vi.spyOn(memory.memoryStorage, 'loadMemories').mockResolvedValue([]);
        const loading = memory.loadMemories(BOT);
        await new Promise((resolve) => setImmediate(resolve));
        // Meanwhile Orbit takes it
        up();
        await memory.reportUnreportedForgets();
        expect(memory.unreportedItemForgets.size).toBe(0);
        expect(store.contents().pending).toEqual([]);
        // The read answers with the older list: it must not put the thing back
        answer();
        await loading;
        expect(memory.unreportedItemForgets.size).toBe(0);
        await memory.reportUnreportedForgets();
        expect(told()).toHaveLength(1);
        expect(store.contents().pending).toEqual([]);
    });

    it('is quiet, and says it is kept in this process only, while there is no shared store at all; and uses it once it is there (Sentry)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        store.present = false;
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        expect(await memory.forgetThingsReported(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]))).toEqual({ went: 1, waiting: 1, durable: false });
        clearTimeout(memory.unreportedRetryTimer);
        // No complaint about a store that was never there, and nothing written to it
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('shared store'));
        expect(store.writes).toBe(0);
        // It is looked for again, and once it is there what is owed is written
        store.present = true;
        clearTimeout(memory.queueRestoreTimer);
        memory.queueRestoreTimer = null;
        await memory.restoreForgetQueue(false);
        await memory.queueWriting;
        expect(store.contents().pending).toHaveLength(1);
        clearTimeout(memory.unreportedRetryTimer);
        clearTimeout(memory.queueRestoreTimer);
        warn.mockRestore();
    });

    it('does not remove a later ask that another bot server stored when this one is told Orbit took its own (Sentry)', async () => {
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(memory.unreportedRetryTimer);
        const key = forgetKeyOf({ botId: BOT, userUuid: 'uuid-sara', itemKey: lofi });
        const mine = store.pending.get(key)!;
        // Another bot server was asked again, later, and wrote that
        store.pending.set(key, { ...mine, since: (mine.since as number) + 1000 });
        up();
        await memory.reportUnreportedForgets();
        // This server's own report was taken and let go here, but the later ask stays owed in the shared store
        expect(memory.unreportedItemForgets.size).toBe(0);
        expect(store.contents().pending).toEqual([expect.objectContaining({ itemKey: lofi, since: (mine.since as number) + 1000 })]);
    });

    it('keeps a later ask another bot server stored while the store was being read, when this one let go of an earlier ask', async () => {
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(memory.unreportedRetryTimer);
        const key = forgetKeyOf({ botId: BOT, userUuid: 'uuid-sara', itemKey: lofi });
        const mine = store.pending.get(key)!;
        const later = (mine.since as number) + 20_000;
        // A read of the store starts; another bot server was asked again and wrote the later ask, and the read answers with it
        const answered = { pending: [{ ...mine, since: later }], ledger: [] as never[] };
        let answer: () => void = () => undefined;
        vi.spyOn(store, 'load').mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve(answered as never))));
        memory.queueRefreshedAt = 0;
        vi.spyOn(memory.memoryStorage, 'loadMemories').mockResolvedValue([]);
        const loading = memory.loadMemories(BOT);
        await new Promise((resolve) => setImmediate(resolve));
        // Meanwhile Orbit takes this server's own, earlier ask
        up();
        await memory.reportUnreportedForgets();
        expect(memory.unreportedItemForgets.size).toBe(0);
        store.pending.set(key, { ...mine, since: later });
        answer();
        await loading;
        await memory.queueWriting;
        // The later ask was not taken by Orbit: it is still owed here, and still kept in the store
        expect(memory.unreportedItemForgets.get(key)?.since).toBe(later);
        expect(store.contents().pending).toEqual([expect.objectContaining({ itemKey: lofi, since: later })]);
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('writes a ledger entry again on the timer when the store was down, even when nothing is owed to Orbit', async () => {
        const memory = await start();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        store.unreachable = true;
        up();
        // Orbit's own list: the ledger entry is all there is to keep, and nothing is owed to Orbit
        memory.forgetItems(BOT, [{ id: 'forget-1', userUuid: 'uuid-sara', itemKey: lofi, at: 5000 }]);
        await memory.queueWriting;
        expect(memory.unreportedItemForgets.size).toBe(0);
        expect(store.contents().ledger).toEqual([]);
        // The timer is armed, so the write is tried again without anything else happening
        expect(memory.unreportedRetryTimer).not.toBeNull();
        clearTimeout(memory.unreportedRetryTimer);
        memory.unreportedRetryTimer = null;
        store.unreachable = false;
        await memory.reportUnreportedForgets();
        expect(store.contents().ledger).toEqual([expect.objectContaining({ itemKey: lofi, since: 5000 })]);
        expect(memory.unreportedRetryTimer).toBeNull();
        warn.mockRestore();
    });

    it('keeps what is waiting, and does not let it go, while this server has no way to tell Orbit', async () => {
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(memory.unreportedRetryTimer);
        expect(store.contents().pending).toHaveLength(1);
        // Another server (here, a new process) started without the service token reads what is waiting
        const saved = process.env.BOT_SERVICE_TOKEN;
        delete process.env.BOT_SERVICE_TOKEN;
        try {
            const other: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local', forgetQueue: store });
            await other.forgetQueueReady;
            expect(other.unreportedItemForgets.size).toBe(1);
            await other.reportUnreportedForgets();
            clearTimeout(other.unreportedRetryTimer);
            // It did not count as told: the entry is still here and still in the store for a server that can tell Orbit
            expect(other.unreportedItemForgets.size).toBe(1);
            expect(store.contents().pending).toHaveLength(1);
        } finally {
            process.env.BOT_SERVICE_TOKEN = saved;
        }
        up();
        await memory.reportUnreportedForgets();
        expect(told()).toHaveLength(1);
        expect(store.contents().pending).toEqual([]);
    });

    it('never overwrites what another bot server wrote: each thing is its own entry in the store', async () => {
        const one = await start();
        one.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        await one.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(one.unreportedRetryTimer);
        // Another server writes a different thing at the same time (it never read the first)
        store.pending.set('bot-b|uuid-other|k', { botId: 'bot-b', userUuid: 'uuid-other', itemKey: 'k', kind: 'pref', since: 5, first: 5 });
        one.addMessage(BOT, SARA, 'I love jazz', 'person', 'dm');
        const jazzKey = memoryItemKey('pref', null, 'jazz');
        await one.forgetThings(BOT, SARA, new Set([jazzKey]), new Map([[jazzKey, 'pref']]));
        clearTimeout(one.unreportedRetryTimer);
        expect(store.contents().pending.map((entry) => entry.itemKey).sort()).toEqual([jazzKey, lofi, 'k'].sort());
    });

    it('keeps trying through an Orbit outage and two restarts, and tells Orbit once when it is back', async () => {
        const first = await start();
        first.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        await first.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(first.unreportedRetryTimer);
        for (let restart = 0; restart < 2; restart++) {
            const again = await start();
            const [entry] = [...again.unreportedItemForgets.values()];
            entry.first = Date.now() - (restart + 3) * 24 * 60 * 60 * 1000;
            await again.reportUnreportedForgets();
            clearTimeout(again.unreportedRetryTimer);
            expect(contents().pending).toHaveLength(1);
        }
        const last = await start();
        up();
        await last.reportUnreportedForgets();
        expect(told()).toHaveLength(1);
        expect(contents().pending).toEqual([]);
        // Taken by Orbit, and still remembered here
        expect(contents().ledger).toEqual([expect.objectContaining({ botId: BOT, userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref' })]);
        clearTimeout(last.unreportedRetryTimer);
    });

    it('drops the thing again, and tells Orbit again, when an archive restore brings it back after Orbit had taken the forget', async () => {
        const first = await start();
        first.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        up();
        await first.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(contents().pending).toEqual([]);
        const [{ since }] = contents().ledger as Array<{ since: number }>;

        // The bot server restarts and Orbit, restored from an older archive, hands back a copy that still has it (and no record of the forget)
        const second = await start();
        hoisted.axios.post.mockClear();
        const back = await load(second, [restored(['lo-fi', 'jazz'], since - 5000)]);
        expect(back.personalInfo.preferences).toEqual(['jazz']);
        // Orbit lost its record: it is told again, with the time of the forget, and the shared store owes it until Orbit takes it
        expect(contents().pending).toEqual([expect.objectContaining({ itemKey: lofi, since })]);
        await second.reportUnreportedForgets();
        const retold = told();
        expect(retold).toHaveLength(1);
        expect(retold[0][1]).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref', at: since });
        expect(contents().pending).toEqual([]);
        clearTimeout(second.unreportedRetryTimer);
    });

    it('does not tell Orbit again about a restored copy that does not hold the thing, and keeps what the person said again afterwards', async () => {
        const first = await start();
        first.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        up();
        await first.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        const [{ since }] = contents().ledger as Array<{ since: number }>;

        const clean = await start();
        hoisted.axios.post.mockClear();
        expect((await load(clean, [restored(['jazz'], since - 5000)])).personalInfo.preferences).toEqual(['jazz']);
        expect(told()).toHaveLength(0);
        expect(contents().pending).toEqual([]);

        // Said again after the forget: it is a new thing and stays
        const said = await start();
        expect((await load(said, [restored(['lo-fi'], since + 5000)])).personalInfo.preferences).toEqual(['lo-fi']);
        expect(told()).toHaveLength(0);
        clearTimeout(clean.unreportedRetryTimer);
        clearTimeout(said.unreportedRetryTimer);
    });

    it('keeps a person\'s other things, and another person\'s lo-fi, when a restored copy is cleaned', async () => {
        const first = await start();
        first.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        up();
        await first.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        const second = await start();
        const other = talkingRecord('uuid-other', ['lo-fi', 'jazz']);
        vi.spyOn((second as any).memoryStorage, 'loadMemories').mockResolvedValue([restored(['lo-fi', 'jazz']), other]);
        await second.loadMemories(BOT);
        const loaded = (key: string) => (second as any).loadedMemoriesByUuid.get(`${BOT}_${key}`) as BotPlayerMemory;
        expect(loaded('uuid-sara').personalInfo.preferences).toEqual(['jazz']);
        expect(loaded('uuid-other').personalInfo.preferences).toEqual(['lo-fi', 'jazz']);
        expect(memoryItemsOf(loaded('uuid-sara')).map((item) => item.id)).toEqual([jazz]);
        clearTimeout(second.unreportedRetryTimer);
    });

    it('also remembers what a person forgot in their list in Orbit, for an older copy that comes back', async () => {
        const first = await start();
        first.forgetItems(BOT, [{ id: 'forget-1', userUuid: 'uuid-sara', itemKey: lofi, at: 5000 }]);
        clearTimeout(first.unreportedRetryTimer);
        await first.queueWriting;
        expect(contents().ledger).toEqual([expect.objectContaining({ itemKey: lofi, since: 5000 })]);
        const second = await start();
        expect((await load(second, [restored(['lo-fi', 'jazz'], 1000)])).personalInfo.preferences).toEqual(['jazz']);
        clearTimeout(second.unreportedRetryTimer);
    });

    it('drops the thing from a save that was waiting for the person in another chat, so nothing is saved back', async () => {
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        const other = talkingRecord('uuid-sara', ['lo-fi', 'jazz']);
        (memory as any).pendingSaves.set(`${BOT}_99`, { ...other, playerId: 99 });
        (memory as any).uuidTracking.set(`${BOT}_99`, { userUuid: 'uuid-sara', isLogged: true });
        up();
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect((memory as any).pendingSaves.get(`${BOT}_99`).personalInfo.preferences).toEqual(['jazz']);
        for (const timer of (memory as any).debounceTimers.values()) clearTimeout(timer);
    });

    it('forgets everything it kept about a Brick that is deleted for good', async () => {
        const memory = await start();
        memory.addMessage(BOT, SARA, 'I love lo-fi', 'person', 'dm');
        down();
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(memory.unreportedRetryTimer);
        expect(contents().ledger).toHaveLength(1);
        memory.purgeForgottenFor('another-bot');
        await memory.queueWriting;
        expect(contents().ledger).toHaveLength(1);
        memory.purgeForgottenFor(BOT);
        await memory.queueWriting;
        expect(contents()).toMatchObject({ pending: [], ledger: [] });
        expect((await start()).unreportedItemForgets.size).toBe(0);
    });

    it('starts from a store that holds waiting forgets and no ledger', async () => {
        store.pending.set(forgetKeyOf({ botId: BOT, userUuid: 'uuid-sara', itemKey: lofi }), { botId: BOT, userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref', since: 5, first: 4 });
        const memory = await start();
        expect(memory.unreportedItemForgets.size).toBe(1);
        expect(memory.forgottenLedger.size).toBe(0);
        clearTimeout(memory.unreportedRetryTimer);
    });
});

/** A saved memory of one person, as Orbit hands it back: their preferences and nothing said in this process. */
function talkingRecord(userUuid: string, preferences: string[]): BotPlayerMemory {
    const memory = new ConversationMemory();
    memory.addMessage(BOT, SARA, 'hello', 'person');
    const record = memory.getMemory(BOT, SARA)!;
    record.userUuid = userUuid;
    record.personalInfo.preferences = preferences;
    return record;
}

describe('BotPlayerMemory copies', () => {
    it('keeps its own copy of when each thing was said', () => {
        const memory: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local' });
        const original = {
            ...(new ConversationMemory() as any).getOrCreateMemory(BOT, SARA),
        } as BotPlayerMemory;
        original.personalInfo.drawnFrom = { name: 5 };
        const copy = memory.cloneMemory(original);
        copy.personalInfo.drawnFrom.name = 9;
        expect(original.personalInfo.drawnFrom?.name).toBe(5);
    });
});
