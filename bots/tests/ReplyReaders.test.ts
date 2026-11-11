/**
 * A reply written for someone who is alone with the bot is delivered to them and nobody else (game #1993), to its last
 * piece: someone who walks up while it is being written is sent none of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotClient } from '../client/BotClient';
import { ReplyReaders, playerOfReply } from '../client/ReplyReaders';

const SPACE = 'bubble-space';
const ME = 'room-1_12';
const KHALID = { spaceUserId: 'room-1_7', uuid: 'uuid-khalid', name: 'Khalid', tags: [] };
const SARA = { spaceUserId: 'room-1_9', uuid: 'uuid-sara', name: 'Sara', tags: [] };
const REPLY = 'bot-bot-test-player-7-0b0e';

describe('ReplyReaders', () => {
    const now = (alone: boolean) => ({ alone: vi.fn(() => alone), spaceUserIdOf: (playerId: number) => `room-1_${playerId}` });

    it('reads the person a reply is for from its id', () => {
        expect(playerOfReply(REPLY)).toBe(7);
        expect(playerOfReply('bot-bot-test-greeting-player-21-abc')).toBe(21);
        expect(playerOfReply('bot-bot-test-player-7-steps-abc')).toBe(7);
        expect(playerOfReply('bot-bot-test-say-abc')).toBeUndefined();
    });

    it('binds a reply to its one reader when the turn started with them alone, whoever comes meanwhile', () => {
        const readers = new ReplyReaders();
        readers.starts(SPACE, 7, true);
        const asked = now(false);

        expect(readers.readerOf(SPACE, REPLY, asked)).toBe('room-1_7');
        // The turn said: nobody is asked how things are now
        expect(asked.alone).not.toHaveBeenCalled();
        // A later turn in a group does not change a reply already under way
        readers.starts(SPACE, 7, false);
        expect(readers.readerOf(SPACE, REPLY, now(false))).toBe('room-1_7');
        expect(readers.readerOf(SPACE, 'bot-bot-test-player-7-next', now(false))).toBeUndefined();
    });

    it('sends a reply built for a group to everyone, also when the others have left since', () => {
        const readers = new ReplyReaders();
        readers.starts(SPACE, 7, false);
        expect(readers.readerOf(SPACE, REPLY, now(true))).toBeUndefined();
        expect(readers.readerOf(SPACE, REPLY, now(true))).toBeUndefined();
    });

    it('goes by who is there now for a line no turn spoke for, and for everyone when it names no person', () => {
        const readers = new ReplyReaders();
        expect(readers.readerOf(SPACE, REPLY, now(true))).toBe('room-1_7');
        expect(readers.readerOf(SPACE, 'bot-bot-test-player-9-x', now(false))).toBeUndefined();
        expect(readers.readerOf(SPACE, 'bot-bot-test-say-abc', now(true))).toBeUndefined();
    });

    it('keeps each space and person to themselves, and decides afresh once they have left', () => {
        const readers = new ReplyReaders();
        readers.starts(SPACE, 7, true);
        expect(readers.readerOf('elsewhere', 'bot-bot-test-player-7-a', now(false))).toBeUndefined();
        expect(readers.readerOf(SPACE, 'bot-bot-test-player-9-b', now(false))).toBeUndefined();

        readers.personLeft(SPACE, 7);
        expect(readers.readerOf(SPACE, 'bot-bot-test-player-7-c', now(false))).toBeUndefined();
    });

    it('names the replies that are for one reader in a space, and forgets a space the bot left', () => {
        const readers = new ReplyReaders();
        readers.starts(SPACE, 7, true);
        readers.readerOf(SPACE, REPLY, now(true));
        readers.readerOf(SPACE, 'bot-bot-test-say-abc', now(true));
        expect(readers.forOneReaderIn(SPACE)).toEqual([REPLY]);
        expect(readers.forOneReaderIn('elsewhere')).toEqual([]);

        readers.spaceLeft(SPACE);
        expect(readers.forOneReaderIn(SPACE)).toEqual([]);
    });
});

describe('BotClient: who a reply is sent to', () => {
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
        const send = vi.fn();
        Object.assign(bot as unknown as { send: unknown }, { send });
        const internals = bot as unknown as { spaces: Map<string, string>; userId: number; speech: unknown };
        internals.spaces.set(SPACE, ME);
        internals.userId = 12;
        const receive = (message: unknown) => (bot as unknown as { handleSubMessage(m: unknown): Promise<void> }).handleSubMessage(message);
        const init = (users: unknown[]) => receive({ $case: 'initSpaceUsersMessage', initSpaceUsersMessage: { spaceName: SPACE, users } });
        const join = (user: unknown) => receive({ $case: 'addSpaceUserMessage', addSpaceUserMessage: { spaceName: SPACE, user } });
        /** What went into the space: each stream piece, with who it is for. */
        const sent = () =>
            send.mock.calls
                .map((call) => call[0]?.message?.publicEvent?.spaceEvent?.event?.spaceStreamMessage)
                .filter(Boolean)
                .map((piece) => ({ token: piece.token, final: piece.finalContent, onlyFor: piece.onlyFor, stopped: piece.stoppedBySpeech }));
        return { bot, internals, init, join, sent };
    }

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends every piece of a reply started alone to that person only, also after someone walks up', async () => {
        const { bot, init, join, sent } = setup();
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        bot.sendStreamMessage(SPACE, REPLY, 'Your interview ', false);

        await join(SARA);
        bot.sendStreamMessage(SPACE, REPLY, 'is at 10.', false);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');

        expect(sent()).toEqual([
            { token: 'Your interview ', final: undefined, onlyFor: 'room-1_7', stopped: undefined },
            { token: 'is at 10.', final: undefined, onlyFor: 'room-1_7', stopped: undefined },
            { token: '', final: 'Your interview is at 10.', onlyFor: 'room-1_7', stopped: undefined },
        ]);
    });

    it('keeps to what the turn said when someone walked up before the first piece went out', async () => {
        const { bot, init, join, sent } = setup();
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        await join(SARA);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');

        expect(sent()[0].onlyFor).toBe('room-1_7');
    });

    it('sends a reply built for the group to everyone', async () => {
        const { bot, init, sent } = setup();
        await init([KHALID, SARA]);
        bot.replyStarts(SPACE, 7, false);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'The demo is on Sunday.');
        bot.sayToBubble(SPACE, "Khalid, I've answered that just for you.");

        expect(sent().every((piece) => piece.onlyFor === undefined)).toBe(true);
    });

    it('does not say out loud a reply for one person once someone else is there, and stops what it was saying', async () => {
        const { bot, internals, init, join, sent } = setup();
        const speech = { begin: vi.fn(), final: vi.fn(), hush: vi.fn(() => true) };
        internals.speech = speech;
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        bot.sendStreamMessage(SPACE, REPLY, 'Your interview ', false);
        expect(speech.begin).toHaveBeenCalledWith(REPLY);

        await join(SARA);
        // What was being said stops, and the reply in that person's chat is marked, for them alone
        expect(speech.hush).toHaveBeenCalledWith(SPACE, REPLY);
        expect(sent().at(-1)).toMatchObject({ stopped: true, onlyFor: 'room-1_7' });

        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
        expect(speech.final).not.toHaveBeenCalled();
    });

    it('says a reply for one person out loud while they are still alone', async () => {
        const { bot, internals, init } = setup();
        const speech = { begin: vi.fn(), final: vi.fn(), hush: vi.fn(() => false) };
        internals.speech = speech;
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');

        expect(speech.final).toHaveBeenCalledWith(SPACE, REPLY, 'Your interview is at 10.');
    });
});
