/**
 * Tests for FileParser — fetches URLs and extracts content by mimeType.
 *
 * Covers:
 *  - Text files: fetch and return inline content
 *  - Images: note URL, no extraction
 *  - PDF documents: extract text via pdf-parse
 *  - Word documents: extract text via mammoth
 *  - Spreadsheets: parse cells via xlsx
 *  - Presentations: slide text via yauzl + linkedom, with zip-bomb bounds
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

import { deflateRawSync } from 'zlib';
import { FileParser } from '../services/FileParser';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PPT_MIME = 'application/vnd.ms-powerpoint';

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a deflate zip in memory. `declaredSize` overrides an entry's
 * uncompressed size in its headers, to simulate a lying zip bomb.
 */
function makeZip(entries: Array<{ name: string; data: string | Buffer; declaredSize?: number }>): Uint8Array {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
        const compressed = deflateRawSync(raw);
        const name = Buffer.from(entry.name, 'utf8');
        const size = entry.declaredSize ?? raw.length;
        const crc = crc32(raw);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(name.length, 26);
        locals.push(local, name, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);

        offset += local.length + name.length + compressed.length;
    }
    const centralDir = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...locals, centralDir, end]));
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function slideXml(shapes: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
}

function textShape(paragraphs: Array<string | [string, number]>, placeholder?: string): string {
    const ph = placeholder ? `<p:nvSpPr><p:nvPr><p:ph type="${placeholder}"/></p:nvPr></p:nvSpPr>` : '';
    const body = paragraphs
        .map((p) => {
            const [text, level] = typeof p === 'string' ? [p, 0] : p;
            return `<a:p>${level ? `<a:pPr lvl="${level}"/>` : ''}<a:r><a:t>${text}</a:t></a:r></a:p>`;
        })
        .join('');
    return `<p:sp>${ph}<p:txBody>${body}</p:txBody></p:sp>`;
}

