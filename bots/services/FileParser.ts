/**
 * FileParser — fetches URLs and extracts content by mimeType.
 *
 * Extracted text is injected into AI context so the bot can reason
 * about uploaded files. Works with every model type — no vision or
 * STT dependency.
 *
 * SSRF prevention: validates all URLs before fetching (scheme check,
 * hostname pattern check, DNS resolution check, redirect following
 * with per-hop revalidation).
 *
 * Currently handles:
 *  - text/* files: fetch and return inline content (10K char cap)
 *  - application/pdf: extract text via pdf-parse
 *  - Word documents (.docx/.doc): extract text via mammoth
 *  - Spreadsheets (.xlsx/.xls): parse cells via xlsx
 *  - text/html: extract clean markdown via Readability + Turndown
 *  - image/*: note URL, no content extraction
 *  - audio/*: note type only
 *  - video/*: note type only
 *  - unknown: note filename and type
 */
import { resolve4, resolve6 } from 'dns/promises';
import { extractWebContent } from './WebPageExtractor';

const MAX_FILE_CHARS = 10_000;
const FILE_PARSER_TIMEOUT_MS = 10_000;

export interface ParsedFile {
    type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'webpage' | 'unknown';
    text?: string;
    url?: string;
    summary: string;
    mimeType: string;
    truncated?: boolean;
    metadata?: {
        title?: string | null;
        excerpt?: string | null;
        byline?: string | null;
        pageCount?: number;
        rowCount?: number;
        sheetCount?: number;
    };
}

export class FileParser {
    // Short-lived URL-keyed memo for sniffContentType: coalesces in-flight
    // requests and caches results briefly (see sniffContentType).
    private static sniffCache = new Map<
        string,
        { promise: Promise<string | null>; expiresAt: number }
    >();
    private static readonly SNIFF_CACHE_TTL_MS = 30_000;

    static readonly MAX_FILE_CHARS = MAX_FILE_CHARS;

    /**
     * Parse a file from a URL by its mime type.
     */
    static async parseFile(url: string, mimeType: string): Promise<ParsedFile> {
        const base = { url, mimeType };
        const mt = mimeType.toLowerCase();

        // Image files — no fetch, just note the URL
        if (mt.startsWith('image/')) {
            return {
                ...base,
                type: 'image',
                summary: `Image at ${url}`,
            };
        }

        // Audio files — note type only (STT not implemented)
        if (mt.startsWith('audio/')) {
            return {
                ...base,
                type: 'audio',
                summary: 'Audio file — content not extracted',
            };
        }

        // Video files — note type only
        if (mt.startsWith('video/')) {
            return {
                ...base,
                type: 'video',
                summary: 'Video file — content not extracted',
            };
        }

        // PDF documents
        if (mt === 'application/pdf') {
            return FileParser.parsePdf(url, base);
        }

        // Word documents (.docx and .doc)
        if (
            mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mt === 'application/msword'
        ) {
            return FileParser.parseWordDocument(url, base);
        }

        // Spreadsheets (.xlsx and .xls)
        if (
            mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            mt === 'application/vnd.ms-excel'
        ) {
            return FileParser.parseSpreadsheet(url, base);
        }

        // Web pages (HTML) — extract with Readability + Turndown
        if (mt === 'text/html' || mt === 'application/xhtml+xml') {
            return FileParser.parseWebPage(url, base);
        }

        // Text-like files — fetch and return inline content
        if (
            mt.startsWith('text/') ||
            mt === 'application/json' ||
            mt === 'application/xml' ||
            mt === 'application/javascript' ||
            mt.endsWith('+xml') ||
            mt.endsWith('+json')
        ) {
            return FileParser.fetchTextFile(url, mimeType, base);
        }

        // Everything else — not supported
        return {
            ...base,
            type: 'unknown',
            summary: `File type ${mimeType} — content not extracted`,
        };
    }

