/**
 * Tests for FileParser — fetches URLs and extracts content by mimeType.
 *
 * Covers:
 *  - Text files: fetch and return inline content
 *  - Images: note URL, no extraction
 *  - PDF documents: extract text via pdf-parse
 *  - Word documents: extract text via mammoth
 *  - Spreadsheets: parse cells via xlsx
 *  - Web pages: extract markdown via Readability + Turndown
 *  - Unknown/binary files: note filename and type
 *  - Error handling: fetch failures return graceful fallback
 *  - SSRF: private/internal URLs rejected before fetch
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

// Mock pdf-parse (class-based v2 API)
const mockPdfParseGetInfo = vi.fn().mockResolvedValue({ total: 2 });
const mockPdfParseGetText = vi.fn().mockResolvedValue({ text: 'PDF extracted content here.\nPage 2 content.' });
const mockPdfParseDestroy = vi.fn().mockResolvedValue(undefined);

vi.mock('pdf-parse', () => {
    const MockPDFParse = vi.fn().mockImplementation(() => ({
        getInfo: mockPdfParseGetInfo,
        getText: mockPdfParseGetText,
        destroy: mockPdfParseDestroy,
    }));

    return {
        PDFParse: MockPDFParse,
        default: { PDFParse: MockPDFParse },
    };
});

// Mock mammoth
vi.mock('mammoth', () => ({
    extractRawText: vi.fn().mockResolvedValue({
        value: 'Word document content extracted via mammoth.',
        messages: [],
    }),
}));

// Mock xlsx (CJS module — mock exports directly, not wrapped in default)
// Keep the real xlsx module so tests validate actual parsing behavior.
// A mock would hide incorrect API usage like type: 'buffer' vs type: 'array'.
vi.mock('xlsx', async () => await vi.importActual('xlsx'));

// Mock DNS so test hostnames resolve to a public IP (our fail-closed fix rejects unresolvable)
const { mockResolve4, mockResolve6 } = vi.hoisted(() => ({
   mockResolve4: vi.fn().mockResolvedValue(['1.2.3.4']),
   mockResolve6: vi.fn().mockResolvedValue(['2001:db8::1']),
}));
vi.mock('dns/promises', () => ({
   resolve4: mockResolve4,
   resolve6: mockResolve6,
}));

import { FileParser } from '../services/FileParser';

/**
 * Helper to mock global fetch with a single-chunk body stream.
 * Returns a mock response with streaming body compatible with FileParser.fetchBuffer.
 */
function mockFetchOnce(data: string | Uint8Array | ArrayBuffer, status = 200) {
    const body = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    let done = false;
    const reader = {
        read: async () => {
            if (done) return { done: true, value: undefined as Uint8Array | undefined };
            done = true;
            return { done: false, value: body };
        },
        cancel: async () => {},
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: status >= 200 && status < 300,
        status,
        body: { getReader: () => reader },
        headers: new Map(),
    });
}

