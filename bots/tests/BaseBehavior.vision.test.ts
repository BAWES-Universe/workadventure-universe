/**
 * Tests for BaseBehavior.collectImageUrls — image attachment collection for
 * vision routing.
 *
 * Covers:
 *  - Single uploaded image
 *  - Gallery of images
 *  - Text URL + upload (both kept, upload not lost)
 *  - Non-image attachments excluded
 *  - Deduplication
 *  - mediaType 'image' wins even when mime inference fails
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { BaseBehavior } from '../behaviors/BaseBehavior';
import type { BehaviorConfig } from '../behaviors/BaseBehavior';

// Mock FileParser so extension-less gallery URLs classify via sniff without
// hitting the network in unit tests.
vi.mock('../services/FileParser', () => ({
    FileParser: {
        sniffContentType: vi.fn(async (url: string) => {
            if (url.includes('photo-') || url.includes('unsplash')) return 'image/jpeg';
            if (url.includes('s3')) return 'image/png';
            return null;
        }),
        validateUrl: vi.fn(async () => {}),
        parseFile: vi.fn(async () => ({ type: 'unknown', mimeType: null, url: '' })),
    },
}));

class TestableBehavior extends BaseBehavior {
    constructor() {
        super({} as BehaviorConfig);
    }
    update(_deltaTime: number): void {}
    onChatMessage(): Promise<void> { return Promise.resolve(); }
    getConversationMemory(_playerId: number): any { return null; }
    generateAIResponseStream(): Promise<void> { return Promise.resolve(); }

    testCollectImageUrls(
        url?: string,
        mediaType?: string,
        mimeType?: string,
        galleryUrls?: string[]
    ): Promise<string[]> {
        return this.collectImageUrls(url, mediaType, mimeType, galleryUrls);
    }
}

describe('collectImageUrls — vision attachment collection', () => {
    let behavior: TestableBehavior;

    beforeEach(() => {
        behavior = new TestableBehavior();
    });

    it('collects a single uploaded image', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://cdn.example.com/img.png',
            'image',
            'image/png'
        );
        expect(urls).toEqual(['https://cdn.example.com/img.png']);
    });

    it('collects gallery images plus the primary upload', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://cdn.example.com/a.png',
            'image',
            'image/png',
            ['https://cdn.example.com/b.jpg', 'https://cdn.example.com/c.webp']
        );
        expect(urls).toEqual([
            'https://cdn.example.com/a.png',
            'https://cdn.example.com/b.jpg',
            'https://cdn.example.com/c.webp',
        ]);
    });

    it('excludes non-image attachments', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://cdn.example.com/doc.pdf',
            'file',
            'application/pdf'
        );
        expect(urls).toEqual([]);
    });

    it('collects extension-less gallery images via content sniffing', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://cdn.example.com/a.png',
            'image',
            'image/png',
            ['https://img.unsplash.com/photo-12345', 'https://cdn.example.com/b.jpg']
        );
        expect(urls).toEqual([
            'https://cdn.example.com/a.png',
            'https://img.unsplash.com/photo-12345',
            'https://cdn.example.com/b.jpg',
        ]);
    });

    it('does not collect extension-less non-image gallery URLs', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://cdn.example.com/a.png',
            'image',
            'image/png',
            ['https://img.unsplash.com/photo-1', 'https://example.com/page/about']
        );
        expect(urls).toEqual(['https://cdn.example.com/a.png', 'https://img.unsplash.com/photo-1']);
    });

    it('excludes non-image gallery entries', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://cdn.example.com/a.png',
            'image',
            'image/png',
            ['https://cdn.example.com/notes.txt', 'https://cdn.example.com/b.jpg']
        );
        expect(urls).toEqual([
            'https://cdn.example.com/a.png',
            'https://cdn.example.com/b.jpg',
        ]);
    });

    it('uses mediaType image even when the mime is missing/unknown', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://img.unsplash.com/photo-12345', // no extension
            'image',
            undefined
        );
        expect(urls).toEqual(['https://img.unsplash.com/photo-12345']);
    });

    it('recognizes images from extension when mediaType is undefined', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://example.com/pic.png',
            undefined,
            undefined
        );
        expect(urls).toEqual(['https://example.com/pic.png']);
    });

    it('recognizes extension-less images via sniff when mediaType is undefined', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://img.unsplash.com/photo-67890',
            undefined,
            undefined
        );
        expect(urls).toEqual(['https://img.unsplash.com/photo-67890']);
    });

    it('deduplicates the same URL appearing as upload and in gallery', async () => {
        const urls = await behavior.testCollectImageUrls(
            'https://cdn.example.com/a.png',
            'image',
            'image/png',
            ['https://cdn.example.com/a.png']
        );
        expect(urls).toEqual(['https://cdn.example.com/a.png']);
    });

    it('returns empty when nothing is an image', async () => {
        expect(await behavior.testCollectImageUrls()).toEqual([]);
        expect(
            await behavior.testCollectImageUrls(undefined, undefined, undefined, [
                'https://e.com/x.pdf',
            ])
        ).toEqual([]);
    });
});