    /**
     * Parse a PDF document and extract its text content.
     */
    private static async parsePdf(
        url: string,
        base: { url: string; mimeType: string }
    ): Promise<ParsedFile> {
        try {
            await FileParser.validateUrl(url);

            const buffer = await FileParser.fetchBuffer(url);

            // Dynamic import — pdf-parse v2 uses class-based API (PDFParse)
            const { PDFParse } = await import('pdf-parse');
            const parser = new PDFParse({ data: new Uint8Array(buffer) });
            let pageCount = 0;

            try {
                // Get page count from info
                const info = await parser.getInfo();
                pageCount = info.total || 0;

                // Extract text content
                const textResult = await parser.getText();
                const text = textResult.text?.trim() || '';

                if (!text) {
                    return {
                        ...base,
                        type: 'document',
                        text: '[PDF document — no extractable text content]',
                        summary: `PDF (${pageCount} pages, no extractable text)`,
                        metadata: { pageCount },
                    };
                }

                const truncated = text.length > MAX_FILE_CHARS;
                return {
                    ...base,
                    type: 'document',
                    text: truncated ? text.slice(0, MAX_FILE_CHARS) : text,
                    summary: `PDF document (${pageCount} pages, ${text.length} chars${truncated ? ', truncated' : ''})`,
                    truncated,
                    metadata: { pageCount },
                };
            } finally {
                await parser.destroy();
            }
        } catch (error: any) {
            return {
                ...base,
                type: 'document',
                text: `[Failed to extract PDF content: ${error.message || 'Unknown error'}]`,
                summary: 'Failed to parse PDF',
                metadata: { pageCount: undefined },
            };
        }
    }

    /**
     * Parse a Word document (.docx/.doc) and extract its text content.
     */
    private static async parseWordDocument(
        url: string,
        base: { url: string; mimeType: string }
    ): Promise<ParsedFile> {
        try {
            await FileParser.validateUrl(url);

            const buffer = await FileParser.fetchBuffer(url);

            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({
                buffer: Buffer.from(buffer),
            });

            const text = result.value.trim();
            if (!text) {
                return {
                    ...base,
                    type: 'document',
                    text: '[Word document — no extractable text content]',
                    summary: 'Word document (no extractable text)',
                };
            }

            const truncated = text.length > MAX_FILE_CHARS;
            return {
                ...base,
                type: 'document',
                text: truncated ? text.slice(0, MAX_FILE_CHARS) : text,
                summary: `Word document (${text.length} chars${truncated ? ', truncated' : ''})`,
                truncated,
            };
        } catch (error: any) {
            return {
                ...base,
                type: 'document',
                text: `[Failed to extract Word document content: ${error.message || 'Unknown error'}]`,
                summary: 'Failed to parse Word document',
            };
        }
    }

