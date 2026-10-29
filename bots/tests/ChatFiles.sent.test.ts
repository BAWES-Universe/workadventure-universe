import { describe, expect, it, vi } from 'vitest';
import { AIService, promptOfToolCall } from '../ai/AIService';
import { ChatFileKeeper, sentMediaJob } from '../services/ChatFileKeeper';

/**
 * Files the bot sends (#1508): kept on the person's list with the tool that made each one and what the bot asked it
 * for, in nearby chat and in direct messages, and never in the way of sending them.
 */

const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const SONG = 'https://tools.example.com/out/yazoghal.mp3';
const CDN = 'https://cdn.example.com/0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.mp3';
const call = { botId: BOT, person: { signedIn: true, identifier: 'uuid-alice', name: 'Alice' }, chat: { kind: 'dm' as const, ref: '!room' } };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function orbit() {
    return {
        addBotFile: vi.fn(async () => ({ file: { ref: 'f12' }, hidden: false })),
        keepBotFileText: vi.fn(async () => ({ file: {}, hidden: false })),
    };
}

describe('what the bot asked a tool for', () => {
    it('is its prompt or text when it has one, else all it was given', () => {
        expect(promptOfToolCall('{"prompt":"  an oud song, slow  ","seconds":30}')).toBe('an oud song, slow');
        expect(promptOfToolCall('{"text":"Hello there","voice":"v1"}')).toBe('Hello there');
        expect(promptOfToolCall('{"style":"lofi","seconds":30}')).toBe('{"style":"lofi","seconds":30}');
        expect(promptOfToolCall('not json')).toBe('not json');
        // Arguments with a quote left unescaped, repaired as the call itself was
        expect(promptOfToolCall('{"prompt":"a card with "Dragon" on it","seconds":30}')).toBe('a card with "Dragon" on it');
        expect(promptOfToolCall('{}')).toBeNull();
        expect(promptOfToolCall(undefined)).toBeNull();
    });
});

describe('which tool made a file', () => {
    it('is the first tool that gave it back, never a send, map, artifact or listing tool', () => {
        const ai = new AIService(null!, null!, '');
        const note = (name: string, args: string, result: unknown) =>
            ai['noteMadeMedia']([{ id: name, type: 'function', function: { name, arguments: args }, name, arguments: args } as never], [{ id: name, name, result }]);
        note('send_audio', '{"url":"x"}', { success: true, url: 'https://tools.example.com/sent.mp3' });
        note('list_imagines', '{"page":1}', { items: ['https://tools.example.com/old.png'] });
        note('make_song', '{"prompt":"an oud song"}', { success: true, url: SONG });
        note('remix_song', '{"prompt":"slower"}', { url: SONG });
        expect(ai.madeFor(CDN, SONG)).toEqual({ with: 'make_song', prompt: 'an oud song' });
        expect(ai.madeFor('https://tools.example.com/sent.mp3')).toBeNull();
        expect(ai.madeFor('https://tools.example.com/old.png')).toBeNull();
        expect(ai.madeFor(undefined, null)).toBeNull();
    });
});

describe('a file the bot sent, to keep', () => {
    const where = { call, personRef: 'uuid-alice', maxTextChars: 2_000_000 };

    it('is named as it was sent, or by its link, with its caption as its line', () => {
        const made = { with: 'make_song', prompt: 'an oud song' };
        expect(sentMediaJob({ url: CDN, mediaType: 'audio', mimeType: 'audio/mpeg', caption: ' For you ' }, where, made)).toMatchObject({
            source: 'bot',
            kind: 'audio',
            made,
            line: 'For you',
            upload: { url: CDN, name: '0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.mp3' },
        });
        expect(sentMediaJob({ url: 'https://cdn.example.com/a%20b.pdf', mediaType: 'file', mimeType: 'application/pdf', fileName: 'plan.pdf' }, where, null)).toMatchObject({
            kind: 'document',
            made: null,
            line: null,
            upload: { name: 'plan.pdf' },
            // A document's words are kept so it can be found by them
            readAgain: { mimeType: 'application/pdf' },
        });
    });

    it('is not read again for its words when no text is kept', () => {
        const job = sentMediaJob({ url: 'https://cdn.example.com/plan.pdf', mediaType: 'file', mimeType: 'application/pdf' }, { ...where, maxTextChars: 0 }, null);
        expect(job.readAgain).toBeUndefined();
    });

    it("goes to Orbit as the bot's, with the tool and its prompt", async () => {
        const admin = orbit();
        const keeper = new ChatFileKeeper(vi.fn() as never, 1);
        await keeper.keepAll(admin as never, [sentMediaJob({ url: CDN, mediaType: 'audio', mimeType: 'audio/mpeg', caption: 'x'.repeat(3000) }, where, { with: 'make_song', prompt: 'an oud song' })]);
        expect(admin.addBotFile).toHaveBeenCalledWith(call, expect.objectContaining({ source: 'bot', kind: 'audio', store: { url: CDN }, madeWith: 'make_song', madePrompt: 'an oud song' }));
        expect((admin.addBotFile.mock.calls[0] as unknown[])[1]).toMatchObject({ line: 'x'.repeat(2000) });
        expect(admin.keepBotFileText).not.toHaveBeenCalled();
    });
});

