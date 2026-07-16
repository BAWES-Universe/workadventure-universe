/**
 * Tests for FileParser — fetches URLs and extracts content by mimeType.
 *
 * Covers:
 *  - Text files: fetch and return inline content
 *  - Images: note URL, no extraction
 *  - Unknown/binary files: note filename and type
 *  - Error handling: fetch failures return graceful fallback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => {
    const mockGet = vi.fn();
    return {
        default: {
            get: mockGet,
            isAxiosError: vi.fn((err: any) => err?.isAxiosError === true),
        },
    };
});

import axios from 'axios';
import { FileParser } from '../services/FileParser';

const mockedAxios = vi.mocked(axios, true);

describe('FileParser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('parseFile', () => {
        it('fetches and returns text file content', async () => {
            const url = 'https://cdn.example.com/code.ts';
            const content = 'const x = 1;\nconsole.log(x);';

            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from(content),
                headers: { 'content-type': 'text/typescript' },
            });

            const result = await FileParser.parseFile(url, 'text/typescript');

            expect(result.type).toBe('text');
            expect(result.text).toBe(content);
            expect(result.mimeType).toBe('text/typescript');
            expect(result.truncated).toBeFalsy();
        });

        it('returns image type without fetching content', async () => {
            const url = 'https://cdn.example.com/photo.png';

            const result = await FileParser.parseFile(url, 'image/png');

            expect(result.type).toBe('image');
            expect(result.url).toBe(url);
            expect(result.text).toBeUndefined();
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('returns unknown type for unrecognized mime types', async () => {
            const url = 'https://cdn.example.com/file.zip';

            const result = await FileParser.parseFile(url, 'application/zip');

            expect(result.type).toBe('unknown');
            expect(result.url).toBe(url);
            expect(result.text).toBeUndefined();
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('truncates text content exceeding MAX_FILE_CHARS', async () => {
            const url = 'https://cdn.example.com/large.txt';
            const line = 'a'.repeat(100);
            const content = Array.from({ length: 110 }, () => line).join('\n');

            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from(content),
                headers: { 'content-type': 'text/plain' },
            });

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text!.length).toBeLessThanOrEqual(FileParser.MAX_FILE_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('returns error summary when fetch fails', async () => {
            const url = 'https://cdn.example.com/missing.txt';

            mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('Failed to fetch');
        });

        it('returns unknown for PDF when pdf-parse is not available', async () => {
            const url = 'https://cdn.example.com/report.pdf';

            const result = await FileParser.parseFile(url, 'application/pdf');

            expect(result.type).toBe('unknown');
            expect(result.url).toBe(url);
        });
    });

    describe('getExtension', () => {
        it('extracts extension from URL path', () => {
            expect(FileParser.getExtension('https://example.com/file.ts')).toBe('ts');
            expect(FileParser.getExtension('https://example.com/image.png?v=2')).toBe('png');
            expect(FileParser.getExtension('https://example.com/file')).toBe('');
        });
    });
});
