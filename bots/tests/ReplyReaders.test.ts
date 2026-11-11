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

    it('knows whether the reply last sent to someone went to them alone', () => {
        const readers = new ReplyReaders();
        // Nothing sent yet: nothing to say
        expect(readers.wentToThemAlone(SPACE, 7)).toBe(false);

        readers.starts(SPACE, 7, true);
        readers.readerOf(SPACE, REPLY, now(false));
        expect(readers.wentToThemAlone(SPACE, 7)).toBe(true);
        expect(readers.wentToThemAlone(SPACE, 9)).toBe(false);
        expect(readers.wentToThemAlone('elsewhere', 7)).toBe(false);

        // Their next reply is one everyone reads
        readers.starts(SPACE, 7, false);
        readers.readerOf(SPACE, 'bot-bot-test-player-7-next', now(false));
        expect(readers.wentToThemAlone(SPACE, 7)).toBe(false);
        // A late piece of the first reply still went to them alone
        readers.readerOf(SPACE, REPLY, now(false));
        expect(readers.wentToThemAlone(SPACE, 7)).toBe(true);
    });

    it('forgets who the last reply went to once the person, or the bot, has left', () => {
        const readers = new ReplyReaders();
        readers.starts(SPACE, 7, true);
        readers.readerOf(SPACE, REPLY, now(true));
        readers.personLeft(SPACE, 7);
        expect(readers.wentToThemAlone(SPACE, 7)).toBe(false);

        readers.starts(SPACE, 7, true);
        readers.readerOf(SPACE, 'bot-bot-test-player-7-again', now(true));
        expect(readers.wentToThemAlone(SPACE, 7)).toBe(true);
        readers.spaceLeft(SPACE);
        expect(readers.wentToThemAlone(SPACE, 7)).toBe(false);
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

    /** The bot's voice, as far as these tests go: whether it sends a reply for one person to that person only. */
    const voice = (keepsToOne: boolean | undefined) => ({ keepsToOne: () => keepsToOne, spaceUsers: () => undefined, spaceUserJoined: () => undefined, spaceUserLeft: () => undefined });

    /** The lines the bot sent about a reply's voice, with who each is for. */
    const voiceNotes = (bot: BotClient) =>
        ((bot as unknown as { send: ReturnType<typeof vi.fn> }).send.mock.calls as unknown[][])
            .map((call) => (call[0] as { message?: { publicEvent?: { spaceEvent?: { event?: { spaceStreamMessage?: Record<string, unknown> } } } } })?.message?.publicEvent?.spaceEvent?.event?.spaceStreamMessage)
            .filter((piece): piece is Record<string, unknown> => !!piece && (piece.keptQuiet !== undefined || piece.stoppedBySpeech !== undefined))
            .map((piece) => ({ reply: piece.responseId, keptQuiet: piece.keptQuiet, stopped: piece.stoppedBySpeech, onlyFor: piece.onlyFor }));

    it('hands a reply for one person to the voice with that person on it, also once someone else is there', async () => {
        const { bot, internals, init, join } = setup();
        const speech = { begin: vi.fn(), final: vi.fn(), hush: vi.fn() };
        Object.assign(internals, { speech, voice: voice(true) });
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        bot.sendStreamMessage(SPACE, REPLY, 'Your interview ', false);
        expect(speech.begin).toHaveBeenCalledWith(REPLY);

        // The voice sends it to that person and nobody else, so nothing stops when someone walks up
        await join(SARA);
        expect(speech.hush).not.toHaveBeenCalled();
        expect(voiceNotes(bot)).toEqual([]);

        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
        expect(speech.final).toHaveBeenCalledWith(SPACE, REPLY, 'Your interview is at 10.', 'room-1_7');
    });

    it('hands a reply for everyone to the voice as before, with nobody on it', async () => {
        const { bot, internals, init } = setup();
        const speech = { begin: vi.fn(), final: vi.fn(), hush: vi.fn() };
        Object.assign(internals, { speech, voice: voice(true) });
        await init([KHALID, SARA]);
        bot.replyStarts(SPACE, 7, false);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'The demo is on Sunday.');

        expect(speech.final).toHaveBeenCalledWith(SPACE, REPLY, 'The demo is on Sunday.');
    });

    it('with a voice that speaks to the whole bubble, stops what it was saying when someone walks up, and tells that person why', async () => {
        const { bot, internals, init, join } = setup();
        const speech = { begin: vi.fn(), final: vi.fn(), hush: vi.fn(() => 'stopped') };
        Object.assign(internals, { speech, voice: voice(false) });
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');

        await join(SARA);
        expect(speech.hush).toHaveBeenCalledWith(SPACE, REPLY);
        // One line under the reply, for that person alone: it is not "someone spoke over it"
        expect(voiceNotes(bot)).toEqual([{ reply: REPLY, keptQuiet: 'stopped', stopped: undefined, onlyFor: 'room-1_7' }]);
    });

    it('says so too when it had not begun to be heard, and says nothing when none of it was on its way', async () => {
        const queued = setup();
        Object.assign(queued.internals, { speech: { begin: vi.fn(), final: vi.fn(), hush: vi.fn(() => 'unsaid') }, voice: voice(false) });
        await queued.init([KHALID]);
        queued.bot.replyStarts(SPACE, 7, true);
        queued.bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
        await queued.join(SARA);
        expect(voiceNotes(queued.bot)).toEqual([{ reply: REPLY, keptQuiet: 'unsaid', stopped: undefined, onlyFor: 'room-1_7' }]);

        const over = setup();
        Object.assign(over.internals, { speech: { begin: vi.fn(), final: vi.fn(), hush: vi.fn(() => undefined) }, voice: voice(false) });
        await over.init([KHALID]);
        over.bot.replyStarts(SPACE, 7, true);
        over.bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
        await over.join(SARA);
        expect(voiceNotes(over.bot)).toEqual([]);
    });

    it('stops nothing while the voice has no session, or has not said what it can do: nothing of such a reply is being said then', async () => {
        const { bot, internals, init, join } = setup();
        const speech = { begin: vi.fn(), final: vi.fn(), hush: vi.fn() };
        Object.assign(internals, { speech, voice: voice(undefined) });
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
        await join(SARA);

        expect(speech.hush).not.toHaveBeenCalled();
    });

    it('does not stop a reply for the person who walks back in themselves', async () => {
        const { bot, internals, init, join } = setup();
        const speech = { begin: vi.fn(), final: vi.fn(), hush: vi.fn(() => 'stopped') };
        Object.assign(internals, { speech, voice: voice(false) });
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
        await join(KHALID);

        expect(speech.hush).not.toHaveBeenCalled();
    });
});