describe('a file the bot sends in nearby chat', () => {
    it('goes to the behavior for the person whose reply sent it, so two replies at once never swap files, and never stops the file being sent', async () => {
        const { BotClient } = await import('../client/BotClient');
        const client = Object.create(BotClient.prototype) as InstanceType<typeof BotClient>;
        const onBotMediaSent = vi.fn();
        const send = vi.fn();
        Object.assign(client, { behavior: { onBotMediaSent }, config: { botId: BOT, name: 'Guide' }, spaces: new Map([['space-1', 7]]), send });
        // A's slow song lands after B's reply started: each send names its own asker
        expect(client.sendMediaMessage('space-1', 'https://cdn/b.png', 'image', 'image/png', '', undefined, 43)).toBe(true);
        expect(client.sendMediaMessage('space-1', CDN, 'audio', 'audio/mpeg', '', undefined, 42)).toBe(true);
        expect(onBotMediaSent.mock.calls.map(([space, asker, items]) => [space, asker, items[0].url])).toEqual([
            ['space-1', 43, 'https://cdn/b.png'],
            ['space-1', 42, CDN],
        ]);
        client.sendMediaGallery('space-1', ['https://cdn/1.png', 'https://cdn/2.png'], 'two', ['one.png', 'two.png'], 42);
        expect(onBotMediaSent.mock.calls.at(-1)).toEqual([
            'space-1',
            42,
            [
                { url: 'https://cdn/1.png', mediaType: 'image', mimeType: 'image/png', caption: 'two', fileName: 'one.png' },
                { url: 'https://cdn/2.png', mediaType: 'image', mimeType: 'image/png', caption: undefined, fileName: 'two.png' },
            ],
        ]);
        // A send that isn't from a reply (no asker) is sent and not kept
        onBotMediaSent.mockClear();
        expect(client.sendMediaMessage('space-1', CDN, 'audio', 'audio/mpeg')).toBe(true);
        expect(onBotMediaSent).not.toHaveBeenCalled();
        onBotMediaSent.mockImplementation(() => {
            throw new Error('boom');
        });
        expect(client.sendMediaMessage('space-1', CDN, 'audio', 'audio/mpeg', '', undefined, 42)).toBe(true);
        expect(send).toHaveBeenCalledTimes(5);
    });

    it('is kept for that person and bubble, with the tool that made the file it was uploaded from', async () => {
        const { BaseBehavior } = await import('../behaviors/BaseBehavior');
        class Plain extends (BaseBehavior as unknown as { new (config: object): any }) {
            update() {}
        }
        const behavior = new Plain({ type: 'idle' });
        const admin = orbit();
        const person = { signedIn: true, identifier: 'uuid-alice', name: 'Alice' };
        const madeFor = vi.fn(() => ({ with: 'make_song', prompt: 'an oud song' }));
        Object.assign(behavior, {
            bot: { getBotId: () => BOT, getPersonForArtifacts: () => person, uploadedFromOf: (url: string) => (url === CDN ? SONG : undefined) },
            aiService: { botLimitsFor: () => ({ fileTextChars: 2_000_000 }), madeFor },
            adminApiService: admin,
        });
        behavior.userIdToUuid.set(42, 'uuid-alice');
        behavior.onBotMediaSent('space-1', 42, [{ url: CDN, mediaType: 'audio', mimeType: 'audio/mpeg' }]);
        await flush();
        expect(madeFor).toHaveBeenCalledWith(CDN, SONG);
        expect(admin.addBotFile).toHaveBeenCalledWith(
            { botId: BOT, person, chat: { kind: 'nearby', ref: 'space-1' } },
            expect.objectContaining({ source: 'bot', madeWith: 'make_song', madePrompt: 'an oud song', store: { url: CDN } })
        );
    });
});

describe('a file the bot sends in a direct message', () => {
    it('is kept for the person and room once it reached them, with the tool that made it', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const { ConversationMemory } = await import('../memory/ConversationMemory');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const memory = new ConversationMemory();
        const admin = orbit();
        const madeFor = vi.fn(() => ({ with: 'make_song', prompt: 'an oud song' }));
        Object.assign(service, {
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BOT]),
            botManager: { getBot: () => null },
            getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p' }),
            aiService: {
                generateBotResponseStream: vi.fn(async function* (_bot: string, player: number) {
                    memory.getMemory(BOT, player)!.pendingMedia!.push({ url: SONG, originalUrl: SONG, mediaType: 'audio', mimeType: '', caption: '', createdAt: 0, retryCount: 0 });
                    yield { content: 'Here it is!', done: true };
                }),
                botLimitsFor: () => ({ fileTextChars: 2_000_000 }),
                readCharsFor: () => 50_000,
                madeFor,
            },
            adminApiService: admin,
            conversationMemory: memory,
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
            collectImageUrls: async () => [],
        });
        const person = { matrixUserId: '@alice:matrix.test', uuid: 'uuid-alice', name: 'Alice', isGuest: false };
        const reply = await (service as any).replyNow(BOT, person, 'make me a song', [], { roomId: '!room' });
        expect(reply.media).toHaveLength(1);
        // Nothing is kept before it was sent
        expect(admin.addBotFile).not.toHaveBeenCalled();
        reply.mediaSent(reply.media[0]);
        await flush();
        expect(madeFor).toHaveBeenCalledWith(SONG, SONG);
        expect(admin.addBotFile).toHaveBeenCalledWith(
            { botId: BOT, person: { signedIn: true, identifier: 'uuid-alice', name: 'Alice' }, chat: { kind: 'dm', ref: '!room' } },
            expect.objectContaining({ source: 'bot', kind: 'audio', name: 'yazoghal.mp3', madeWith: 'make_song', store: { url: SONG } })
        );
    });
});
