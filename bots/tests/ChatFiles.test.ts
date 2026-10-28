import { describe, expect, it } from 'vitest';
import { fileNote, keptTextOf, kindOf, piecesOf, storeOf, TEXT_PIECE_CHARS, withFileNotes, withoutNoteIds } from '../services/ChatFiles';
import { BotClient } from '../client/BotClient';

const ID = '0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.pdf';

describe('where a chat file is kept (#1508)', () => {
    it('keeps the bucket and id behind a signed link, which would stop working', () => {
        expect(storeOf(`https://r2.example.com/user-refs/${ID}?X-Amz-Algorithm=AWS4&X-Amz-Signature=abc`)).toEqual({ bucket: 'user-refs', fileId: ID });
    });

    it("keeps the uploader's own /upload-file link and a public link as they are, since they last", () => {
        expect(storeOf(`https://uploader.example.com/upload-file/${ID}`)).toEqual({ url: `https://uploader.example.com/upload-file/${ID}` });
        expect(storeOf(`https://cdn.example.com/${ID}`)).toEqual({ url: `https://cdn.example.com/${ID}` });
    });

    it("keeps a signed link that isn't an uploader file as a link, so Orbit turns it down instead of keeping something wrong", () => {
        const other = 'https://r2.example.com/user-refs/not-an-uploader-id.png?X-Amz-Signature=abc';
        expect(storeOf(other)).toEqual({ url: other });
    });
});

describe('the note for a file in the history', () => {
    it('names the file, its type, and its pages or length; the id once Orbit gave one', () => {
        expect(fileNote({ name: 'plan.pdf', kind: 'document', pages: 41 })).toBe('[file · "plan.pdf" · PDF · 41 pages]');
        expect(fileNote({ ref: 'f3', name: 'plan.pdf', kind: 'document', pages: 1 })).toBe('[file f3 · "plan.pdf" · PDF · 1 page]');
        expect(fileNote({ ref: 'f12', name: 'yazoghal.mp3', kind: 'audio', lengthSeconds: 192.4 })).toBe('[file f12 · "yazoghal.mp3" · MP3 · 3:12]');
        expect(fileNote({ name: 'voice', kind: 'audio', lengthSeconds: 3725 })).toBe('[file · "voice" · audio · 1:02:05]');
    });

    it('keeps a name on one line, with nothing that would end the note early', () => {
        expect(fileNote({ name: 'a "quoted"\n[name].txt', kind: 'document' })).toBe('[file · "a \'quoted\' \'name\'.txt" · TXT]');
    });

    it('reads the same with or without its ids, so a message sent again is still the same message', () => {
        const line = withFileNotes('see this', [fileNote({ ref: 'f3', name: 'plan.pdf', kind: 'document' })]);
        expect(line).toBe('see this\n[file f3 · "plan.pdf" · PDF]');
        expect(withoutNoteIds(line)).toBe(withFileNotes('see this', [fileNote({ name: 'plan.pdf', kind: 'document' })]));
        expect(withFileNotes('', ['[file · "a.png" · PNG]'])).toBe('[file · "a.png" · PNG]');
    });
});

describe('what a file is', () => {
    it('goes by how it was sent, then its type, then its name', () => {
        expect(kindOf({ name: 'x', mediaType: 'image' })).toBe('image');
        expect(kindOf({ name: 'x', mimeType: 'audio/ogg' })).toBe('audio');
        expect(kindOf({ name: 'clip', mimeType: 'video/mp4' })).toBe('video');
        expect(kindOf({ name: 'x', mimeType: 'application/pdf', mediaType: 'file' })).toBe('document');
        expect(kindOf({ name: 'notes.md', mimeType: 'application/octet-stream' })).toBe('document');
        expect(kindOf({ name: 'archive.zip', mimeType: 'application/zip' })).toBe('other');
    });
});

describe("a file's text to keep", () => {
    it('is what FileParser read, never its line for a file it could not read', () => {
        expect(keptTextOf({ type: 'document', text: 'Chapter one', summary: 'PDF', mimeType: 'application/pdf' })).toBe('Chapter one');
        expect(keptTextOf({ type: 'text', text: '[1, 2, 3]', summary: 'Text file', mimeType: 'application/json' })).toBe('[1, 2, 3]');
        expect(keptTextOf({ type: 'document', text: '[Failed to extract PDF content: bad]', summary: 'Failed', mimeType: 'application/pdf' })).toBeNull();
        expect(keptTextOf({ type: 'document', text: '[PDF document — no extractable text content]', summary: 'PDF', mimeType: 'application/pdf' })).toBeNull();
        expect(keptTextOf({ type: 'image', summary: 'Image', mimeType: 'image/png' })).toBeNull();
        expect(keptTextOf(null)).toBeNull();
    });

    it('goes in pieces Orbit takes in order, none ending in half an emoji', () => {
        const text = 'a'.repeat(TEXT_PIECE_CHARS * 2) + 'b'.repeat(TEXT_PIECE_CHARS);
        const pieces = piecesOf(text);
        expect(pieces.map((piece) => [piece.from, piece.text.length, piece.last])).toEqual([
            [0, TEXT_PIECE_CHARS, false],
            [TEXT_PIECE_CHARS, TEXT_PIECE_CHARS, false],
            [TEXT_PIECE_CHARS * 2, TEXT_PIECE_CHARS, true],
        ]);
        const emoji = piecesOf('abc😀def', 4);
        expect(emoji.map((piece) => piece.text)).toEqual(['abc', '😀de', 'f']);
        expect(emoji.map((piece) => piece.text).join('')).toBe('abc😀def');
        expect(piecesOf('')).toEqual([{ from: 0, text: '', last: true }]);
    });
});

describe("a nearby chat message's uploads", () => {
    it('are the upload and its gallery with the names they were sent with, never the links typed in the text', () => {
        expect(
            BotClient.uploadsOf(
                { url: 'https://u/1.pdf', mediaType: 'file', galleryUrls: ['https://u/2.png'], fileName: 'plan.pdf', fileNames: ['plan.pdf', 'map.png'] },
                'application/pdf'
            )
        ).toEqual([
            { url: 'https://u/1.pdf', name: 'plan.pdf', mimeType: 'application/pdf', mediaType: 'file' },
            { url: 'https://u/2.png', name: 'map.png', mimeType: null, mediaType: null },
        ]);
        expect(BotClient.uploadsOf({ url: 'https://u/x/abc.png', fileName: undefined })).toEqual([
            { url: 'https://u/x/abc.png', name: 'abc.png', mimeType: null, mediaType: null },
        ]);
        expect(BotClient.uploadsOf({ galleryUrls: ['https://typed.example.com'] })).toBeUndefined();
    });
});
