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
vi.mock('xlsx', () => {
    const mockSheetToJson = vi.fn().mockReturnValue([
        ['Name', 'Age', 'City'],
        ['Alice', '30', 'New York'],
        ['Bob', '25', 'London'],
    ]);

    const mockDecodeRange = vi.fn().mockReturnValue({ s: { r: 0, c: 0 }, e: { r: 2, c: 2 } });

    return {
        read: vi.fn().mockReturnValue({
            SheetNames: ['Sheet1', 'Sheet2'],
            Sheets: {
                Sheet1: { '!ref': 'A1:C3' },
                Sheet2: { '!ref': 'A1:B1' },
            },
        }),
        utils: {
            sheet_to_json: mockSheetToJson,
            decode_range: mockDecodeRange,
        },
        write: vi.fn(),
        writeFile: vi.fn(),
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

        it('extracts PDF content via pdf-parse', async () => {
            const url = 'https://cdn.example.com/report.pdf';

            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from('%PDF-1.4 fake pdf data'),
            });

            const result = await FileParser.parseFile(url, 'application/pdf');

            expect(result.type).toBe('document');
            expect(result.text).toContain('PDF extracted content');
            expect(result.metadata?.pageCount).toBe(2);
            expect(result.truncated).toBeFalsy();
        });

        it('extracts Word document content via mammoth', async () => {
            const url = 'https://cdn.example.com/report.docx';

            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from('fake docx data'),
            });

            const result = await FileParser.parseFile(
                url,
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );

            expect(result.type).toBe('document');
            expect(result.text).toContain('Word document content extracted');
            expect(result.truncated).toBeFalsy();
        });

        it('extracts spreadsheet content via xlsx', async () => {
            const url = 'https://cdn.example.com/data.xlsx';

            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from('fake xlsx data'),
            });

            const result = await FileParser.parseFile(
                url,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );

            expect(result.type).toBe('document');
            expect(result.text).toContain('Sheet1');
            expect(result.text).toContain('Alice');
            expect(result.text).toContain('New York');
            expect(result.metadata?.sheetCount).toBe(2);
            expect(result.truncated).toBeFalsy();
        });

        it('extracts web page HTML content', async () => {
            const url = 'https://example.com/blog/post';

            mockedAxios.get.mockResolvedValueOnce({
                data: '<!DOCTYPE html><html><head><title>Blog Post</title></head><body><article><h1>Blog Post</h1><p>This is the article content.</p></article></body></html>',
                headers: { 'content-type': 'text/html' },
            });

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

        it('returns error summary when text fetch fails', async () => {
            const url = 'https://cdn.example.com/missing.txt';

            mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('Failed to fetch');
        });

        it('returns error summary when PDF fetch fails', async () => {
            const url = 'https://cdn.example.com/broken.pdf';

            mockedAxios.get.mockRejectedValueOnce(new Error('PDF download failed'));

            const result = await FileParser.parseFile(url, 'application/pdf');

            expect(result.type).toBe('document');
            expect(result.text).toContain('Failed to extract PDF');
        });

        it('returns error summary when web page fetch fails', async () => {
            const url = 'https://example.com/broken';

            mockedAxios.get.mockRejectedValueOnce(new Error('Connection refused'));

            const result = await FileParser.parseFile(url, 'text/html');

            expect(result.type).toBe('webpage');
            expect(result.text).toContain('Failed to fetch web page');
        });

        it('handles .doc files as Word documents', async () => {
            const url = 'https://cdn.example.com/old.doc';

            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from('fake doc data'),
            });

            const result = await FileParser.parseFile(url, 'application/msword');

            expect(result.type).toBe('document');
            expect(result.text).toContain('Word document');
        });

        it('handles .xls files as spreadsheets', async () => {
            const url = 'https://cdn.example.com/data.xls';

            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from('fake xls data'),
            });

            const result = await FileParser.parseFile(url, 'application/vnd.ms-excel');

            expect(result.type).toBe('document');
            expect(result.text).toContain('Sheet1');
        });

        it('rejects private IP hostname for SSRF safety', async () => {
            const url = 'http://192.168.1.1/config.txt';

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('private');
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('rejects localhost URL for SSRF safety', async () => {
            const url = 'http://localhost:8080/secrets';

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('private');
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('rejects metadata service URL for SSRF safety', async () => {
            const url = 'http://169.254.169.254/latest/meta-data/';

            const result = await FileParser.parseFile(url, 'text/plain');

            expect(result.type).toBe('text');
            expect(result.text).toContain('private');
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('rejects private URL for PDF fetch', async () => {
            const url = 'http://10.0.0.1/document.pdf';

            const result = await FileParser.parseFile(url, 'application/pdf');

            expect(result.type).toBe('document');
            expect(result.text).toContain('private');
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('rejects private URL for web page fetch', async () => {
            const url = 'http://192.168.1.100';

            const result = await FileParser.parseFile(url, 'text/html');

            expect(result.type).toBe('webpage');
            expect(result.text).toContain('private');
            expect(mockedAxios.get).not.toHaveBeenCalled();
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
