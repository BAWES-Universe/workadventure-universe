/**
 * What a bot remembers about a person, one thing at a time, and Forget (game #2003). The keys are the same values Orbit
 * tests: a person names a thing by its key in their list there, and the bot server must find the same thing by it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        expect(body).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref' });
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
        expect(told[1][1]).toEqual({ userUuid: 'uuid-sara', itemKey: lofi, kind: 'pref' });
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

    it('lets go a forget that Orbit refuses for good, but keeps one it only could not take yet', async () => {
        const memory = held();
        // A busy Orbit or a refused token is tried again
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'busy', response: { status: 503 } });
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        expect(memory.unreportedItemForgets.size).toBe(1);
        // A Brick that is gone (404) can never take it: nothing left to tell
        hoisted.axios.post.mockReset().mockRejectedValue({ isAxiosError: true, message: 'gone', response: { status: 404 } });
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(0);
        clearTimeout(memory.unreportedRetryTimer);
    });

    it('gives up on a forget Orbit has not taken in a day', async () => {
        const memory = held();
        hoisted.axios.post.mockReset().mockRejectedValue(new Error('Orbit is down'));
        await memory.forgetThings(BOT, SARA, new Set([lofi]), new Map([[lofi, 'pref']]));
        const [entry] = [...memory.unreportedItemForgets.values()];
        entry.since = Date.now() - 25 * 60 * 60 * 1000;
        await memory.reportUnreportedForgets(BOT);
        expect(memory.unreportedItemForgets.size).toBe(0);
        clearTimeout(memory.unreportedRetryTimer);
    });
});

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
