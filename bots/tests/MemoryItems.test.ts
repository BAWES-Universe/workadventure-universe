/**
 * What a bot remembers about a person, one thing at a time, and Forget (game #2003). The keys are the same values Orbit
 * tests: a person names a thing by its key in their list there, and the bot server must find the same thing by it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hoisted = vi.hoisted(() => ({
    axios: { get: vi.fn(), post: vi.fn(), put: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError },
}));
vi.mock('axios', () => ({ default: hoisted.axios, ...hoisted.axios }));

import { ConversationMemory, type BotPlayerMemory } from '../memory/ConversationMemory';
import { PersistentMemory } from '../memory/PersistentMemory';
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
        return memory as PersistentMemory & Record<string, any>;
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
        expect(body).toEqual({ itemIds: ['f1'] });
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
        expect(first).toEqual({ went: 1, waiting: 1 });
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

describe('PersistentMemory: a forget Orbit has not taken survives a restart (#2031)', () => {
    let dir: string;
    let file: string;
    const lofi = memoryItemKey('pref', null, 'lo-fi');
    const down = () => hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'down', response: { status: 503 } });
    const up = () => hoisted.axios.post.mockReset().mockResolvedValue({ data: {} });
    const saved = () => JSON.parse(readFileSync(file, 'utf8')).pending as Array<Record<string, unknown>>;
    const start = () => {
        const memory: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local', forgetQueueFile: file });
        memory.useHeard(() => heardInDm());
        return memory as PersistentMemory & Record<string, any>;
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
        dir = mkdtempSync(join(tmpdir(), 'forget-queue-'));
        file = join(dir, 'state', 'pending-forgets.json');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('writes a forget Orbit did not take to the file, and a new process finds it and tells Orbit', async () => {
        const first = start();
        await forgetWhileDown(first);
        clearTimeout(first.unreportedRetryTimer);
        expect(saved()).toEqual([expect.objectContaining({ botId: BOT, userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref' })]);

        // The bot server restarts: a new process, the same file
        const second = start();
        expect(second.unreportedItemForgets.size).toBe(1);
        up();
        await second.reportUnreportedForgets();
        const told = hoisted.axios.post.mock.calls.filter((call) => String(call[0]).endsWith('/items'));
        expect(told).toHaveLength(1);
        expect(told[0][1]).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref', at: expect.any(Number) });
        // Orbit took it: it is no longer waiting, in this process or in the file
        expect(second.unreportedItemForgets.size).toBe(0);
        expect(saved()).toEqual([]);
        clearTimeout(second.unreportedRetryTimer);
    });

    it('keeps it through a day of outage and a second restart', async () => {
        const first = start();
        await forgetWhileDown(first);
        clearTimeout(first.unreportedRetryTimer);
        const later = start();
        const [entry] = [...later.unreportedItemForgets.values()];
        entry.first = Date.now() - 3 * 24 * 60 * 60 * 1000;
        await later.reportUnreportedForgets();
        clearTimeout(later.unreportedRetryTimer);
        expect(saved()).toHaveLength(1);
        expect(start().unreportedItemForgets.size).toBe(1);
    });

    it('drops the thing again from what Orbit still has saved when the memories are loaded after the restart', async () => {
        const first = start();
        await forgetWhileDown(first);
        clearTimeout(first.unreportedRetryTimer);

        const second = start();
        clearTimeout(second.unreportedRetryTimer);
        // Orbit never heard of the forget, so what it saved still holds lo-fi
        const stale = first.cloneMemory(talkingRecord('uuid-sara', ['lo-fi', 'jazz']));
        vi.spyOn((second as any).memoryStorage, 'loadMemories').mockResolvedValue([stale]);
        await second.loadMemories(BOT);
        const loaded = (second as any).loadedMemoriesByUuid.get(`${BOT}_uuid-sara`);
        expect(loaded.personalInfo.preferences).toEqual(['jazz']);
    });

    it('keeps the latest ask when the same thing is forgotten twice while Orbit is down', async () => {
        const memory = start();
        await forgetWhileDown(memory);
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        clearTimeout(memory.unreportedRetryTimer);
        const rows = saved();
        expect(rows).toHaveLength(1);
        expect(rows[0].since as number).toBeGreaterThanOrEqual(rows[0].first as number);
    });

    it('lets go of one Orbit refuses for good, and says so', async () => {
        const memory = start();
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

    it('starts with nothing waiting when the file is missing or damaged', () => {
        expect(existsSync(file)).toBe(false);
        expect(start().unreportedItemForgets.size).toBe(0);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        writeFileSync(join(dir, 'broken.json'), '{ not json');
        const memory: any = new PersistentMemory({ adminApiUrl: 'http://orbit.local', forgetQueueFile: join(dir, 'broken.json') });
        expect(memory.unreportedItemForgets.size).toBe(0);
        warn.mockRestore();
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
            ...new ConversationMemory().getOrCreateMemory(BOT, SARA),
        } as BotPlayerMemory;
        original.personalInfo.drawnFrom = { name: 5 };
        const copy = memory.cloneMemory(original);
        copy.personalInfo.drawnFrom.name = 9;
        expect(original.personalInfo.drawnFrom?.name).toBe(5);
    });
});
