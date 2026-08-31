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
import { FileParser } from '../services/FileParser';

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
        (FileParser.validateUrl as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        (FileParser.sniffContentType as ReturnType<typeof vi.fn>).mockImplementation(
            async (url: string) => {
                if (url.includes('photo-') || url.includes('unsplash')) return 'image/jpeg';
                if (url.includes('s3')) return 'image/png';
                return null;
            }
        );
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

    it('excludes an unsafe destination even when the extension says image (SSRF)', async () => {
        // validateUrl throws for internal/private destinations — the URL must
        // NOT reach the vision provider as an image_url block.
        (FileParser.validateUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('blocked: private IP')
        );
        const urls = await behavior.testCollectImageUrls(
            'http://169.254.169.254/latest/meta.png',
            'image',
            'image/png'
        );
        expect(urls).toEqual([]);
    });

    it('excludes an unsafe primary URL even when mimeType was supplied (SSRF)', async () => {
        // Primary URLs with a provided mimeType used to skip classification
        // entirely — the SSRF check must still apply.
        (FileParser.validateUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('blocked: private IP')
        );
        const urls = await behavior.testCollectImageUrls(
            'http://10.0.0.5/internal.png',
            undefined,
            'image/png'
        );
        expect(urls).toEqual([]);
    });

    it('excludes unsafe gallery URLs while keeping safe ones (SSRF)', async () => {
        (FileParser.validateUrl as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(undefined) // primary a.png: safe
            .mockRejectedValueOnce(new Error('blocked')) // gallery internal.png
            .mockResolvedValueOnce(undefined); // gallery b.jpg: safe
        const urls = await behavior.testCollectImageUrls(
            'https://cdn.example.com/a.png',
            'image',
            'image/png',
            ['http://192.168.1.1/internal.png', 'https://cdn.example.com/b.jpg']
        );
        expect(urls).toEqual(['https://cdn.example.com/a.png', 'https://cdn.example.com/b.jpg']);
    });

    it('classifies the primary URL first — octet-stream mimeType does not drop a real image', async () => {
        // Extension-less image with generic application/octet-stream MIME must
        // be retained: classification (sniff) wins over the supplied mimeType.
        const urls = await behavior.testCollectImageUrls(
            'https://img.unsplash.com/photo-99999',
            undefined,
            'application/octet-stream'
        );
        expect(urls).toEqual(['https://img.unsplash.com/photo-99999']);
    });

    it('falls back to the supplied mimeType when classification yields nothing', async () => {
        // Sniff returns null (unknown) → supplied mimeType still applies.
        const urls = await behavior.testCollectImageUrls(
            'https://example.com/unknown-image',
            undefined,
            'image/png'
        );
        expect(urls).toEqual(['https://example.com/unknown-image']);
    });
});
