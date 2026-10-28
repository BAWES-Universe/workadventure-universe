import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatFileKeeper, type FileJob } from '../services/ChatFileKeeper';
import { ArtifactCallError } from '../server/AdminApiService';
import type { ParsedFile } from '../services/FileParser';

const call = { botId: 'bot1', person: { signedIn: true, identifier: 'uuid-alice', name: 'Alice' }, chat: { kind: 'dm' as const, ref: '!room' } };
const SIGNED = 'https://r2.example.com/user-refs/0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.pdf?X-Amz-Signature=abc';

function job(extra: Partial<FileJob> = {}): FileJob {
    return {
        call,
        personRef: 'uuid-alice',
        upload: { url: SIGNED, name: 'plan.pdf', mimeType: 'application/pdf', mediaType: 'file', sizeBytes: 1200 },
        kind: 'document',
        pages: 3,
        maxTextChars: 2_000_000,
        ...extra,
    };
}

function orbit() {
    let next = 1;
    return {
        addBotFile: vi.fn(async (_call: unknown, file: { name: string }) => ({ file: { ref: `f${next++}`, name: file.name }, hidden: false })),
        keepBotFileText: vi.fn(async () => ({ file: {}, hidden: false })),
    };
}

describe('keeping the files people send (#1508)', () => {
    let admin: ReturnType<typeof orbit>;
    let parse: ReturnType<typeof vi.fn>;
    let keeper: ChatFileKeeper;

    beforeEach(() => {
        admin = orbit();
        parse = vi.fn(async (): Promise<ParsedFile> => ({ type: 'document', text: 'the whole book', summary: 'PDF', mimeType: 'application/pdf' }));
        keeper = new ChatFileKeeper(parse as never, 1);
    });

    it('adds each file with where it is kept, gives its note its id, and keeps the text the reply read whole', async () => {
        const refs: string[] = [];
        const kept = await keeper.keepAll(admin as never, [job({ text: 'all of it', onRef: (ref) => refs.push(ref) })]);
        expect(kept).toEqual(['f1']);
        expect(refs).toEqual(['f1']);
        expect(admin.addBotFile).toHaveBeenCalledWith(call, {
            source: 'person',
            kind: 'document',
            name: 'plan.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1200,
            store: { bucket: 'user-refs', fileId: '0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.pdf' },
            lengthSeconds: null,
            pages: 3,
        });
        expect(admin.keepBotFileText).toHaveBeenCalledWith(call, 'f1', { from: 0, text: 'all of it', last: true });
        expect(parse).not.toHaveBeenCalled();
    });

    it("gives a message's files their ids in the order they were sent", async () => {
        const refs: string[] = [];
        await keeper.keepAll(admin as never, [job({ onRef: (ref) => refs.push(`a:${ref}`) }), job({ onRef: (ref) => refs.push(`b:${ref}`) })]);
        expect(refs).toEqual(['a:f1', 'b:f2']);
    });

    it('reads the whole file again afterwards when the reply read only part, up to "Text kept from a file"', async () => {
        await keeper.keepAll(admin as never, [job({ readAgain: { mimeType: 'application/pdf' }, maxTextChars: 5 })]);
        await keeper.idle();
        expect(parse).toHaveBeenCalledWith(SIGNED, 'application/pdf', 5);
        // Orbit refuses text past the setting, so it is never sent past it
        expect(admin.keepBotFileText).toHaveBeenCalledWith(call, 'f1', { from: 0, text: 'the w', last: true });
    });

    it('says when a document the reply could not read has no text, and sends none when "Text kept from a file" is 0', async () => {
        await keeper.keepAll(admin as never, [job({ text: null })]);
        expect(admin.keepBotFileText).toHaveBeenCalledWith(call, 'f1', { failed: true });
        admin.keepBotFileText.mockClear();
        await keeper.keepAll(admin as never, [job({ text: 'all of it', maxTextChars: 0 }), job({ text: null, maxTextChars: 0 })]);
        expect(admin.addBotFile).toHaveBeenCalledTimes(3);
        expect(admin.keepBotFileText).not.toHaveBeenCalled();
    });

    it('says when the text could not be read, and keeps nothing for an image or a song', async () => {
        parse.mockResolvedValueOnce({ type: 'document', text: '[Failed to extract PDF content: bad]', summary: 'Failed', mimeType: 'application/pdf' });
        await keeper.keepAll(admin as never, [job({ readAgain: { mimeType: 'application/pdf' } })]);
        await keeper.idle();
        expect(admin.keepBotFileText).toHaveBeenCalledWith(call, 'f1', { failed: true });
        admin.keepBotFileText.mockClear();
        await keeper.keepAll(admin as never, [job({ kind: 'audio', upload: { url: 'https://cdn/x.mp3', name: 'x.mp3', lengthSeconds: 12.6 } })]);
        expect(admin.addBotFile.mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'audio', lengthSeconds: 13, store: { url: 'https://cdn/x.mp3' } });
        expect(admin.keepBotFileText).not.toHaveBeenCalled();
    });

    it('tries once more when Orbit could not be reached, never when it said no, and never throws', async () => {
        admin.addBotFile.mockRejectedValueOnce(new ArtifactCallError('orbit_unavailable', 503, 'down'));
        expect(await keeper.keepAll(admin as never, [job()])).toEqual(['f1']);
        expect(admin.addBotFile).toHaveBeenCalledTimes(2);

        admin.addBotFile.mockReset().mockRejectedValue(new ArtifactCallError('signed_link', 422, 'no'));
        expect(await keeper.keepAll(admin as never, [job()])).toEqual([null]);
        expect(admin.addBotFile).toHaveBeenCalledTimes(1);

        admin.addBotFile.mockReset().mockRejectedValue(new ArtifactCallError('orbit_unavailable', 503, 'down'));
        expect(await keeper.keepAll(admin as never, [job()])).toEqual([null]);
        expect(admin.addBotFile).toHaveBeenCalledTimes(2);

        admin.addBotFile.mockReset().mockResolvedValue({ file: { ref: 'f9' }, hidden: false } as never);
        admin.keepBotFileText.mockRejectedValue(new ArtifactCallError('orbit_unavailable', 503, 'down'));
        await expect(keeper.keepAll(admin as never, [job({ text: 'words' })])).resolves.toEqual(['f9']);
    });

    it("drops a file's text that is still waiting when Orbit says to forget that person, and nobody else's", async () => {
        let release!: () => void;
        parse.mockImplementation(async () => {
            await new Promise<void>((resolve) => (release = resolve));
            return { type: 'document', text: 'late words', summary: 'PDF', mimeType: 'application/pdf' };
        });
        await keeper.keepAll(admin as never, [job({ readAgain: { mimeType: 'application/pdf' } })]);
        keeper.forget('bot1', { everyone: false, userUuids: ['uuid-bob'] });
        keeper.forget('bot2', { everyone: true, userUuids: [] });
        keeper.forget('bot1', { everyone: false, userUuids: ['uuid-alice'] });
        release();
        await keeper.idle();
        expect(admin.keepBotFileText).not.toHaveBeenCalled();

        // After the Forget, a new file is kept as usual
        await keeper.keepAll(admin as never, [job({ text: 'new' })]);
        expect(admin.keepBotFileText).toHaveBeenCalledTimes(1);
    });

    it('counts each Forget once, so one Orbit repeats does not drop a file sent after it', async () => {
        const forget = { everyone: false, userUuids: ['uuid-alice'], rows: [{ id: 'fg1', userUuid: 'uuid-alice' }] };
        keeper.forget('bot1', forget);
        admin.addBotFile.mockImplementation(async () => {
            // The same Forget again, in an answer that came while this file was being kept
            keeper.forget('bot1', forget);
            return { file: { ref: 'f1' }, hidden: false } as never;
        });
        const onRef = vi.fn();
        await keeper.keepAll(admin as never, [job({ text: 'words', onRef })]);
        expect(onRef).toHaveBeenCalledWith('f1');
        expect(admin.keepBotFileText).toHaveBeenCalledTimes(1);
        // A new Forget of the same person (a new id) still drops what is waiting
        admin.addBotFile.mockImplementation(async () => {
            keeper.forget('bot1', { everyone: false, userUuids: ['uuid-alice'], rows: [{ id: 'fg2', userUuid: 'uuid-alice' }] });
            return { file: { ref: 'f2' }, hidden: false } as never;
        });
        await keeper.keepAll(admin as never, [job({ text: 'words' })]);
        expect(admin.keepBotFileText).toHaveBeenCalledTimes(1);
    });

    it('drops it when Orbit says to forget everyone the bot talked to', async () => {
        admin.addBotFile.mockImplementation(async () => {
            keeper.forget('bot1', { everyone: true, userUuids: [] });
            return { file: { ref: 'f1' }, hidden: false } as never;
        });
        const onRef = vi.fn();
        await keeper.keepAll(admin as never, [job({ text: 'words', onRef })]);
        expect(onRef).not.toHaveBeenCalled();
        expect(admin.keepBotFileText).not.toHaveBeenCalled();
    });
});
