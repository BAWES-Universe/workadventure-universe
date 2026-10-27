/**
 * A bot's memory of a person follows the person, not the chat: what they said in a bubble on the map is there when
 * they send a direct message, and the other way round, in the same bot process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PersistentMemory } from '../memory/PersistentMemory';

const BOT = 'bot-1';
const UUID = 'friend-uuid';
const MAP_PLAYER = 7;
const DM_PLAYER = -1;

function history(memory: PersistentMemory, playerId: number): string[] {
    return (memory.getMemory(BOT, playerId)?.conversationHistory ?? []).map((m) => m.message);
}

describe('PersistentMemory: memory follows the person across the map and direct messages', () => {
    let memory: PersistentMemory;

    beforeEach(() => {
        vi.useFakeTimers();
        memory = new PersistentMemory({ adminApiUrl: 'http://orbit.local', immediateSaveEnabled: false });
        // Nothing reaches Orbit in these tests
        vi.spyOn(memory.getMemoryStorage(), 'saveMemory').mockResolvedValue(undefined as never);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function chatOnMap(lines: Array<[string, 'person' | 'bot']>): void {
        memory.setUserUuid(BOT, MAP_PLAYER, UUID, true);
        for (const [line, sender] of lines) {
            vi.advanceTimersByTime(1000);
            memory.addMessage(BOT, MAP_PLAYER, line, sender, 'bubble-space');
        }
    }

    it('a first direct message after a first chat on the map remembers the chat', () => {
        // A new bot: no saved memory of anyone yet
        chatOnMap([
            ['What do you think of Tinyfish for scraping?', 'person'],
            ['It handles login walls well, but it is slow.', 'bot'],
        ]);

        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);

        expect(history(memory, DM_PLAYER)).toEqual([
            'What do you think of Tinyfish for scraping?',
            'It handles login walls well, but it is slow.',
        ]);
    });

    it('a direct message chat that already started picks up what was said on the map since', () => {
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, DM_PLAYER, 'hi', 'person', 'matrix-dm');
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, DM_PLAYER, 'Hey!', 'bot', 'matrix-dm');

        chatOnMap([
            ['Can you compare Tinyfish and Tavily?', 'person'],
            ['Tavily is faster for search, Tinyfish for browsing.', 'bot'],
        ]);

        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);

        expect(history(memory, DM_PLAYER)).toEqual([
            'hi',
            'Hey!',
            'Can you compare Tinyfish and Tavily?',
            'Tavily is faster for search, Tinyfish for browsing.',
        ]);
    });

    it('walking up to the bot after a direct message remembers the direct message', () => {
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, DM_PLAYER, 'Remind me to look at Tavily pricing', 'person', 'matrix-dm');
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, DM_PLAYER, 'Will do.', 'bot', 'matrix-dm');

        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, MAP_PLAYER, UUID, true);

        expect(history(memory, MAP_PLAYER)).toEqual(['Remind me to look at Tavily pricing', 'Will do.']);
    });

    it("keeps as many lines as the bot's replies read when chats are merged", () => {
        memory.setHistoryWindow(BOT, 100);
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);
        for (let i = 0; i < 70; i++) {
            vi.advanceTimersByTime(1000);
            memory.addMessage(BOT, DM_PLAYER, `dm ${i}`, 'person', 'matrix-dm');
        }
        chatOnMap([['on the map', 'person']]);

        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);

        const lines = history(memory, DM_PLAYER);
        expect(lines).toHaveLength(71);
        expect(lines[0]).toBe('dm 0');
        expect(lines.at(-1)).toBe('on the map');
    });

    it('brings in every other chat of the person, not only the newest', () => {
        const OTHER_TAB = 8;
        // Two tabs open at once, each with its own chat
        memory.setUserUuid(BOT, OTHER_TAB, UUID, true);
        chatOnMap([['said in one tab', 'person']]);
        vi.advanceTimersByTime(1000);
        memory.addMessage(BOT, OTHER_TAB, 'said in another tab', 'person', 'bubble-space');

        vi.advanceTimersByTime(60_000);
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);

        expect(history(memory, DM_PLAYER)).toEqual(['said in one tab', 'said in another tab']);
    });

    it('keeps two different lines said in the same millisecond, and a line with a vision note once', () => {
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);
        memory.addMessage(BOT, DM_PLAYER, 'look at this', 'person', 'matrix-dm');
        chatOnMap([]);
        // Same millisecond as the map lines below
        memory.addMessage(BOT, MAP_PLAYER, 'first', 'bot', 'bubble-space');
        memory.addMessage(BOT, MAP_PLAYER, 'second', 'bot', 'bubble-space');
        memory.appendVisionDescription(BOT, DM_PLAYER, 'a cat');

        // The map chat started with the line before its vision note; both chats end with the noted copy, once
        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);
        memory.setUserUuid(BOT, MAP_PLAYER, UUID, true);

        const dm = history(memory, DM_PLAYER);
        expect(dm.filter((line) => line.startsWith('look at this'))).toHaveLength(1);
        expect(dm).toEqual(expect.arrayContaining(['first', 'second']));
        const map = history(memory, MAP_PLAYER);
        expect(map.filter((line) => line.startsWith('look at this'))).toEqual([expect.stringContaining('a cat')]);
        expect(map).toEqual(expect.arrayContaining(['first', 'second']));
    });

    it("never hands one person's chat to someone else", () => {
        chatOnMap([['my secret plan', 'person']]);
        memory.setUserUuid(BOT, DM_PLAYER, 'someone-else', true);
        expect(history(memory, DM_PLAYER)).toEqual([]);
    });
});

describe('PersistentMemory: a copy of a memory for another chat', () => {
    it("never shares the turn being answered with the chat it was copied from", () => {
        const memory = new PersistentMemory({ adminApiUrl: 'http://orbit.local', immediateSaveEnabled: false });
        vi.spyOn(memory.getMemoryStorage(), 'saveMemory').mockResolvedValue(undefined as never);
        memory.setUserUuid(BOT, MAP_PLAYER, UUID, true);
        memory.addMessage(BOT, MAP_PLAYER, 'make me a page', 'person', 'bubble-space');
        const onMap = memory.getMemory(BOT, MAP_PLAYER)!;
        onMap.artifactCalls = new Map([['make|{}', { id: 'a1' }]]);

        memory.setUserUuid(BOT, DM_PLAYER, UUID, true);
        const inDm = memory.getMemory(BOT, DM_PLAYER)!;

        expect(inDm.artifactCalls).toBeUndefined();
        expect(onMap.artifactCalls.size).toBe(1);
        vi.restoreAllMocks();
    });
});