describe('FileParser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock for fetch — returns 404 for any un-mocked request
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    });

    describe('parseFile', () => {
        it('fetches and returns text file content', async () => {
            const url = 'https://cdn.example.com/code.ts';
            const content = 'const x = 1;\nconsole.log(x);';

            mockFetchOnce(content);

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
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('extracts PDF content via pdf-parse', async () => {
            const url = 'https://cdn.example.com/report.pdf';

            mockFetchOnce('%PDF-1.4 fake pdf data');

            const result = await FileParser.parseFile(url, 'application/pdf');

            expect(result.type).toBe('document');
            expect(result.text).toContain('PDF extracted content');
            expect(result.metadata?.pageCount).toBe(2);
            expect(result.truncated).toBeFalsy();
        });

        it('extracts Word document content via mammoth', async () => {
            const url = 'https://cdn.example.com/report.docx';

            mockFetchOnce('fake docx data');

            const result = await FileParser.parseFile(
                url,
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );

            expect(result.type).toBe('document');
            expect(result.text).toContain('Word document content extracted');
            expect(result.truncated).toBeFalsy();
        });

        it('extracts spreadsheet content via real xlsx parsing', async () => {
            const url = 'https://cdn.example.com/data.xlsx';

            // Create a real xlsx buffer using the actual xlsx library
            const XLSX = await import('xlsx');
            const realWb = XLSX.utils.book_new();
            const realWs = XLSX.utils.aoa_to_sheet([
                ['Name', 'Age', 'City'],
                ['Alice', '30', 'New York'],
                ['Bob', '25', 'London'],
            ]);
            XLSX.utils.book_append_sheet(realWb, realWs, 'Sheet1');
            const secondWs = XLSX.utils.aoa_to_sheet([['Date', 'Event']]);
            XLSX.utils.book_append_sheet(realWb, secondWs, 'Sheet2');
            const xlsxBuffer: ArrayBuffer = XLSX.write(realWb, { type: 'array', bookType: 'xlsx' });

            // Mock the global fetch API that FileParser.fetchBuffer uses
            const originalFetch = globalThis.fetch;
            globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.startsWith('https://cdn.example.com/data.xlsx')) {
                    let streamDone = false;
                    const reader = {
                        read: async () => {
                            if (streamDone) return { done: true, value: undefined };
                            streamDone = true;
                            return { done: false, value: new Uint8Array(xlsxBuffer) };
                        },
                        cancel: async () => {},
                    };
                    return {
                        ok: true,
                        status: 200,
                        body: { getReader: () => reader },
                        headers: new Map([['content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]),
                    };
                }
                return new Response(null, { status: 404 });
            });

            const result = await FileParser.parseFile(
                url,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );

            // Restore original fetch
            globalThis.fetch = originalFetch;

            expect(result.type).toBe('document');
            expect(result.text).toContain('Sheet1');
            expect(result.text).toContain('Alice');
            expect(result.text).toContain('New York');
            expect(result.text).toContain('Sheet2');
            expect(result.text).toContain('Date');
            expect(result.text).toContain('Event');
            expect(result.metadata?.sheetCount).toBe(2);
            expect(result.truncated).toBeFalsy();
        });

        it('extracts web page HTML content', async () => {
            const url = 'https://example.com/blog/post';

            mockFetchOnce('<!DOCTYPE html><html><head><title>Blog Post</title></head><body><article><h1>Blog Post</h1><p>This is the article content.</p></article></body></html>');

            const result = await FileParser.parseFile(url, 'text/html');

            expect(result.type).toBe('webpage');
            expect(result.text).toContain('Blog Post');
            expect(result.text).toContain('article content');
            expect(result.metadata?.title).toBe('Blog Post');
        });

        it('returns unknown type for unrecognized mime types', async () => {
            const url = 'https://cdn.example.com/file.zip';

            const result = await FileParser.parseFile(url, 'application/zip');

            expect(result.type).toBe('unknown');
            expect(result.url).toBe(url);
            expect(result.text).toBeUndefined();
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('truncates text content exceeding MAX_FILE_CHARS', async () => {
            const url = 'https://cdn.example.com/large.txt';
            const line = 'a'.repeat(100);
            const content = Array.from({ length: 110 }, () => line).join('\n');

            mockFetchOnce(content);

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text!.length).toBeLessThanOrEqual(FileParser.MAX_FILE_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('returns error summary when text fetch fails', async () => {
            const url = 'https://cdn.example.com/missing.txt';

            // fetch rejects = network error
            (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('Failed to fetch');
        });

        it('returns error summary when PDF fetch fails', async () => {
            const url = 'https://cdn.example.com/broken.pdf';

            (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('PDF download failed'));

            const result = await FileParser.parseFile(url, 'application/pdf');

            expect(result.type).toBe('document');
            expect(result.text).toContain('Failed to extract PDF');
        });

        it('returns error summary when web page fetch fails', async () => {
            const url = 'https://example.com/broken';

            (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Connection refused'));

            const result = await FileParser.parseFile(url, 'text/html');

            expect(result.type).toBe('webpage');
            expect(result.text).toContain('Failed to fetch web page');
        });

        it('handles .doc files as Word documents', async () => {
            const url = 'https://cdn.example.com/old.doc';

            mockFetchOnce('fake doc data');

            const result = await FileParser.parseFile(url, 'application/msword');

            expect(result.type).toBe('document');
            expect(result.text).toContain('Word document');
        });

        it('handles .xls files as spreadsheets', async () => {
            const url = 'https://cdn.example.com/data.xls';

            mockFetchOnce('fake xls data');

            const result = await FileParser.parseFile(url, 'application/vnd.ms-excel');

            expect(result.type).toBe('document');
            expect(result.text).toContain('Sheet1');
        });

        it('rejects private IP hostname for SSRF safety', async () => {
            const url = 'http://192.168.1.1/config.txt';

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('private');
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('rejects localhost URL for SSRF safety', async () => {
            const url = 'http://localhost:8080/secrets';

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('private');
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('rejects metadata service URL for SSRF safety', async () => {
            const url = 'http://169.254.169.254/latest/meta-data/';

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('private');
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('rejects private URL for PDF fetch', async () => {
            const url = 'http://10.0.0.1/document.pdf';

            const result = await FileParser.parseFile(url, 'application/pdf');

            expect(result.type).toBe('document');
            expect(result.text).toContain('private');
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('rejects private URL for web page fetch', async () => {
            const url = 'http://192.168.1.100';

            const result = await FileParser.parseFile(url, 'text/html');

            expect(result.type).toBe('webpage');
            expect(result.text).toContain('private');
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });
    });

    describe('getExtension', () => {
        it('extracts extension from URL path', () => {
            expect(FileParser.getExtension('https://example.com/file.ts')).toBe('ts');
            expect(FileParser.getExtension('https://example.com/image.png?v=2')).toBe('png');
            expect(FileParser.getExtension('https://example.com/file')).toBe('');
        });
    });

    describe('sniffContentType — extension-less URL content-type sniffing', () => {
        function mockHeadResponse(contentType: string | null) {
            (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                ok: true,
                headers: {
                    get: (name: string) =>
                        name.toLowerCase() === 'content-type' ? contentType : null,
                },
            });
        }

        it('returns the Content-Type from a HEAD response', async () => {
            mockHeadResponse('image/jpeg');
            const type = await FileParser.sniffContentType('https://img.unsplash.com/photo-12345');
            expect(type).toBe('image/jpeg');
        });

        it('strips parameters from the content type', async () => {
            mockHeadResponse('image/png; charset=binary');
            const type = await FileParser.sniffContentType('https://cdn.example.com/photo?id=1');
            expect(type).toBe('image/png');
        });

        it('returns null when there is no content-type header', async () => {
            mockHeadResponse(null);
            const type = await FileParser.sniffContentType('https://example.com/noheader');
            expect(type).toBeNull();
        });

        it('returns null on network failure (no throw)', async () => {
            (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                new Error('network down')
            );
            const type = await FileParser.sniffContentType('https://example.com/down');
            expect(type).toBeNull();
        });

        it('rejects private/internal hosts via the SSRF guard (returns null, no fetch)', async () => {
            const type = await FileParser.sniffContentType('http://127.0.0.1:5432/internal');
            expect(type).toBeNull();
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });
    });
});
