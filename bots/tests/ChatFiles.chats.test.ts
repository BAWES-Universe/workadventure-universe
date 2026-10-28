import { describe, expect, it, vi } from 'vitest';
import type { ParsedFile } from '../services/FileParser';

/**
 * Files in direct messages and nearby chat (#1508): the note in the history in place of "[sent a file]", the file put
 * on Orbit's list in the background, and the reply never waiting for it.
 */

const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const ALICE = '@alice:matrix.test';
const UPLOADED = 'https://uploader.test/upload-file/0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.pdf';
const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };

const pdf = (text: string, extra: Partial<ParsedFile> = {}): ParsedFile => ({
    type: 'document',
    text,
    summary: 'PDF',
    mimeType: 'application/pdf',
    metadata: { pageCount: 41 },
    ...extra,
});

async function dmService(options: { parsed?: ParsedFile; add?: () => Promise<unknown> } = {}) {
    const { DmReplyService } = await import('../server/DmReplyService');
    const { ConversationMemory } = await import('../memory/ConversationMemory');
    const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
    const memory = new ConversationMemory();
    const seen: string[] = [];
    const answering = vi.fn(async function* (_bot: string, _player: number, message: string) {
        seen.push(message);
        yield { content: 'Got it!', done: true };
    });
    const admin = {
        addBotFile: vi.fn(options.add ?? (async () => ({ file: { ref: 'f3' }, hidden: false }))),
        keepBotFileText: vi.fn(async () => ({ file: {}, hidden: false })),
    };
    Object.assign(service, {
        playerIds: new Map(),
        nextPlayerId: -1,
        loadedBots: new Set([BOT]),
        botManager: { getBot: () => null },
        getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p' }),
        aiService: {
            generateBotResponseStream: answering,
            botLimitsFor: () => ({ fileTextChars: 2_000_000 }),
            readCharsFor: () => 50_000,
        },
        adminApiService: admin,
        conversationMemory: memory,
        conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        formatParsedAttachment: vi.fn(async (text: string, url: string, _m: string, _t: string, _g: string[], _b: string, found: Map<string, ParsedFile | null>) => {
            found.set(url, options.parsed ?? pdf('Chapter one'));
            return `${text}\n[User sent a document]`;
        }),
        collectImageUrls: async () => [],
    });
    const history = () => memory.getMemory(BOT, service.playerIdFor(ALICE))?.conversationHistory.map((entry) => entry.message) ?? [];
    return { service, admin, history, seen };
}

const attachment = { url: UPLOADED, mimeType: 'application/pdf', mediaType: 'file' as const, name: 'plan.pdf', sizeBytes: 1200 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a file in a direct message (#1508)', () => {
    it('keeps a note in the history in place of "[sent a file]", and gives it its id once Orbit has one', async () => {
        const { service, admin, history, seen } = await dmService();
        const reply = await (service as any).replyNow(BOT, person, 'see this', [attachment], { roomId: '!room' });
        expect(reply.text).toBe('Got it!');
        // The model still reads the file itself for this reply
        expect(seen[0]).toContain('[User sent a document]');
        await flush();
        expect(history()[0]).toBe('see this\n[file f3 · "plan.pdf" · PDF · 41 pages]');
        expect(admin.addBotFile).toHaveBeenCalledWith(
            { botId: BOT, person: { signedIn: true, identifier: 'uuid-alice', name: 'Alice' }, chat: { kind: 'dm', ref: '!room' } },
            expect.objectContaining({ source: 'person', kind: 'document', name: 'plan.pdf', store: { url: UPLOADED }, pages: 41, sizeBytes: 1200 })
        );
        // All of it was read for the reply, so that text is kept
        expect(admin.keepBotFileText).toHaveBeenCalledWith(expect.anything(), 'f3', { from: 0, text: 'Chapter one', last: true });
    });

    it('a file on its own is just its note', async () => {
        const { service, history } = await dmService();
        await (service as any).replyNow(BOT, person, '', [attachment], { roomId: '!room' });
        await flush();
        expect(history()[0]).toBe('[file f3 · "plan.pdf" · PDF · 41 pages]');
    });

    it('a message tried again after its file got an id is still the same message, kept once and added once', async () => {
        const { service, admin, history } = await dmService();
        (service as any).aiService.generateBotResponseStream = vi.fn(async function* () {
            throw new Error('provider down');
        });
        await (service as any).replyNow(BOT, person, 'see this', [attachment], { roomId: '!room' });
        await flush();
        await (service as any).replyNow(BOT, person, 'see this', [attachment], { roomId: '!room' });
        await flush();
        expect(history()).toEqual(['see this\n[file f3 · "plan.pdf" · PDF · 41 pages]']);
        expect(admin.addBotFile).toHaveBeenCalledTimes(1);
    });

    it('never waits for Orbit: the reply is sent while the file is still being kept, and a failure there changes nothing', async () => {
        let release!: () => void;
        const { service, history } = await dmService({
            add: () => new Promise((_resolve, reject) => (release = () => reject(Object.assign(new Error('down'), { code: 'signed_link' })))),
        });
        const reply = await (service as any).replyNow(BOT, person, 'see this', [attachment], { roomId: '!room' });
        expect(reply.text).toBe('Got it!');
        release();
        await flush();
        expect(history()[0]).toBe('see this\n[file · "plan.pdf" · PDF · 41 pages]');
    });

    it('reads a long file again afterwards when the reply read only part of it', async () => {
        const { chatFileKeeper } = await import('../services/ChatFileKeeper');
        const parse = vi.spyOn((await import('../services/FileParser')).FileParser, 'parseFile').mockResolvedValue(pdf('the whole book'));
        const { service, admin } = await dmService({ parsed: pdf('the whole', { truncated: true }) });
        await (service as any).replyNow(BOT, person, '', [attachment], { roomId: '!room' });
        await flush();
        await chatFileKeeper.idle();
        expect(parse).toHaveBeenCalledWith(UPLOADED, 'application/pdf', 2_000_000);
        expect(admin.keepBotFileText).toHaveBeenCalledWith(expect.anything(), 'f3', { from: 0, text: 'the whole book', last: true });
        parse.mockRestore();
    });

    it("carries a Matrix file's name, size and length to the reply", async () => {
        const { MatrixDmBridge } = await import('../matrix/MatrixDmBridge');
        const bridge = Object.create(MatrixDmBridge.prototype);
        Object.assign(bridge, {
            deps: { uploadAttachment: vi.fn(async () => 'https://uploader.test/upload-file/x.ogg') },
            client: { downloadMedia: vi.fn(async () => ({ data: Buffer.from('abc'), contentType: 'audio/ogg' })) },
        });
        const read = await bridge.readMessage('@bot:matrix.test', {
            msgtype: 'm.audio',
            body: 'Voice message.ogg',
            url: 'mxc://matrix.test/v',
            info: { mimetype: 'audio/ogg', size: 4096, duration: 7300 },
        });
        expect(read.attachments).toEqual([
            { url: 'https://uploader.test/upload-file/x.ogg', mimeType: 'audio/ogg', mediaType: 'audio', name: 'Voice message.ogg', sizeBytes: 4096, lengthSeconds: 7.3 },
        ]);
    });
});

