/**
 * The Brick for guests gets the same chat as every bot (plan v3 section 5): a guest names files and voice notes by their upload
 * receipts, the bot server reads them through the uploader only when the receipt is theirs and the bytes are what was uploaded,
 * reads them the way every bot does, and hears a note once through Orbit's turns. Nothing here reaches a provider.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { BotAPI } from '../server/BotAPI';
import { GuestBrickService, readDelivery, signDelivery, type GuestBrickMedia } from '../server/GuestBrickService';
import { readGuestUpload } from '../server/GuestBrickMedia';
import { checkReceipt, readReceiptFile, signReceipt, uploaderPathOf } from '../server/UploadReceipts';
import { FileParser } from '../services/FileParser';
import { DmReplyService } from '../server/DmReplyService';
import type { GuestBrickAllowance, GuestBrickSetup } from '../server/AdminApiService';

const SECRET = 'test-secret';
const GUEST = '5d0a1c3e-1111-4222-8333-944455556666';
const OTHER = '5d0a1c3e-1111-4222-8333-944455550000';
const ROOM_URL = 'https://play.test/@/bawes/main/lobby';
const UPLOADER = 'https://uploader.test';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const receipt = (over: Record<string, unknown> = {}, bytes = new Uint8Array([1, 2, 3])) =>
    signReceipt(
        {
            sub: GUEST,
            aud: 'guest-brick',
            fid: '0b6f3c1e-1111-4222-8333-944455556666.png',
            bkt: null,
            loc: 'https://cdn.test/0b6f3c1e-1111-4222-8333-944455556666.png',
            sha256: sha(bytes),
            name: 'menu.png',
            type: 'image/png',
            size: bytes.byteLength,
            len: 'unmeasured',
            iat: 1,
            exp: Date.now() + 60_000,
            ...over,
        } as never,
        SECRET
    );

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('upload receipts', () => {
    it("are the guest's own, for a chat purpose, signed with the receipt key and not expired", () => {
        expect(checkReceipt(receipt(), SECRET, GUEST, ['guest-brick'])).toMatchObject({ ok: true, claims: { sub: GUEST, name: 'menu.png' } });
        expect(checkReceipt(receipt(), SECRET, OTHER, ['guest-brick'])).toEqual({ ok: false, reason: 'not-yours' });
        expect(checkReceipt(receipt({ aud: 'chat-file' }), SECRET, GUEST, ['guest-brick'])).toEqual({ ok: false, reason: 'not-yours' });
        expect(checkReceipt(receipt({ exp: Date.now() - 1 }), SECRET, GUEST, ['guest-brick'])).toEqual({ ok: false, reason: 'expired' });
        expect(checkReceipt(receipt(), 'another-secret', GUEST, ['guest-brick'])).toEqual({ ok: false, reason: 'invalid' });
        expect(checkReceipt('a.b', SECRET, GUEST, ['guest-brick'])).toEqual({ ok: false, reason: 'invalid' });
        expect(checkReceipt(undefined, SECRET, GUEST, ['guest-brick'])).toEqual({ ok: false, reason: 'invalid' });
        // Claims changed after signing
        const [body, mac] = receipt().split('.');
        const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
        const forged = Buffer.from(JSON.stringify({ ...claims, sub: OTHER })).toString('base64url');
        expect(checkReceipt(`${forged}.${mac}`, SECRET, OTHER, ['guest-brick'])).toEqual({ ok: false, reason: 'invalid' });
    });

    it("read the file through the uploader's own path, never the link the device has", async () => {
        expect(uploaderPathOf({ fid: 'a.png', bkt: null }, `${UPLOADER}/`)).toBe(`${UPLOADER}/upload-file/a.png`);
        expect(uploaderPathOf({ fid: 'a.png', bkt: 'user-refs' }, UPLOADER)).toBe(`${UPLOADER}/chat-file/user-refs/a.png`);
        const fetchBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));
        const check = checkReceipt(receipt(), SECRET, GUEST, ['guest-brick']);
        if (!check.ok) throw new Error('receipt');
        expect(await readReceiptFile(check.claims, UPLOADER, 100, fetchBytes)).toMatchObject({ ok: true });
        expect(fetchBytes).toHaveBeenCalledWith(`${UPLOADER}/upload-file/0b6f3c1e-1111-4222-8333-944455556666.png`, 100);
    });

    it('refuse a replaced file, a gone one and one over the limit', async () => {
        const check = checkReceipt(receipt(), SECRET, GUEST, ['guest-brick']);
        if (!check.ok) throw new Error('receipt');
        expect(await readReceiptFile(check.claims, UPLOADER, 100, async () => new Uint8Array([9, 9, 9]))).toEqual({ ok: false, reason: 'changed' });
        expect(await readReceiptFile(check.claims, UPLOADER, 100, async () => Promise.reject(new Error('HTTP 404')))).toEqual({ ok: false, reason: 'gone' });
        expect(await readReceiptFile(check.claims, UPLOADER, 2, async () => new Uint8Array([1, 2, 3]))).toEqual({ ok: false, reason: 'too-big' });
        expect(await readReceiptFile(check.claims, UPLOADER, 100, async () => Promise.reject(new Error('File too large (over 1MB)')))).toEqual({ ok: false, reason: 'too-big' });
    });

    it("give the guest Brick a guest's upload, or why not", async () => {
        const fetchBytes = async () => new Uint8Array([1, 2, 3]);
        expect(await readGuestUpload(GUEST, receipt(), SECRET, UPLOADER, fetchBytes)).toMatchObject({ ok: true, url: 'https://cdn.test/0b6f3c1e-1111-4222-8333-944455556666.png', type: 'image/png', name: 'menu.png' });
        expect(await readGuestUpload(OTHER, receipt(), SECRET, UPLOADER, fetchBytes)).toEqual({ ok: false, why: 'refused' });
        expect(await readGuestUpload(GUEST, receipt({ exp: 1 }), SECRET, UPLOADER, fetchBytes)).toEqual({ ok: false, why: 'expired' });
        expect(await readGuestUpload(GUEST, receipt(), SECRET, UPLOADER, async () => new Uint8Array([7]))).toEqual({ ok: false, why: 'refused' });
    });
});

describe('reading checked files', () => {
    it('reads a file from the bytes it was given, and nothing else is fetched while it reads', async () => {
        const url = 'https://cdn.test/notes.txt';
        const bytes = new TextEncoder().encode('Opening hours: 9 to 5').buffer as ArrayBuffer;
        const parsed = await FileParser.withLoadedFiles(new Map([[url, { bytes, type: 'text/plain' }]]), () => FileParser.parseFile(url, 'text/plain'));
        expect(parsed).toMatchObject({ type: 'text', text: 'Opening hours: 9 to 5' });
        await FileParser.withLoadedFiles(new Map([[url, { bytes, type: 'text/plain' }]]), async () => {
            await expect(FileParser.validateUrl('https://example.com/other')).rejects.toThrow(/Only the files already read/);
            await expect(FileParser.fetchBytes('https://example.com/other', 100)).rejects.toThrow(/Only the files already read/);
            expect(await FileParser.sniffContentType(url)).toBe('text/plain');
        });
    });
});

describe("the guest Brick's reading is every bot's reading", () => {
    it('reads a text file into the message and lists only real pictures for the model, from checked bytes', async () => {
        const none = () => undefined;
        const reader = new DmReplyService({ getAIService: none, getAdminApiService: none, getConversationStorage: none, getResponseProcessor: none, getMetricsCollector: none, getConversationMemory: none } as never);
        const text = new TextEncoder().encode('Soup of the day: lentil').buffer as ArrayBuffer;
        const read = await reader.readCheckedFiles(
            'What is on?',
            [
                { url: 'https://cdn.test/a.txt', type: 'text/plain', bytes: text },
                { url: 'https://cdn.test/b.png', type: 'image/png', bytes: new Uint8Array([1]).buffer as ArrayBuffer },
            ],
            1000
        );
        expect(read.text).toContain('What is on?');
        expect(read.text).toContain('Soup of the day: lentil');
        expect(read.text).toContain('[User also sent an image: https://cdn.test/b.png]');
        expect(read.images).toEqual(['https://cdn.test/b.png']);
    });
});

const SETUP: GuestBrickSetup = {
    brick: { name: 'Brick', description: 'A helper', characterTextureId: 'brick-orange', chatInstructions: 'You are Brick.' },
    credentials: {
        providerId: 'universe-ai',
        name: 'Universe AI',
        type: 'openai',
        enabled: true,
        endpoint: 'https://ai.test/v1',
        apiKeyEncrypted: 'iv:tag:data',
        model: 'm1',
        temperature: 0.7,
        maxTokens: 900,
        supportsStreaming: true,
        source: 'universe-ai',
        limits: { replyTokens: 900, messages: 4, readChars: 3000, waitSeconds: 7 },
    },
};

function makeService(over: Partial<{ allowance: GuestBrickAllowance; throws: boolean; note: unknown }> = {}) {
    const generate = vi.fn(async (..._args: unknown[]) => {
        if (over.throws) throw new Error('provider down');
        return { content: 'It says the soup of the day.', tokensUsed: 120, latency: 5, usage: { promptTokens: 100, completionTokens: 20 } };
    });
    const admin = {
        isConfigured: vi.fn(() => true),
        getGuestBrick: vi.fn(async () => SETUP),
        claimGuestBrickReply: vi.fn(async (): Promise<GuestBrickAllowance> => over.allowance ?? { allowed: true }),
        finishGuestBrickReply: vi.fn(async () => undefined),
    };
    const notes = {
        canHearGuest: vi.fn(async () => true),
        guestNote: vi.fn(async () => over.note ?? { kind: 'heard', turnId: 'orbit-turn', generation: 2, transcript: 'what is on the menu' }),
        answered: vi.fn(async () => undefined),
        answerFailed: vi.fn(async () => undefined),
        delivered: vi.fn(async () => undefined),
    };
    const media = {
        secret: SECRET,
        notes,
        readUpload: vi.fn(async (guestId: string, value: unknown) =>
            value === 'gone' ? { ok: false, why: 'refused' } : value === 'old' ? { ok: false, why: 'expired' } : { ok: true, bytes: new Uint8Array([1, 2, 3]), url: `https://cdn.test/${String(value)}.png`, type: 'image/png', name: 'menu.png', sha256: `sha-${String(value)}` }
        ),
        readFiles: vi.fn(async (text: string, files: { url: string }[]) => ({ text: `${text}\n[User also sent an image: ${files[0].url}]`, images: files.map((file) => file.url) })),
    };
    const providers = { getOrCreateProvider: vi.fn(() => ({ isReady: () => true, generate })) };
    const service = new GuestBrickService(admin as never, providers as never, () => new Date('2026-11-13T08:00:00Z'), media as unknown as GuestBrickMedia);
    return { admin, generate, notes, media, service };
}
const ask = (over: Record<string, unknown> = {}) => ({ guestId: GUEST, turnId: 'turn-1', roomUrl: ROOM_URL, message: '', history: [], saidNeedsAccount: false, ...over });

describe('The Brick for guests reads what a guest sends', () => {
    it('reads pictures and files the way every bot does, and only this message’s pictures go to the model', async () => {
        const { generate, media, admin, service } = makeService();
        const answer = await service.reply(ask({ message: 'What does this say?', files: ['r1', 'r2'] }));
        expect(answer).toEqual({ kind: 'reply', text: 'It says the soup of the day.', needsAccount: false });
        expect(media.readUpload).toHaveBeenCalledWith(GUEST, 'r1');
        expect(media.readFiles).toHaveBeenCalledWith('What does this say?', [expect.objectContaining({ url: 'https://cdn.test/r1.png', type: 'image/png' }), expect.objectContaining({ url: 'https://cdn.test/r2.png' })], 3000);
        expect(generate.mock.calls[0][5]).toEqual(['https://cdn.test/r1.png', 'https://cdn.test/r2.png']);
        expect(String(generate.mock.calls[0][1])).toContain('[User also sent an image: https://cdn.test/r1.png]');
        expect(admin.finishGuestBrickReply).toHaveBeenCalledWith('turn-1', expect.objectContaining({ tokensUsed: 120 }));
    });

    it("refuses a file that is not the guest's, or gone, before anything is counted; an expired receipt is renewed by the device", async () => {
        const { admin, generate, service } = makeService();
        expect(await service.reply(ask({ files: ['gone'] }))).toEqual({ kind: 'upload', why: 'refused' });
        expect(await service.reply(ask({ files: ['old'] }))).toEqual({ kind: 'upload', why: 'expired' });
        expect(await service.reply(ask({ files: Array.from({ length: 11 }, (_, i) => `r${i}`) }))).toEqual({ kind: 'upload', why: 'refused' });
        expect(admin.claimGuestBrickReply).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
    });

    it('hears a voice note once, answers its words, and keeps the answer until the device has it', async () => {
        const { generate, notes, admin, service } = makeService();
        const answer = await service.reply(ask({ note: 'n1' }));
        expect(answer).toMatchObject({ kind: 'reply', text: 'It says the soup of the day.', heard: 'what is on the menu' });
        expect(readDelivery(SECRET, GUEST, (answer as { delivery: string }).delivery)).toBe('orbit-turn');
        expect(notes.guestNote).toHaveBeenCalledWith(expect.objectContaining({ guestId: GUEST, roomUrl: ROOM_URL, turnId: 'turn-1', bytes: new Uint8Array([1, 2, 3]) }));
        expect(String(generate.mock.calls[0][1])).toBe('what is on the menu');
        expect(notes.answered).toHaveBeenCalledWith('orbit-turn', 2, 'It says the soup of the day.');
        expect(admin.finishGuestBrickReply).toHaveBeenCalledWith('turn-1', expect.objectContaining({ tokensUsed: 120 }));
        // The device says it has it: the kept copy goes, for this guest only
        expect(await service.delivered(GUEST, (answer as { delivery: string }).delivery)).toBe(true);
        expect(notes.delivered).toHaveBeenCalledWith('orbit-turn');
        expect(await service.delivered(OTHER, (answer as { delivery: string }).delivery)).toBe(false);
        expect(await service.delivered(GUEST, signDelivery('another', GUEST, 'orbit-turn'))).toBe(false);
    });

    it('sends a kept answer again for the same note, without the model and without counting it again', async () => {
        const { generate, admin, service } = makeService({ allowance: { allowed: true, counted: false } as GuestBrickAllowance, note: { kind: 'answered', turnId: 'orbit-turn', transcript: 'menu?', answer: `Soup. ${'[NEEDS_ACCOUNT]'}` } });
        expect(await service.reply(ask({ note: 'n1' }))).toMatchObject({ kind: 'reply', text: 'Soup.', needsAccount: true, heard: 'menu?' });
        expect(generate).not.toHaveBeenCalled();
        expect(admin.finishGuestBrickReply).not.toHaveBeenCalled();
    });

    it('says why a note was not heard, and gives the reply back', async () => {
        for (const [note, expected] of [
            [{ kind: 'refused', why: 'too-long', longestSeconds: 300 }, { kind: 'unheard', why: 'too-long', longestSeconds: 300 }],
            [{ kind: 'refused', why: 'busy' }, { kind: 'unheard', why: 'busy' }],
            [{ kind: 'expired' }, { kind: 'unheard', why: 'expired' }],
            [{ kind: 'uncertain' }, { kind: 'unheard', why: 'uncertain' }],
        ] as const) {
            const { generate, admin, service } = makeService({ note });
            expect(await service.reply(ask({ note: 'n1' }))).toEqual(expected);
            expect(generate).not.toHaveBeenCalled();
            expect(admin.finishGuestBrickReply).toHaveBeenCalledWith('turn-1', { failed: true });
        }
    });

    it('keeps the words of a note whose answer failed, so the next try does not hear it again', async () => {
        const { notes, admin, service } = makeService({ throws: true });
        expect(await service.reply(ask({ note: 'n1' }))).toEqual({ kind: 'failed' });
        expect(notes.answerFailed).toHaveBeenCalledWith('orbit-turn', 2);
        expect(notes.answered).not.toHaveBeenCalled();
        expect(admin.finishGuestBrickReply).toHaveBeenCalledWith('turn-1', { failed: true });
    });

    it('says what it can take: files with receipts, notes when Orbit hears for guests', async () => {
        const { service, notes } = makeService();
        expect(await service.canTake()).toEqual({ files: true, notes: true });
        notes.canHearGuest.mockResolvedValueOnce(false);
        expect(await service.canTake()).toEqual({ files: true, notes: false });
        const bare = new GuestBrickService({ isConfigured: () => true } as never, {} as never);
        expect(await bare.canTake()).toEqual({ files: false, notes: false });
        expect(await bare.reply(ask({ files: ['r1'] }))).toEqual({ kind: 'upload', why: 'refused' });
    });
});

describe('POST /api/guest-brick/reply with files and notes, and the delivery', () => {
    const adminApiService = { isConfigured: vi.fn(), validateSessionToken: vi.fn(), checkDmAccess: vi.fn() };
    const guestBrick = { available: vi.fn(() => true), reply: vi.fn(), canTake: vi.fn(), delivered: vi.fn() };
    let server: Server;
    let base: string;
    const token = (identifier: string) => jwt.sign({ identifier }, SECRET, { algorithm: 'HS256' });

    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        process.env.SECRET_KEY = SECRET;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (new BotAPI({ getAccessGate: vi.fn() } as never, adminApiService as never, {} as never, [], { guestBrick: guestBrick as never }) as any).app;
        server = await new Promise<Server>((resolve) => {
            const started = app.listen(0, () => resolve(started));
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        delete process.env.SECRET_KEY;
    });
    beforeEach(() => {
        guestBrick.reply.mockReset().mockResolvedValue({ kind: 'reply', text: 'Soup.', needsAccount: false });
        guestBrick.available.mockReturnValue(true);
    });
    const post = (path: string, body: unknown, who = GUEST) =>
        fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WA-Auth': token(who) }, body: JSON.stringify(body) });
    const message = { turnId: 'turn-1', roomUrl: ROOM_URL, message: '', history: [] };

    it('takes a picture, a file or a note with no words, and refuses a message with nothing at all', async () => {
        expect((await post('/api/guest-brick/reply', { ...message, files: ['r1'] })).status).toBe(200);
        expect(guestBrick.reply).toHaveBeenLastCalledWith(expect.objectContaining({ files: ['r1'], message: '' }));
        expect((await post('/api/guest-brick/reply', { ...message, note: 'n1' })).status).toBe(200);
        expect(guestBrick.reply).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'n1' }));
        guestBrick.reply.mockClear();
        expect((await post('/api/guest-brick/reply', message)).status).toBe(400);
        expect((await post('/api/guest-brick/reply', { ...message, files: 'r1' })).status).toBe(400);
        expect((await post('/api/guest-brick/reply', { ...message, files: Array.from({ length: 11 }, () => 'r') })).status).toBe(400);
        expect((await post('/api/guest-brick/reply', { ...message, note: 7 })).status).toBe(400);
        expect(guestBrick.reply).not.toHaveBeenCalled();
    });

    it('says what the Brick for guests takes now', async () => {
        guestBrick.canTake.mockResolvedValueOnce({ files: true, notes: false });
        const response = await fetch(`${base}/api/guest-brick/media`, { headers: { 'X-WA-Auth': token(GUEST) } });
        expect(await response.json()).toEqual({ files: true, notes: false });
    });

    it("closes a kept answer only for the guest it was for", async () => {
        guestBrick.delivered.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect((await post('/api/guest-brick/delivered', { delivery: 'd' })).status).toBe(204);
        expect(guestBrick.delivered).toHaveBeenLastCalledWith(GUEST, 'd');
        expect((await post('/api/guest-brick/delivered', { delivery: 'd' })).status).toBe(403);
        expect((await post('/api/guest-brick/delivered', { delivery: 'd' }, 'alice@example.test')).status).toBe(404);
    });
});