/** A deck whose presentation.xml lists slides in the given (rId) order. */
function makeDeck(slides: string[], extra: Array<{ name: string; data: string }> = []): Uint8Array {
    const ids = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
    const rels = slides
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="slide" Target="slides/slide${i + 1}.xml"/>`)
        .join('');
    return makeZip([
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'ppt/presentation.xml', data: `<p:presentation ${NS}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>` },
        { name: 'ppt/_rels/presentation.xml.rels', data: `<Relationships>${rels}</Relationships>` },
        ...slides.map((xml, i) => ({ name: `ppt/slides/slide${i + 1}.xml`, data: xml })),
        ...extra,
    ]);
}

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

    describe('PowerPoint presentations', () => {
        const url = 'https://cdn.example.com/deck.pptx';

        it('extracts titles, nested bullets, tables and speaker notes in slide order', async () => {
            const table =
                '<p:graphicFrame><a:graphic><a:graphicData><a:tbl>' +
                '<a:tr><a:tc><a:txBody><a:p><a:r><a:t>DAU</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>1200</a:t></a:r></a:p></a:txBody></a:tc></a:tr>' +
                '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
            mockFetchOnce(
                makeDeck(
                    [
                        slideXml(
                            textShape(['Quarterly Plan'], 'title') +
                                textShape(['Grow users &amp; revenue', ['Ship quests', 1]]) +
                                textShape(['7'], 'sldNum')
                        ),
                        slideXml(textShape(['Metrics'], 'title') + `<p:grpSp>${table}</p:grpSp>`),
                    ],
                    [
                        {
                            name: 'ppt/slides/_rels/slide1.xml.rels',
                            data: '<Relationships><Relationship Id="rId2" Type="notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
                        },
                        {
                            name: 'ppt/notesSlides/notesSlide1.xml',
                            data: `<p:notes ${NS}><p:cSld><p:spTree>${textShape(['1'], 'sldImg')}${textShape(['Mention the budget'], 'body')}</p:spTree></p:cSld></p:notes>`,
                        },
                    ]
                )
            );

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.type).toBe('document');
            expect(result.text).toBe(
                'Slide 1: Quarterly Plan\n- Grow users & revenue\n  - Ship quests\nNotes: Mention the budget\n\n' +
                    'Slide 2: Metrics\n| DAU | 1200 |'
            );
            expect(result.summary).toMatch(/^PowerPoint presentation \(2 slides, \d+ chars\)$/);
            expect(result.truncated).toBe(false);
            expect(result.metadata?.slideCount).toBe(2);
        });

        it('truncates long decks at MAX_FILE_CHARS and says so in the summary', async () => {
            const body = 'x'.repeat(400);
            mockFetchOnce(makeDeck(Array.from({ length: 60 }, (_, i) => slideXml(textShape([`Title ${i}`], 'title') + textShape([body])))));

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.type).toBe('document');
            expect(result.truncated).toBe(true);
            expect(result.text!.length).toBeLessThanOrEqual(FileParser.MAX_FILE_CHARS);
            expect(result.summary).toContain('60 slides');
            expect(result.summary).toContain('truncated');
        });

        it('rejects a file over the download cap before extraction', async () => {
            const chunk = new Uint8Array(1024 * 1024);
            let reads = 0;
            const reader = {
                read: async () => (reads++ < 30 ? { done: false, value: chunk } : { done: true, value: undefined }),
                cancel: vi.fn(async () => {}),
            };
            (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                ok: true,
                status: 200,
                body: { getReader: () => reader },
                headers: new Map(),
            });

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.type).toBe('document');
            expect(result.text).toContain("Couldn't read this PowerPoint file");
            expect(result.text).toContain('too large');
            expect(reader.cancel).toHaveBeenCalled();
        });

        it('refuses a slide that declares a huge uncompressed size (zip bomb)', async () => {
            mockFetchOnce(
                makeZip([{ name: 'ppt/slides/slide1.xml', data: 'tiny', declaredSize: 200 * 1024 * 1024 }])
            );

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.text).toContain('too large');
        });

        it('stops a slide that inflates past its declared size (lying zip bomb)', async () => {
            const huge = Buffer.alloc(8 * 1024 * 1024, 0x41);
            mockFetchOnce(makeZip([{ name: 'ppt/slides/slide1.xml', data: huge, declaredSize: 1000 }]));

            const started = Date.now();
            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.type).toBe('document');
            expect(result.text).toContain("Couldn't read this PowerPoint file");
            expect(Date.now() - started).toBeLessThan(2000);
        });

        it('returns a graceful error for a corrupt deck', async () => {
            mockFetchOnce(makeDeck([slideXml(textShape(['Hello']))]).slice(0, 200));

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.type).toBe('document');
            expect(result.summary).toBe('Failed to parse PowerPoint presentation');
            expect(result.text).toContain("Couldn't read this PowerPoint file");
        });

        it('returns a graceful error for an empty file', async () => {
            mockFetchOnce(new Uint8Array(0));

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.text).toContain('empty');
        });

        it('reports a deck with no slides as unreadable', async () => {
            mockFetchOnce(makeZip([{ name: '[Content_Types].xml', data: '<Types/>' }]));

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.text).toContain('no slides');
        });

        it('reports a deck with only picture slides as having no text', async () => {
            mockFetchOnce(makeDeck([slideXml('<p:pic/>')]));

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.text).toContain('no extractable text');
            expect(result.metadata?.slideCount).toBe(1);
        });

        it('explains that a password-protected .pptx cannot be read', async () => {
            mockFetchOnce(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));

            const result = await FileParser.parseFile(url, PPTX_MIME);

            expect(result.summary).toBe('Password-protected PowerPoint — not readable');
            expect(result.text).toContain('password-protected');
        });

        it('declines legacy binary .ppt with a clear message', async () => {
            mockFetchOnce(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));

            const result = await FileParser.parseFile('https://cdn.example.com/old.ppt', PPT_MIME);

            expect(result.type).toBe('document');
            expect(result.summary).toBe('Legacy PowerPoint (.ppt) — not supported');
            expect(result.text).toContain('.pptx or PDF');
        });

        it('reads a .pptx that was labelled as .ppt', async () => {
            mockFetchOnce(makeDeck([slideXml(textShape(['Renamed deck'], 'title'))]));

            const result = await FileParser.parseFile('https://cdn.example.com/renamed.ppt', PPT_MIME);

            expect(result.text).toBe('Slide 1: Renamed deck');
        });

        it('rejects private URLs before fetching', async () => {
            const result = await FileParser.parseFile('http://10.0.0.1/deck.pptx', PPTX_MIME);

            expect(result.type).toBe('document');
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

    describe('validateUrl — SSRF guard', () => {
        it('rejects IPv4-mapped IPv6 loopback in canonical hex form (::ffff:7f00:1)', async () => {
            // RFC 4291 §2.2.3: ::ffff:7f00:1 is 127.0.0.1 in mapped form —
            // must be rejected like the plain loopback it embeds.
            await expect(FileParser.validateUrl('http://[::ffff:7f00:1]/x')).rejects.toThrow(/private/i);
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('rejects IPv4-mapped IPv6 in dotted form (::ffff:127.0.0.1)', async () => {
            await expect(FileParser.validateUrl('http://[::ffff:127.0.0.1]/x')).rejects.toThrow(/private/i);
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('rejects IPv4-mapped IPv6 of a private 10.x address (::ffff:a00:1)', async () => {
            await expect(FileParser.validateUrl('http://[::ffff:a00:1]/x')).rejects.toThrow(/private/i);
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('rejects IPv4-mapped IPv6 of the metadata address (::ffff:a9fe:a9fe)', async () => {
            await expect(FileParser.validateUrl('http://[::ffff:a9fe:a9fe]/latest/meta-data/')).rejects.toThrow(/private/i);
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('allows a public IPv6 address', async () => {
            // Must not throw — public IPv6 literals are safe destinations.
            await expect(FileParser.validateUrl('http://[2606:4700:4700::1111]/')).resolves.toBeUndefined();
        });
    });
});
