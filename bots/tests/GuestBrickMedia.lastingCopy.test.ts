/**
 * What a carried chat keeps of a guest's files (plan v3 section 7): a link that still opens next week, and one copy for one file
 * however many carries ask at the same moment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ uploadAttachment: vi.fn() }));
vi.mock('../matrix/uploadAttachment', () => ({ uploadAttachment: hoisted.uploadAttachment }));

import { buildCarryCopy, copyCarriedMedia, lastingLinkOf, type CarryCopy } from '../server/GuestBrickMedia';

const UPLOADER = 'https://uploader.test';
const FILE = '0b7c1d2e-1111-4222-8333-944455556666.png';
const SIGNED = `https://cdn.test/user-refs/${FILE}?X-Amz-Signature=abc&X-Amz-Expires=3600`;

afterEach(() => vi.clearAllMocks());

describe('the link a copy is kept under', () => {
    it("is the uploader's lasting chat-file link when the uploader answered with a signed link that runs out", () => {
        expect(lastingLinkOf(SIGNED, UPLOADER)).toBe(`${UPLOADER}/chat-file/user-refs/${FILE}`);
        expect(lastingLinkOf(SIGNED, `${UPLOADER}/`)).toBe(`${UPLOADER}/chat-file/user-refs/${FILE}`);
    });

    it('is left as it is when it already lasts', () => {
        expect(lastingLinkOf(`https://cdn.public.test/${FILE}`, UPLOADER)).toBe(`https://cdn.public.test/${FILE}`);
        expect(lastingLinkOf(`${UPLOADER}/upload-file/${FILE}`, UPLOADER)).toBe(`${UPLOADER}/upload-file/${FILE}`);
    });

    it('is what a carried chat is given for the copy, never the signed link', async () => {
        hoisted.uploadAttachment.mockResolvedValue(SIGNED);
        const copy = buildCarryCopy({ guestChatHandedTo: async () => true } as never, 'guest-1', 'uuid-alice', { SECRET_KEY: 's', UPLOADER_URL: UPLOADER } as never)!;
        expect(await copy.store(new Uint8Array([1]), 'image/png', 'a.png')).toBe(`${UPLOADER}/chat-file/user-refs/${FILE}`);
        hoisted.uploadAttachment.mockResolvedValue(null);
        expect(await copy.store(new Uint8Array([1]), 'image/png', 'a.png')).toBeNull();
    });
});

describe('copies of the same file made at the same moment', () => {
    it('are one copy: the second carry waits for the first instead of reading and storing the file again', async () => {
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => (release = resolve));
        const steps: CarryCopy = {
            handed: vi.fn(async () => true),
            read: vi.fn(async () => {
                await held;
                return { ok: true, bytes: new Uint8Array([1, 2]), url: 'guest-link', type: 'image/png', name: 'a.png', sha256: 's' } as never;
            }),
            store: vi.fn(async () => `${UPLOADER}/chat-file/user-refs/${FILE}`),
        };
        const lines = [{ from: 'guest', text: 'look', at: 1, media: [{ kind: 'file', name: 'a.png', type: 'image/png', receipt: 'r-same' }] }] as never;
        const first = copyCarriedMedia('guest-overlap', lines, steps);
        const second = copyCarriedMedia('guest-overlap', lines, steps);
        await new Promise((resolve) => setTimeout(resolve, 5));
        release();
        const [one, two] = await Promise.all([first, second]);
        expect(steps.read).toHaveBeenCalledTimes(1);
        expect(steps.store).toHaveBeenCalledTimes(1);
        expect(one[0].media?.[0]).toMatchObject({ url: `${UPLOADER}/chat-file/user-refs/${FILE}` });
        expect(two[0].media?.[0]).toMatchObject({ url: `${UPLOADER}/chat-file/user-refs/${FILE}` });
    });

    it('can be tried again when the first one failed, and the failure reaches every carry that waited for it', async () => {
        const steps: CarryCopy = {
            handed: vi.fn(async () => true),
            read: vi.fn(async () => ({ ok: true, bytes: new Uint8Array([1]), url: 'g', type: 'image/png', name: 'a.png', sha256: 's' }) as never),
            store: vi.fn().mockRejectedValueOnce(new Error('storage down')).mockResolvedValue('https://cdn.test/ok.png'),
        };
        const lines = [{ from: 'guest', text: 'look', at: 1, media: [{ kind: 'file', name: 'a.png', type: 'image/png', receipt: 'r-retry' }] }] as never;
        await expect(copyCarriedMedia('guest-retry', lines, steps)).rejects.toThrow('Could not copy');
        const again = await copyCarriedMedia('guest-retry', lines, steps);
        expect(again[0].media?.[0]).toMatchObject({ url: 'https://cdn.test/ok.png' });
    });
});
