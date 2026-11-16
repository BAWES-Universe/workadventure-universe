/**
 * What a reply sends with it (game #1993): a picture, a file, a song, a video. A reply written for someone who is alone
 * with the bot sends them to that person only, so someone who walks up while it is being made is sent none of it. A reply
 * other people read sends them into the space for everyone, as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { MCPConnector } from '../mcp/MCPConnector';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

const SPACE = 'bubble-1';
const KHALID = 7;
const SARA = 'uuid-sara';

const client = () => ({
    isInSpace: vi.fn(() => true),
    getPersonForArtifacts: vi.fn(() => ({ signedIn: true, identifier: 'uuid-khalid', name: 'Khalid' })),
    sendImage: vi.fn(async (_space: string, url: string) => url),
    sendFile: vi.fn(async (_space: string, url: string) => url),
    sendAudio: vi.fn(async (_space: string, url: string) => url),
    sendVideo: vi.fn(async (_space: string, url: string) => url),
    sendMediaGallery: vi.fn(() => true),
    sendMediaMessage: vi.fn(() => true),
});

function service(memory?: Record<string, unknown>) {
    const ai = new AIService(null!, null!, '');
    (ai as unknown as { conversationMemory: unknown }).conversationMemory = { getMemory: () => memory };
    return ai;
}

/** The tools of one reply: `present` is everyone else who reads it, left out when the person is alone with the bot. */
const run = (ai: AIService, tools: Array<{ id: string; name: string; arguments: string }>, bot: unknown, present?: string[]) =>
    ai['executeToolCalls'](tools, bot as never, undefined, undefined, 'uuid-khalid', SPACE, 'bot1', KHALID, undefined, undefined, false, undefined, undefined, present);

const SENDS = [
    { id: 't1', name: 'send_image', arguments: JSON.stringify({ url: 'https://cdn.example.test/chart.png', alt: 'A chart' }) },
    { id: 't2', name: 'send_file', arguments: JSON.stringify({ url: 'https://cdn.example.test/payslip.pdf', filename: 'payslip.pdf' }) },
    { id: 't3', name: 'send_audio', arguments: JSON.stringify({ url: 'https://cdn.example.test/song.mp3' }) },
    { id: 't4', name: 'send_video', arguments: JSON.stringify({ url: 'https://cdn.example.test/clip.mp4' }) },
];

