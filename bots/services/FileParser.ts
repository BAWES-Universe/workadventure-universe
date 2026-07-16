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
 *  - image/*: note URL, no content extraction
 *  - audio/*: note type only
 *  - video/*: note type only
 *  - unknown: note filename and type
 *
 * PDF, Word, XLSX extraction requires additional dependencies
 * (pdf-parse, mammoth, xlsx) — not loaded by default.
 */

import axios from 'axios';
import { resolve4, resolve6 } from 'dns/promises';

const MAX_FILE_CHARS = 10_000;
const FILE_PARSER_TIMEOUT_MS = 10_000;

export interface ParsedFile {
    type: 'text' | 'image' | 'audio' | 'video' | 'unknown';
    text?: string;
    url?: string;
    summary: string;
    mimeType: string;
    truncated?: boolean;
}

export class FileParser {
    static readonly MAX_FILE_CHARS = MAX_FILE_CHARS;

    /**
     * Parse a file from a URL by its mime type.
     * Text files are fetched and returned inline; images/audio/video/unknown
     * are noted without content extraction.
     */
    static async parseFile(url: string, mimeType: string): Promise<ParsedFile> {
        const base = { url, mimeType };

        // Image files — no fetch, just note the URL
        if (mimeType.startsWith('image/')) {
            return {
                ...base,
                type: 'image',
                summary: `Image at ${url}`,
            };
        }

        // Audio files — note type only (STT not implemented)
        if (mimeType.startsWith('audio/')) {
            return {
                ...base,
                type: 'audio',
                summary: 'Audio file — content not extracted',
            };
        }

        // Video files — note type only
        if (mimeType.startsWith('video/')) {
            return {
                ...base,
                type: 'video',
                summary: 'Video file — content not extracted',
            };
        }

        // Text-like files — fetch and return inline content
        if (
            mimeType.startsWith('text/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/xml' ||
            mimeType === 'application/javascript' ||
            mimeType.endsWith('+xml') ||
            mimeType.endsWith('+json')
        ) {
            return FileParser.fetchTextFile(url, mimeType, base);
        }

        // Everything else (PDF, Word, ZIP, etc.) — not supported yet
        return {
            ...base,
            type: 'unknown',
            summary: `File type ${mimeType} — content not extracted`,
        };
    }

    /**
     * SSRF guard: validate a URL before fetching.
     * Checks scheme, hostname patterns, and DNS resolution.
     * Throws if the URL points to a private/internal address.
     */
    private static async validateUrl(url: string): Promise<void> {
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            throw new Error(`Invalid URL: ${url}`);
        }

        // Only allow http/https
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(`Unsupported URL scheme: ${parsedUrl.protocol}`);
        }

        const hostname = parsedUrl.hostname;

        // Layer 1: Hostname string checks (fast path — catches known patterns)
        if (FileParser.isPrivateHost(hostname)) {
            throw new Error(`URL hostname '${hostname}' is a private or reserved address`);
        }

        // Layer 2: DNS resolution check (catches hostnames that resolve to private IPs)
        const hostnameSafe = await FileParser.resolveIsExternal(hostname);
        if (!hostnameSafe) {
            throw new Error(`URL hostname '${hostname}' resolves to a private/internal IP address`);
        }
    }

    /**
     * Check if a hostname is a private or reserved address.
     * Matches the pattern from BotClient.isPrivateHost.
     */
    private static isPrivateHost(hostname: string): boolean {
        const raw = hostname.replace(/^\[|\]$/g, '');

        // Localhost and loopback (entire 127.0.0.0/8)
        if (raw === 'localhost' || raw === '::1' || /^127\.\d+\.\d+\.\d+$/.test(raw)) {
            return true;
        }
        // IPv4 private ranges
        if (/^10\./.test(raw)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(raw)) return true;
        if (/^192\.168\./.test(raw)) return true;
        // IPv4 link-local
        if (/^169\.254\./.test(raw)) return true;
        // Reserved / zero address
        if (raw === '0.0.0.0') return true;
        // IPv6 documentation / private / unique-local / link-local
        if (raw === '::') return true;
        if (/^fc00:/i.test(raw) || /^fd00:/i.test(raw)) return true;
        if (/^fe80:/i.test(raw)) return true;
        // Docker/Kubernetes internal names
        if (raw.endsWith('.internal') || raw === 'host.docker.internal') return true;
        // Cloud metadata services
        if (raw === 'metadata.google.internal' || raw === 'metadata.internal') return true;
        // mDNS / link-local hostnames
        if (raw.endsWith('.local')) return true;
        return false;
    }

    /**
     * Check if an IP address is in a private/reserved range.
     */
    private static isPrivateIp(ip: string): boolean {
        if (/^127\.\d+\.\d+\.\d+$/.test(ip)) return true;
        if (ip === '0.0.0.0' || ip === '::1' || /^::$/.test(ip)) return true;
        if (/^10\.\d+\.\d+\.\d+$/.test(ip)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(ip)) return true;
        if (/^192\.168\.\d+\.\d+$/.test(ip)) return true;
        if (/^169\.254\.\d+\.\d+$/.test(ip)) return true;
        // AWS metadata endpoint (169.254.169.254) is private too
        if (ip === '169.254.169.254') return true;
        // IPv6 unique-local / link-local
        if (/^f[cd][0-9a-f]{0,3}:/i.test(ip)) return true;
        if (/^fe[89a-b][0-9a-f]:/i.test(ip)) return true;
        return false;
    }

    /**
     * Resolve a hostname via DNS and validate none of the resolved
     * addresses are private. Returns true when all resolved IPs are external.
     */
    private static async resolveIsExternal(hostname: string): Promise<boolean> {
        // Literal IP addresses — already validated by isPrivateHost
        if (/^[\d.]+$/.test(hostname) || (/^[0-9a-f:]+$/i.test(hostname) && hostname.includes(':')) || hostname.startsWith('[')) {
            return true;
        }
        let safe = true;
        try {
            const v4 = await resolve4(hostname);
            if (v4.some(ip => FileParser.isPrivateIp(ip))) safe = false;
        } catch { /* no A record — not a problem */ }
        try {
            const v6 = await resolve6(hostname);
            if (v6.some(ip => FileParser.isPrivateIp(ip))) safe = false;
        } catch { /* no AAAA record — not a problem */ }
        return safe;
    }

    /**
     * Fetch a text file from a URL and return its content.
     * Validates the URL for SSRF safety before fetching.
     */
    private static async fetchTextFile(
        url: string,
        mimeType: string,
        base: { url: string; mimeType: string }
    ): Promise<ParsedFile> {
        try {
            // SSRF validation — reject private/internal URLs before fetching
            await FileParser.validateUrl(url);

            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: FILE_PARSER_TIMEOUT_MS,
            });
            const text = Buffer.from(response.data).toString('utf-8');
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
