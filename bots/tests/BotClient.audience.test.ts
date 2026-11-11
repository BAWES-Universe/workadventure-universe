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

describe('BotManager: where a line is heard', () => {
    function manager() {
        const admin = { isConfigured: () => false };
        const botManager = new BotManager(admin as never, {} as never);
        const client = { heardIn: vi.fn(() => ({ place: 'nearby', with: ['uuid-sara'] })) };
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
});