describe('what a reply sends with it (#1993)', () => {
    beforeEach(() => {
        vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: [], toolServerMap: new Map() } as never);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('the send tools', () => {
        it('alone with the bot: each goes to that person only', async () => {
            const bot = client();
            const results = await run(service(), SENDS, bot);

            expect(results.map((one) => one.result.success)).toEqual([true, true, true, true]);
            expect(bot.sendImage).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/chart.png', 'A chart', KHALID, undefined, KHALID);
            expect(bot.sendFile).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/payslip.pdf', 'payslip.pdf', KHALID, undefined, KHALID);
            expect(bot.sendAudio).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/song.mp3', KHALID, undefined, KHALID);
            expect(bot.sendVideo).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/clip.mp4', KHALID, undefined, KHALID);
        });

        it('in a reply other people read: each goes into the space for everyone, as before', async () => {
            const bot = client();
            await run(service(), SENDS, bot, [SARA]);

            expect(bot.sendImage).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/chart.png', 'A chart', KHALID, undefined, undefined);
            expect(bot.sendFile).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/payslip.pdf', 'payslip.pdf', KHALID, undefined, undefined);
            expect(bot.sendAudio).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/song.mp3', KHALID, undefined, undefined);
            expect(bot.sendVideo).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/clip.mp4', KHALID, undefined, undefined);
        });
    });

    describe('what a tool made', () => {
        const made = (...urls: string[]) => [{ id: 't1', name: 'generate_media', result: { urls } }];
        const send = (ai: AIService, bot: unknown, results: unknown, only?: number) =>
            ai['autoSendMedia'](results as never, bot as never, SPACE, new Set(), 'bot1', KHALID, undefined, only);

        it('goes to the one person when the reply is theirs alone: one picture, several, a song, a video', async () => {
            const bot = client();
            const ai = service();
            await send(ai, bot, made('https://cdn.example.test/a.png'), KHALID);
            await send(ai, bot, made('https://cdn.example.test/b.png', 'https://cdn.example.test/c.png'), KHALID);
            await send(ai, bot, made('https://cdn.example.test/song.mp3', 'https://cdn.example.test/clip.mp4'), KHALID);

            expect(bot.sendImage).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/a.png', undefined, KHALID, undefined, KHALID);
            expect(bot.sendMediaGallery).toHaveBeenCalledWith(SPACE, ['https://cdn.example.test/b.png', 'https://cdn.example.test/c.png'], undefined, undefined, KHALID, KHALID);
            expect(bot.sendAudio).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/song.mp3', KHALID, undefined, KHALID);
            expect(bot.sendVideo).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/clip.mp4', KHALID, undefined, KHALID);
        });

        it('still goes to the one person when several pictures have to be sent one by one', async () => {
            const bot = client();
            bot.sendMediaGallery.mockReturnValue(false);
            await send(service(), bot, made('https://cdn.example.test/b.png', 'https://cdn.example.test/c.png'), KHALID);

            expect(bot.sendImage.mock.calls).toEqual([
                [SPACE, 'https://cdn.example.test/b.png', undefined, KHALID, undefined, KHALID],
                [SPACE, 'https://cdn.example.test/c.png', undefined, KHALID, undefined, KHALID],
            ]);

            const failing = client();
            failing.sendMediaGallery.mockImplementation(() => {
                throw new Error('no gallery');
            });
            await send(service(), failing, made('https://cdn.example.test/b.png', 'https://cdn.example.test/c.png'), KHALID);
            expect((failing.sendImage.mock.calls as unknown[][]).map((call) => call[5])).toEqual([KHALID, KHALID]);
        });

        it('goes into the space for everyone in a reply other people read', async () => {
            const bot = client();
            const ai = service();
            await send(ai, bot, made('https://cdn.example.test/a.png'));
            await send(ai, bot, made('https://cdn.example.test/b.png', 'https://cdn.example.test/c.png'));

            expect(bot.sendImage).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/a.png', undefined, KHALID, undefined, undefined);
            expect(bot.sendMediaGallery).toHaveBeenCalledWith(SPACE, ['https://cdn.example.test/b.png', 'https://cdn.example.test/c.png'], undefined, undefined, KHALID, undefined);
        });
    });

    describe('what was waiting from an earlier visit', () => {
        const waiting = (createdAt: number) => ({
            pendingMedia: [{ url: 'https://cdn.example.test/song.mp3', mediaType: 'audio', mimeType: 'audio/mpeg', caption: 'Your song', createdAt, retryCount: 0 }],
            maxPendingMedia: 5,
        });

        it('goes to the one person in a reply that is theirs alone', () => {
            const bot = client();
            const memory = waiting(Date.now() - 60_000);
            service(memory)['flushPendingMedia'](bot as never, SPACE, 'bot1', KHALID, undefined, KHALID);

            expect(bot.sendMediaMessage).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/song.mp3', 'audio', 'audio/mpeg', 'Your song', undefined, KHALID, KHALID);
            expect(memory.pendingMedia).toEqual([]);
        });

        it('waits when other people read the reply, and what that reply made goes to everyone', () => {
            const bot = client();
            const now = Date.now();
            const memory = waiting(now - 60_000);
            memory.pendingMedia.push({ url: 'https://cdn.example.test/logo.png', mediaType: 'image', mimeType: 'image/png', caption: 'Our logo', createdAt: now + 5, retryCount: 0 });
            service(memory)['flushPendingMedia'](bot as never, SPACE, 'bot1', KHALID, now, undefined);

            expect(bot.sendMediaMessage).toHaveBeenCalledTimes(1);
            expect(bot.sendMediaMessage).toHaveBeenCalledWith(SPACE, 'https://cdn.example.test/logo.png', 'image', 'image/png', 'Our logo', undefined, KHALID, undefined);
            expect(memory.pendingMedia.map((item) => item.url)).toEqual(['https://cdn.example.test/song.mp3']);
        });
    });
});