describe('a file in nearby chat (#1508)', () => {
    it("notes the uploads for the bot's memory only, and keeps them for the person and the bubble the artifact tools name", async () => {
        const { BaseBehavior } = await import('../behaviors/BaseBehavior');
        const { ConversationMemory } = await import('../memory/ConversationMemory');
        class Plain extends (BaseBehavior as unknown as { new (config: object): any }) {
            update() {}
        }
        const behavior = new Plain({ type: 'idle' });
        const memory = new ConversationMemory();
        const admin = { addBotFile: vi.fn(async () => ({ file: { ref: 'f7' }, hidden: false })), keepBotFileText: vi.fn(async () => ({})) };
        const guestPerson = { signedIn: false, identifier: null, name: 'Visitor' };
        Object.assign(behavior, {
            bot: { getBotId: () => BOT, getPersonForArtifacts: () => guestPerson },
            aiService: { botLimitsFor: () => ({ fileTextChars: 2_000_000 }), readCharsFor: () => 50_000 },
            adminApiService: admin,
            conversationMemory: memory,
            formatParsedAttachment: vi.fn(async (text: string, url: string, _m: string, _t: string, _g: string[], _b: unknown, found: Map<string, ParsedFile | null>) => {
                found.set(url, { type: 'image', summary: 'Image', mimeType: 'image/png' });
                found.set('https://typed.example.com', { type: 'webpage', text: 'a page', summary: 'page', mimeType: 'text/html' });
                return `${text}\n[User also sent an image]`;
            }),
        });
        const upload = 'https://uploader.test/upload-file/0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.png';
        const files = await behavior.readBubbleFiles('space-1', 42, 'look', upload, 'image/png', 'image', ['https://typed.example.com'], [
            { url: upload, name: 'map.png', mimeType: 'image/png', mediaType: 'image' },
        ]);
        expect(files.augmented).toBe('look\n[User also sent an image]');
        expect(files.line).toBe('look\n[file · "map.png" · PNG]');
        memory.addMessage(BOT, 42, files.line, 'person', 'space-1');
        files.keep();
        await flush();
        expect(memory.getMemory(BOT, 42)!.conversationHistory[0].message).toBe('look\n[file f7 · "map.png" · PNG]');
        expect(admin.addBotFile).toHaveBeenCalledTimes(1);
        expect(admin.addBotFile).toHaveBeenCalledWith({ botId: BOT, person: guestPerson, chat: { kind: 'nearby', ref: 'space-1' } }, expect.objectContaining({ kind: 'image' }));
        // An image has no text to keep
        expect(admin.keepBotFileText).not.toHaveBeenCalled();
    });

    it('a message with only typed links has no uploads, so nothing is noted or kept', async () => {
        const { BaseBehavior } = await import('../behaviors/BaseBehavior');
        class Plain extends (BaseBehavior as unknown as { new (config: object): any }) {
            update() {}
        }
        const behavior = new Plain({ type: 'idle' });
        Object.assign(behavior, {
            bot: { getBotId: () => BOT, getPersonForArtifacts: () => ({ signedIn: false, identifier: null, name: null }) },
            formatParsedAttachment: vi.fn(async (text: string) => `${text}\n[User shared a web page]`),
        });
        const files = await behavior.readBubbleFiles('space-1', 42, 'https://typed.example.com', 'https://typed.example.com', 'text/html', undefined, undefined, undefined);
        expect(files.line).toBe('https://typed.example.com');
        expect(() => files.keep()).not.toThrow();
    });
});
