/**
 * Who would read a reply (game #1993): a group is anyone else in the bubble or meeting room, whether a person, a guest or
 * another bot. The bot's client knows it from what the game says about the space, never from distance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotClient } from '../client/BotClient';
import { BotManager } from '../server/BotManager';
import { SOMEONE_UNKNOWN } from '../memory/Heard';
import { SpaceAudience } from '../client/SpaceAudience';

const SPACE = 'bubble-space';
const ME = 'room-1_12';
const KHALID = { spaceUserId: 'room-1_7', uuid: 'uuid-khalid', name: 'Khalid', tags: [] };
const SARA = { spaceUserId: 'room-1_9', uuid: 'uuid-sara', name: 'Sara', tags: [] };
const GUEST = { spaceUserId: 'room-1_10', uuid: 'guest-uuid', name: 'Visitor', tags: [], isLogged: false };
const OTHER_BOT = { spaceUserId: 'room-1_11', uuid: 'bot-other', name: 'Linear', tags: ['bot'] };

function setup() {
    const bot = new BotClient({
        botId: 'bot-test',
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    Object.assign(bot as unknown as { send: unknown }, { send: vi.fn() });
    const internals = bot as unknown as { spaces: Map<string, string>; userId: number };
    internals.spaces.set(SPACE, ME);
    internals.userId = 12;
    const receive = (message: unknown) => (bot as unknown as { handleSubMessage(m: unknown): Promise<void> }).handleSubMessage(message);
    const init = (users: unknown[], spaceName = SPACE) => receive({ $case: 'initSpaceUsersMessage', initSpaceUsersMessage: { spaceName, users } });
    const join = (user: unknown, spaceName = SPACE) => receive({ $case: 'addSpaceUserMessage', addSpaceUserMessage: { spaceName, user } });
    const leave = (spaceUserId: string, spaceName = SPACE) => receive({ $case: 'removeSpaceUserMessage', removeSpaceUserMessage: { spaceName, spaceUserId } });
    return { bot, internals, init, join, leave };
}

describe('BotClient: who else is in the space', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sees a person alone with it as alone: the bot itself and the person do not count', async () => {
        const { bot, init } = setup();
        await init([{ spaceUserId: ME, uuid: 'bot-bot-test', tags: ['bot'] }, KHALID]);

        expect(bot.othersWith(SPACE, 7)).toEqual([]);
        expect(bot.heardIn(SPACE, 7)).toEqual({ place: 'nearby', with: [] });
    });

    it('counts a second person from the moment the game says they joined, and no longer once they left', async () => {
        const { bot, init, join, leave } = setup();
        await init([KHALID]);
        await join(SARA);

        expect(bot.othersWith(SPACE, 7)).toEqual(['uuid-sara']);
        expect(bot.othersWith(SPACE, 9)).toEqual(['uuid-khalid']);
        expect(bot.heardIn(SPACE, 7)).toEqual({ place: 'nearby', with: ['uuid-sara'] });

        await leave(SARA.spaceUserId);
        expect(bot.othersWith(SPACE, 7)).toEqual([]);
    });

    it('counts a guest and another bot like anyone else', async () => {
        const { bot, init } = setup();
        await init([KHALID, GUEST, OTHER_BOT]);

        expect(bot.othersWith(SPACE, 7)).toEqual(['guest-uuid', 'bot-other']);
    });

    it('cannot name someone the game gives no id for, so nothing is ever open to them', async () => {
        const { bot, init } = setup();
        await init([KHALID, { spaceUserId: 'room-1_15', name: 'Nobody', tags: [] }]);

        expect(bot.othersWith(SPACE, 7)).toEqual([SOMEONE_UNKNOWN]);
    });

    it('does not say who is in a space it is not in, or was told nothing about', async () => {
        const { bot, init, internals } = setup();
        expect(bot.othersWith(SPACE, 7)).toBeUndefined();
        expect(bot.heardIn(SPACE, 7)).toBeUndefined();

        await init([KHALID, SARA], 'elsewhere');
        expect(bot.othersWith('elsewhere', 7)).toBeUndefined();
        internals.spaces.set('elsewhere', 'room-2_12');
        expect(bot.othersWith('elsewhere', 7)).toEqual(['uuid-sara']);
    });

    it('keeps each space to itself', async () => {
        const { bot, init, internals } = setup();
        internals.spaces.set('meeting-room', 'room-1_12');
        await init([KHALID]);
        await init([KHALID, SARA], 'meeting-room');

        expect(bot.othersWith(SPACE, 7)).toEqual([]);
        expect(bot.othersWith('meeting-room', 7)).toEqual(['uuid-sara']);
    });

    it('forgets who was there when it leaves the space or disconnects', async () => {
        const { bot, init } = setup();
        await init([KHALID, SARA]);
        (bot as unknown as { audience: SpaceAudience }).audience.spaceLeft(SPACE);
        expect(bot.othersWith(SPACE, 7)).toBeUndefined();

        await init([KHALID, SARA]);
        bot.disconnect();
        expect(bot.othersWith(SPACE, 7)).toBeUndefined();
    });

    it('sees an empty space as empty, not as unknown', async () => {
        const { bot, init } = setup();
        await init([]);
        expect(bot.othersWith(SPACE, 7)).toEqual([]);
    });
});

describe("BotClient: a person's chat address, as the game vouches for it", () => {
    const WORLD = 'allWorldUser';
    const KHALID_CHAT = '@khalid:matrix.test';

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function world() {
        const scene = setup();
        scene.internals.spaces.set(WORLD, 'world_12');
        const update = (user: unknown, spaceName = WORLD) =>
            (scene.bot as unknown as { handleSubMessage(m: unknown): Promise<void> }).handleSubMessage({ $case: 'updateSpaceUserMessage', updateSpaceUserMessage: { spaceName, user } });
        return { ...scene, update };
    }

    it('knows it from who the game lists, who joins, and what the game says a moment later', async () => {
        const { bot, init, join, update } = world();
        await init([{ spaceUserId: 'world_7', chatID: KHALID_CHAT }, { spaceUserId: 'world_10' }], WORLD);
        expect(bot.chatIdOf(7)).toBe(KHALID_CHAT);
        expect(bot.chatIdOf(10)).toBeUndefined();

        await join({ spaceUserId: 'world_9', chatID: '@sara:matrix.test' }, WORLD);
        expect(bot.chatIdOf(9)).toBe('@sara:matrix.test');

        // Their browser proved its chat login after they joined
        await update({ spaceUserId: 'world_10', chatID: '@late:matrix.test' });
        expect(bot.chatIdOf(10)).toBe('@late:matrix.test');
    });

    it('keeps it while they walk in and out of a bubble, and through an update that does not carry it', async () => {
        const { bot, init, join, leave, update } = world();
        await init([{ spaceUserId: 'world_7', chatID: KHALID_CHAT }], WORLD);
        await join(KHALID);
        await update({ spaceUserId: 'world_7' });
        await leave(KHALID.spaceUserId);
        expect(bot.chatIdOf(7)).toBe(KHALID_CHAT);
    });

    it('never gives a number someone new got the address of whoever had it before', async () => {
        const { bot, init, join, leave } = world();
        await init([{ spaceUserId: 'world_7', chatID: KHALID_CHAT }], WORLD);
        await leave('world_7', WORLD);
        expect(bot.chatIdOf(7)).toBeUndefined();

        await init([{ spaceUserId: 'world_7', chatID: KHALID_CHAT }], WORLD);
        // A guest joins the world under the same number before the bot saw the other one go
        await join({ spaceUserId: 'world_7' }, WORLD);
        expect(bot.chatIdOf(7)).toBeUndefined();
    });

    it('has none for itself, and none once it disconnects', async () => {
        const { bot, init } = world();
        await init([{ spaceUserId: 'world_12', chatID: '@bot_bot-test:matrix.test' }, { spaceUserId: 'world_7', chatID: KHALID_CHAT }], WORLD);
        expect(bot.chatIdOf(12)).toBeUndefined();
        bot.disconnect();
        expect(bot.chatIdOf(7)).toBeUndefined();
    });

    it('reads it from whoever taps on a reply, and passes "Continue privately" on with who the game says they are', async () => {
        const { bot, init, internals } = world();
        await init([KHALID]);
        const tap = vi.fn();
        (internals as unknown as { asks: unknown }).asks = { tap, personBack: vi.fn() };
        const event = (sender: unknown, receiverUserId = ME) =>
            (bot as unknown as { handleSubMessage(m: unknown): Promise<void> }).handleSubMessage({
                $case: 'privateEvent',
                privateEvent: { spaceName: SPACE, receiverUserId, sender, spaceEvent: { event: { $case: 'botAskAnswer', botAskAnswer: { askId: 'p1', revision: 0, tap: '{"action":"continue","room":"!dm:matrix.test"}' } } } },
            });

        await event({ ...KHALID, chatID: KHALID_CHAT });
        expect(bot.chatIdOf(7)).toBe(KHALID_CHAT);
        expect(tap).toHaveBeenCalledWith(bot, SPACE, 7, expect.objectContaining({ askId: 'p1' }));

        // Another bot, or an event not sent to this bot, is no tap and vouches for nothing
        tap.mockClear();
        await event({ ...OTHER_BOT, chatID: '@x:matrix.test' });
        await event({ ...SARA, chatID: '@sara:matrix.test' }, 'room-1_99');
        expect(tap).not.toHaveBeenCalled();
        expect(bot.chatIdOf(11)).toBeUndefined();
        expect(bot.chatIdOf(9)).toBeUndefined();
    });
});

describe('BotManager: where a line is heard', () => {
    function manager() {
        const admin = { isConfigured: () => false };
        const botManager = new BotManager(admin as never, {} as never);
        const client = { heardIn: vi.fn(() => ({ place: 'nearby', with: ['uuid-sara'] })), saidIn: vi.fn(() => ({ place: 'nearby', with: [] })) };
        (botManager as unknown as { bots: Map<string, unknown> }).bots.set('b1', { botId: 'b1', client, status: 'connected' });
        return { botManager, client };
    }

    it('a direct message is heard by nobody else, whatever the map looks like', () => {
        const { botManager, client } = manager();
        expect(botManager.whoHeard('b1', -1, 'matrix-dm')).toEqual({ place: 'dm', with: [] });
        expect(client.heardIn).not.toHaveBeenCalled();
    });

    it('a line on the map is heard by whoever the bot sees in that space', () => {
        const { botManager, client } = manager();
        expect(botManager.whoHeard('b1', 7, SPACE)).toEqual({ place: 'nearby', with: ['uuid-sara'] });
        expect(client.heardIn).toHaveBeenCalledWith(SPACE, 7);
    });

    it('a bot that is not running cannot say: the line is kept as private', () => {
        const { botManager } = manager();
        expect(botManager.whoHeard('gone', 7, SPACE)).toBeUndefined();
    });

    it('tells the memory, so every line it keeps is stamped', () => {
        const { botManager } = manager();
        const memory = botManager.getConversationMemory();
        memory.addMessage('b1', 7, 'The demo is on Thursday', 'person', SPACE);
        memory.addMessage('b1', -1, 'my interview is at 10', 'person', 'matrix-dm');

        expect(memory.getMemory('b1', 7)!.conversationHistory[0].heard).toEqual({ place: 'nearby', with: ['uuid-sara'] });
        expect(memory.getMemory('b1', -1)!.conversationHistory[0].heard).toEqual({ place: 'dm', with: [] });
    });

    it("the bot's own line is heard by whoever its reply went to, not by whoever is there now", () => {
        const { botManager, client } = manager();
        // The reply went to its person alone; Sara walked up while it was written
        expect(botManager.whoHeard('b1', 7, SPACE, 'bot')).toEqual({ place: 'nearby', with: [] });
        expect(client.saidIn).toHaveBeenCalledWith(SPACE, 7);
        expect(client.heardIn).not.toHaveBeenCalled();
        // What the person says is heard by everyone there
        expect(botManager.whoHeard('b1', 7, SPACE, 'person')).toEqual({ place: 'nearby', with: ['uuid-sara'] });
        expect(botManager.whoHeard('b1', -1, 'matrix-dm', 'bot')).toEqual({ place: 'dm', with: [] });
    });

    it('stamps a reply that went to its person alone as said with nobody else there', () => {
        const { botManager } = manager();
        const memory = botManager.getConversationMemory();
        memory.addMessage('b1', 7, 'when is my interview?', 'person', SPACE);
        memory.addMessage('b1', 7, 'Your interview is at 10.', 'bot', SPACE);

        const [asked, answered] = memory.getMemory('b1', 7)!.conversationHistory;
        expect(asked.heard).toEqual({ place: 'nearby', with: ['uuid-sara'] });
        expect(answered.heard).toEqual({ place: 'nearby', with: [] });
    });
});