    /**
     * Parse a spreadsheet (.xlsx/.xls) and convert rows to readable text.
     */
    private static async parseSpreadsheet(
        url: string,
        base: { url: string; mimeType: string }
    ): Promise<ParsedFile> {
        try {
            await FileParser.validateUrl(url);

            const buffer = await FileParser.fetchBuffer(url);

            const XLSX = await import('xlsx');
            // Use type: 'array' for Uint8Array/ArrayBuffer inputs per SheetJS docs.
            // type: 'buffer' (Node.js Buffer) works accidentally but is incorrect.
            const workbook = XLSX.read(new Uint8Array(buffer), {
                type: 'array',
                cellDates: true,
            });

            const sheetCount = workbook.SheetNames.length;
            const parts: string[] = [];

            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(sheet, {
                    defval: '',
                    header: 1,
                }) as any[][];

                if (json.length === 0) continue;

                parts.push(`=== Sheet: ${sheetName} ===`);
                parts.push('');

                for (const row of json.slice(0, 200)) {
                    const cells = row
                        .map((c: any) => (c != null ? String(c).trim() : ''))
                        .join(' | ');
                    if (cells) parts.push(cells);
                }

                if (json.length > 200) {
                    parts.push(`[... ${json.length - 200} more rows truncated]`);
                }
                parts.push('');
            }

            let text = parts.join('\n').trim();
            if (!text) {
                return {
                    ...base,
                    type: 'document',
                    text: '[Spreadsheet — no extractable data]',
                    summary: `Spreadsheet (${sheetCount} sheets, no data)`,
                    metadata: { sheetCount, rowCount: 0 },
                };
            }

            const totalRows = workbook.SheetNames.reduce((sum, name) => {
                const sheet = workbook.Sheets[name];
                const ref = sheet['!ref'];
                if (!ref) return sum;
                const range = XLSX.utils.decode_range(ref);
                return sum + range.e.r - range.s.r + 1;
            }, 0);

            const truncated = text.length > MAX_FILE_CHARS;
            return {
                ...base,
                type: 'document',
                text: truncated ? text.slice(0, MAX_FILE_CHARS) : text,
                summary: `Spreadsheet (${sheetCount} sheets, ~${totalRows} rows, ${text.length} chars${truncated ? ', truncated' : ''})`,
                truncated,
                metadata: { sheetCount, rowCount: totalRows },
            };
        } catch (error: any) {
            return {
                ...base,
                type: 'document',
                text: `[Failed to extract spreadsheet content: ${error.message || 'Unknown error'}]`,
                summary: 'Failed to parse spreadsheet',
                metadata: { sheetCount: undefined, rowCount: undefined },
            };
        }
    }

    /**
     * Parse a web page HTML, extracting clean markdown via Readability + Turndown.
     */
    private static async parseWebPage(
        url: string,
        base: { url: string; mimeType: string }
    ): Promise<ParsedFile> {
        try {
            await FileParser.validateUrl(url);

            const buffer = await FileParser.fetchBuffer(url);
            const html = new TextDecoder().decode(buffer);
            if (!html || html.length < 50) {
                return {
                    ...base,
                    type: 'webpage',
                    text: '[Web page — empty or minimal content]',
                    summary: 'Web page returned no meaningful content',
                };
            }

            const extracted = extractWebContent(html, url);
            if (!extracted.content || extracted.content.trim().length < 20) {
                return {
                    ...base,
                    type: 'webpage',
                    text: `[Web page at ${url} — no extractable article content]`,
                    summary: 'Web page without extractable content',
                    metadata: {
                        title: extracted.title,
                    },
                };
            }

            const headerParts: string[] = [];
            if (extracted.title) headerParts.push(`# ${extracted.title}`);
            if (extracted.byline) headerParts.push(`*By ${extracted.byline}*`);
            if (extracted.excerpt && !extracted.content.startsWith(extracted.excerpt)) {
                headerParts.push(`> ${extracted.excerpt}`);
            }
            if (headerParts.length > 0) headerParts.push('');

            const fullContent = headerParts.join('\n') + extracted.content;
            const truncated = fullContent.length > MAX_FILE_CHARS;

            return {
                ...base,
                type: 'webpage',
                text: truncated ? fullContent.slice(0, MAX_FILE_CHARS) : fullContent,
                summary: `Web page: ${extracted.title || 'Untitled'} (${fullContent.length} chars${truncated ? ', truncated' : ''})`,
                truncated,
                metadata: {
                    title: extracted.title,
                    excerpt: extracted.excerpt,
                    byline: extracted.byline,
                },
            };
        } catch (error: any) {
            return {
                ...base,
                type: 'webpage',
                text: `[Failed to fetch web page content: ${error.message || 'Unknown error'}]`,
                summary: 'Failed to fetch web page',
                metadata: { title: null, excerpt: null, byline: null },
            };
        }
    }

    /**
     * Fetch a file buffer from a URL with SSRF-safe redirect validation.
     * Uses redirect: 'manual' and validates each hop to prevent redirect
     * chains from pivoting to internal or private addresses.
     */
    private static async fetchBuffer(url: string): Promise<ArrayBuffer> {
        const MAX_REDIRECTS = 5;
        const MAX_BYTES = 25 * 1024 * 1024; // 25MB cap (same as BotClient)
        let currentUrl = url;
        for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
            await FileParser.validateUrl(currentUrl);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FILE_PARSER_TIMEOUT_MS);
            try {
                const response = await fetch(currentUrl, {
                    redirect: 'manual',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; BAWESBot/1.0; +https://bawes.net)',
                    },
                });
                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get('location');
                    if (!location) {
                        throw new Error(`Redirect ${response.status} with no Location header`);
                    }
                    currentUrl = new URL(location, currentUrl).href;
                    continue; // validate next hop
                }
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} fetching ${currentUrl}`);
                }
                // Stream body with size cap — prevents OOM on large files
                const reader = response.body?.getReader();
                if (!reader) throw new Error('No response body');
                const chunks: Uint8Array[] = [];
                let total = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    total += value.byteLength;
                    if (total > MAX_BYTES) {
                        await reader.cancel();
                        throw new Error(`File too large (over ${MAX_BYTES / 1024 / 1024}MB)`);
                    }
                    chunks.push(value);
                }
                // Combine chunks into a single ArrayBuffer
                const combined = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) {
                    combined.set(chunk, offset);
                    offset += chunk.byteLength;
                }
                return combined.buffer as ArrayBuffer;
            } finally {
                clearTimeout(timer);
            }
        }
        throw new Error(`Too many redirects (${MAX_REDIRECTS}) fetching ${url}`);
    }

    /**
     * SSRF guard: validate a URL before fetching.
     */
    private static async validateUrl(url: string): Promise<void> {
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            throw new Error(`Invalid URL: ${url}`);
        }

        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(`Unsupported URL scheme: ${parsedUrl.protocol}`);
        }

        const hostname = parsedUrl.hostname;

        if (FileParser.isPrivateHost(hostname)) {
            throw new Error(`URL hostname '${hostname}' is a private or reserved address`);
        }

        const hostnameSafe = await FileParser.resolveIsExternal(hostname);
        if (!hostnameSafe) {
            throw new Error(`URL hostname '${hostname}' resolves to a private/internal IP address`);
        }
    }

    private static isPrivateHost(hostname: string): boolean {
        const raw = hostname.replace(/^\[|\]$/g, '');

        if (raw === 'localhost' || raw === '::1' || /^127\.\d+\.\d+\.\d+$/.test(raw)) return true;
        if (/^10\./.test(raw)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(raw)) return true;
        if (/^192\.168\./.test(raw)) return true;
        if (/^169\.254\./.test(raw)) return true;
        if (raw === '0.0.0.0') return true;
        if (raw === '::') return true;
        if (/^fc00:/i.test(raw) || /^fd00:/i.test(raw)) return true;
        if (/^fe80:/i.test(raw)) return true;
        if (raw.endsWith('.internal') || raw === 'host.docker.internal') return true;
        if (raw === 'metadata.google.internal' || raw === 'metadata.internal') return true;
        if (raw.endsWith('.local')) return true;
        return false;
    }

    private static isPrivateIp(ip: string): boolean {
        if (/^127\.\d+\.\d+\.\d+$/.test(ip)) return true;
        if (ip === '0.0.0.0' || ip === '::1' || /^::$/.test(ip)) return true;
        if (/^10\.\d+\.\d+\.\d+$/.test(ip)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(ip)) return true;
        if (/^192\.168\.\d+\.\d+$/.test(ip)) return true;
        if (/^169\.254\.\d+\.\d+$/.test(ip)) return true;
        if (ip === '169.254.169.254') return true;
        // Carrier-grade NAT (RFC 6598)
        if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(ip)) return true;
        // Multicast (224.0.0.0/4)
        if (/^22[4-9]\./.test(ip) || /^23[0-9]\./.test(ip)) return true;
        // Reserved (240.0.0.0/4) including limited broadcast
        if (/^24[0-9]\./.test(ip) || /^25[0-5]\./.test(ip)) return true;
        // Benchmarking (198.18.0.0/15, RFC 2544)
        if (/^198\.(1[8-9])\.\d+\.\d+$/.test(ip)) return true;
        // IPv6 unique-local and link-local
        if (/^f[cd][0-9a-f]{0,3}:/i.test(ip)) return true;
        if (/^fe[89a-b][0-9a-f]:/i.test(ip)) return true;
        return false;
    }

    private static async resolveIsExternal(hostname: string): Promise<boolean> {
        // Numeric and bracketed literals — parse and pass through isPrivateIp
        if (/^[\d.]+$/.test(hostname)) {
            return !FileParser.isPrivateIp(hostname);
        }
        if (/^[0-9a-f:]+$/i.test(hostname) && hostname.includes(':')) {
            // Strip IPv4-mapped prefix (::ffff:x.x.x.x) for isPrivateIp check
            const stripped = hostname.replace(/^::ffff:/i, '');
            if (/^\d+\.\d+\.\d+\.\d+$/.test(stripped)) {
                return !FileParser.isPrivateIp(stripped);
            }
            return !FileParser.isPrivateIp(hostname);
        }
        if (hostname.startsWith('[')) {
            const inner = hostname.slice(1, -1);
            return !FileParser.isPrivateIp(inner);
        }
        let safe = true;
        let resolved = false;
        try {
            const v4 = await resolve4(hostname);
            resolved = true;
            if (v4.some(ip => FileParser.isPrivateIp(ip))) safe = false;
        } catch { /* no A record */ }
        try {
            const v6 = await resolve6(hostname);
            resolved = true;
            if (v6.some(ip => FileParser.isPrivateIp(ip))) safe = false;
        } catch { /* no AAAA record */ }
        // Fail-closed: if neither A nor AAAA resolved, we can't verify safety
        return resolved ? safe : false;
    }

    /**
     * Sniff a URL's Content-Type via HEAD (5s cap), behind the SSRF guard.
     *
     * Extension inference happens at the call site; this is the extension
     * fallback for URLs without a recognizable extension (Unsplash, signed
     * S3/CDN URLs, `photo?id=123`). Returns null when undetermined (validation
     * failure, network error, missing header) so callers can fall back.
     *
     * Results are memoized briefly per URL: the same extension-less URL is
     * sniffed twice per message cycle (collectImageUrls for vision,
     * formatParsedAttachment for text classification). In-flight requests are
     * coalesced; cached results expire after SNIFF_CACHE_TTL_MS.
     */
    static sniffContentType(url: string): Promise<string | null> {
        const cached = FileParser.sniffCache.get(url);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.promise;
        }
        const promise = FileParser.doSniffContentType(url);
        FileParser.sniffCache.set(url, {
            promise,
            expiresAt: Date.now() + FileParser.SNIFF_CACHE_TTL_MS,
        });
        promise
            .finally(() => {
                const entry = FileParser.sniffCache.get(url);
                if (entry && entry.expiresAt <= Date.now()) {
                    FileParser.sniffCache.delete(url);
                }
            })
            .catch(() => { /* handled by doSniffContentType */ });
        return promise;
    }

    private static async doSniffContentType(url: string): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
                // DNS resolution inside validateUrl does not observe the abort
                // signal, so race it against the same 5s deadline — slow lookups
                // must not extend the documented cap.
                const abortRace = new Promise<never>((_, reject) => {
                    controller.signal.addEventListener(
                        'abort',
                        () => reject(new Error('sniff aborted')),
                        { once: true }
                    );
                });
                // SSRF guard: same hop-validated redirect handling as fetchBuffer —
                // validate the initial URL AND every redirect target, so a
                // public attacker URL cannot 302 the request into an internal
                // or private endpoint (localhost, 169.254.169.254, 10.x, ...).
                const MAX_REDIRECTS = 5;
                let currentUrl = url;
                for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
                    await Promise.race([FileParser.validateUrl(currentUrl), abortRace]);
                    const response = await fetch(currentUrl, {
                        method: 'HEAD',
                        redirect: 'manual',
                        signal: controller.signal,
                    });
                    if (response.status >= 300 && response.status < 400) {
                        const location = response.headers.get('location');
                        if (!location) {
                            return null;
                        }
                        currentUrl = new URL(location, currentUrl).href;
                        continue; // validate next hop
                    }
                    const contentType = response.headers.get('content-type');
                    return contentType ? contentType.split(';')[0].trim() : null;
                }
                return null; // redirect chain exceeded MAX_REDIRECTS
            } finally {
                clearTimeout(timeoutId);
            }
        } catch {
            // Fail soft: caller falls back to its existing mime/octet-stream default
            return null;
        }
    }

    /**
     * Fetch a text file from a URL and return its content.
     */
    private static async fetchTextFile(
        url: string,
        mimeType: string,
        base: { url: string; mimeType: string }
    ): Promise<ParsedFile> {
        try {
            await FileParser.validateUrl(url);

            const buffer = await FileParser.fetchBuffer(url);
            const text = new TextDecoder().decode(buffer);
            if (text.length > MAX_FILE_CHARS) {
                return {
                    ...base,
                    type: 'text',
                    text: text.slice(0, MAX_FILE_CHARS),
                    summary: `Text file (${text.length} chars, truncated to ${MAX_FILE_CHARS})`,
                    truncated: true,
                };
            }
            return {
                ...base,
                type: 'text',
                text,
                summary: `Text file (${text.length} chars)`,
            };
        } catch (error: any) {
            return {
                ...base,
                type: 'text',
                text: `[Failed to fetch file content: ${error.message || 'Unknown error'}]`,
                summary: 'Failed to fetch file',
            };
        }
    }

    /**
     * Extract file extension from a URL.
     */
    static getExtension(url: string): string {
        try {
            const pathname = new URL(url).pathname;
            const dotIndex = pathname.lastIndexOf('.');
            if (dotIndex === -1) return '';
            return pathname.slice(dotIndex + 1).toLowerCase();
        } catch {
            const queryStripped = url.split('?')[0];
            const dotIndex = queryStripped.lastIndexOf('.');
            if (dotIndex === -1) return '';
            return queryStripped.slice(dotIndex + 1).toLowerCase();
        }
    }
}