describe('BotClient: what a reply for one person sends with it', () => {
    const PAYSLIP = 'https://cdn.example.test/files/payslip.pdf';

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
        const internals = bot as unknown as { spaces: Map<string, string>; userId: number; behavior: unknown };
        internals.spaces.set(SPACE, ME);
        internals.userId = 12;
        const onBotMediaSent = vi.fn();
        internals.behavior = { onBotMediaSent, onSpaceUserJoined: vi.fn(), onSpaceUserLeft: vi.fn(), onSpaceJoined: vi.fn(), onChatMessage: vi.fn() };
        const receive = (message: unknown) => (bot as unknown as { handleSubMessage(m: unknown): Promise<void> }).handleSubMessage(message);
        const init = (users: unknown[]) => receive({ $case: 'initSpaceUsersMessage', initSpaceUsersMessage: { spaceName: SPACE, users } });
        const join = (user: unknown) => receive({ $case: 'addSpaceUserMessage', addSpaceUserMessage: { spaceName: SPACE, user } });
        /** The chat messages that went into the space: a card, a picture, a file. */
        const sent = () =>
            send.mock.calls
                .map((call) => call[0]?.message?.publicEvent?.spaceEvent?.event?.spaceMessage)
                .filter(Boolean)
                .map((message) => ({ message: message.message, url: message.url, onlyFor: message.onlyFor }));
        return { bot, init, join, sent, onBotMediaSent };
    }

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends a card to that person only, also after someone walks up', async () => {
        const { bot, init, join, sent } = setup();
        await init([KHALID]);
        await join(SARA);
        bot.sendChatMessage(SPACE, '::artifact:art-1:1:page::Budget', 7);

        expect(sent()).toEqual([{ message: '::artifact:art-1:1:page::Budget', url: undefined, onlyFor: 'room-1_7' }]);
    });

    it('sends a file to that person only, and keeps it as one nobody else was sent', async () => {
        const { bot, init, join, sent, onBotMediaSent } = setup();
        await init([KHALID]);
        await join(SARA);

        expect(bot.sendMediaMessage(SPACE, PAYSLIP, 'file', 'application/pdf', '', 'payslip.pdf', 7, 7)).toBe(true);

        expect(sent()).toEqual([{ message: '', url: PAYSLIP, onlyFor: 'room-1_7' }]);
        expect(onBotMediaSent).toHaveBeenCalledWith(SPACE, 7, [expect.objectContaining({ url: PAYSLIP })], true);
    });

    it('sends several pictures to that person only', async () => {
        const { bot, init, sent, onBotMediaSent } = setup();
        await init([KHALID, SARA]);
        const pictures = ['https://cdn.example.test/a.png', 'https://cdn.example.test/b.png'];

        expect(bot.sendMediaGallery(SPACE, pictures, 'Two charts', undefined, 7, 7)).toBe(true);

        expect(sent()).toEqual([{ message: 'Two charts', url: pictures[0], onlyFor: 'room-1_7' }]);
        expect(onBotMediaSent).toHaveBeenCalledWith(SPACE, 7, [expect.objectContaining({ url: pictures[0] }), expect.objectContaining({ url: pictures[1] })], true);
    });

    it('sends to everyone when no one person is named, as before', async () => {
        const { bot, init, sent, onBotMediaSent } = setup();
        await init([KHALID, SARA]);
        bot.sendChatMessage(SPACE, '::artifact:art-1:1:page::Budget');
        bot.sendMediaMessage(SPACE, PAYSLIP, 'file', 'application/pdf', '', 'payslip.pdf', 7);
        bot.sendMediaGallery(SPACE, ['https://cdn.example.test/a.png', 'https://cdn.example.test/b.png'], undefined, undefined, 7);

        expect(sent().map((message) => message.onlyFor)).toEqual([undefined, undefined, undefined]);
        // Everyone there was sent it: the file is kept with who is in the space
        expect(onBotMediaSent).toHaveBeenNthCalledWith(1, SPACE, 7, [expect.objectContaining({ url: PAYSLIP })]);
        expect(onBotMediaSent.mock.calls.every((call) => call.length === 3)).toBe(true);
    });

    it('sends nothing for one person in a space the bot is not in', () => {
        const { bot, sent, onBotMediaSent } = setup();
        bot.sendChatMessage('elsewhere', 'a card', 7);

        expect(bot.sendMediaMessage('elsewhere', PAYSLIP, 'file', 'application/pdf', '', 'payslip.pdf', 7, 7)).toBe(false);
        expect(bot.sendMediaGallery('elsewhere', [PAYSLIP, PAYSLIP], undefined, undefined, 7, 7)).toBe(false);
        expect(sent()).toEqual([]);
        expect(onBotMediaSent).not.toHaveBeenCalled();
    });

    it('passes the one person on from a picture, a file, a song or a video it uploads first', async () => {
        const { bot, init, sent } = setup();
        await init([KHALID, SARA]);
        vi.spyOn(bot as never, 'uploadMedia').mockImplementation((async (url: string, mimeType: string) => ({ location: url, mediaType: mimeType.split('/')[0] === 'application' ? 'file' : mimeType.split('/')[0], mimeType })) as never);

        await bot.sendImage(SPACE, 'https://cdn.example.test/a.png', 'A chart', 7, 'image/png', 7);
        await bot.sendFile(SPACE, PAYSLIP, 'payslip.pdf', 7, 'application/pdf', 7);
        await bot.sendAudio(SPACE, 'https://cdn.example.test/song.mp3', 7, 'audio/mpeg', 7);
        await bot.sendVideo(SPACE, 'https://cdn.example.test/clip.mp4', 7, 'video/mp4', 7);
        // A file sent again names no asker (it is kept already) and still goes to its person alone
        await bot.sendFile(SPACE, PAYSLIP, 'payslip.pdf', undefined, 'application/pdf', 7);
        // And to everyone when no one is named
        await bot.sendImage(SPACE, 'https://cdn.example.test/logo.png', 'Our logo', 7, 'image/png');

        expect(sent().map((message) => message.onlyFor)).toEqual(['room-1_7', 'room-1_7', 'room-1_7', 'room-1_7', 'room-1_7', undefined]);
    });

    it('asks once more after the upload, and sends nothing when it is held back (someone walked up meanwhile)', async () => {
        const { bot, init, sent } = setup();
        await init([KHALID, SARA]);
        vi.spyOn(bot as never, 'uploadMedia').mockImplementation((async (url: string, mimeType: string) => ({ location: url, mediaType: mimeType.split('/')[0] === 'application' ? 'file' : mimeType.split('/')[0], mimeType })) as never);
        const no = () => false;

        await expect(bot.sendImage(SPACE, 'https://cdn.example.test/a.png', 'A chart', undefined, 'image/png', undefined, no)).rejects.toMatchObject({ _heldBack: true });
        await expect(bot.sendFile(SPACE, PAYSLIP, 'payslip.pdf', undefined, 'application/pdf', undefined, no)).rejects.toMatchObject({ _heldBack: true });
        await expect(bot.sendAudio(SPACE, 'https://cdn.example.test/song.mp3', undefined, 'audio/mpeg', undefined, no)).rejects.toMatchObject({ _heldBack: true });
        await expect(bot.sendVideo(SPACE, 'https://cdn.example.test/clip.mp4', undefined, 'video/mp4', undefined, no)).rejects.toMatchObject({ _heldBack: true });
        expect(sent()).toEqual([]);

        await bot.sendFile(SPACE, PAYSLIP, 'payslip.pdf', undefined, 'application/pdf', undefined, () => true);
        expect(sent()).toHaveLength(1);
    });

    it('remembers what it said in a reply for one person as said with nobody else there, whoever walked up', async () => {
        const { bot, init, join } = setup();
        await init([KHALID]);
        bot.replyStarts(SPACE, 7, true);
        bot.sendStreamMessage(SPACE, REPLY, 'Your interview ', false);
        await join(SARA);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');

        // Sara is there now, and was sent none of it
        expect(bot.heardIn(SPACE, 7)).toEqual({ place: 'nearby', with: ['uuid-sara'] });
        expect(bot.saidIn(SPACE, 7)).toEqual({ place: 'nearby', with: [] });
    });

    it('remembers what it said in a reply everyone read with everyone who is there', async () => {
        const { bot, init } = setup();
        await init([KHALID, SARA]);
        bot.replyStarts(SPACE, 7, false);
        bot.sendStreamMessage(SPACE, REPLY, '', true, 'The demo is on Sunday.');

        expect(bot.saidIn(SPACE, 7)).toEqual({ place: 'nearby', with: ['uuid-sara'] });
        // A space the bot is not in: it cannot say
        expect(bot.saidIn('elsewhere', 7)).toBeUndefined();
    });
});
