import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";
import * as cheerio from "cheerio";

/** What a chat message shows under a link: the page's own preview tags. */
export interface LinkPreview {
    url: string;
    siteName: string;
    title?: string;
    description?: string;
    image?: string;
}

const FETCH_TIMEOUT_MS = 5000;
// All hops of one preview, redirects included.
const PREVIEW_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;
// Preview tags live in <head>: there's no need to read a whole page.
const MAX_HTML_BYTES = 512 * 1024;
const MAX_URL_LENGTH = 2048;
const CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const USER_AGENT = "Mozilla/5.0 (compatible; UniverseLinkPreview/1.0; +https://bawes.net)";

/**
 * Addresses the server must never be made to call (SSRF): loopback, private networks, link-local (cloud metadata),
 * carrier-grade NAT, multicast and reserved ranges.
 */
const blockedAddresses = new net.BlockList();
for (const [prefix, length] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const) {
    blockedAddresses.addSubnet(prefix, length, "ipv4");
}
for (const [prefix, length] of [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["100::", 64],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
] as const) {
    blockedAddresses.addSubnet(prefix, length, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
    const family = net.isIP(address);
    if (family === 4) {
        return blockedAddresses.check(address, "ipv4");
    }
    if (family === 6) {
        // IPv4-mapped (::ffff:a.b.c.d, or its hex form ::ffff:7f00:1) is checked as the IPv4 address it carries.
        const mapped = address.match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i);
        if (mapped) {
            const ipv4 = mapped[1] ?? hexToIpv4(mapped[2], mapped[3]);
            return blockedAddresses.check(ipv4, "ipv4");
        }
        return blockedAddresses.check(address, "ipv6");
    }
    return true;
}

function hexToIpv4(high: string, low: string): string {
    const hi = parseInt(high, 16);
    const lo = parseInt(low, 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Resolves like the default lookup, but fails when any address is blocked. The connection uses the address checked
 * here, so a hostname can't pass the check and then resolve to an internal address (DNS rebinding).
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) {
            callback(error, "", 4);
            return;
        }
        const list = Array.isArray(addresses) ? addresses : [];
        if (list.length === 0) {
            callback(new Error(`${hostname} has no address`), "", 4);
            return;
        }
        if (list.some((entry) => isBlockedAddress(entry.address))) {
            callback(new Error(`${hostname} resolves to a private or reserved address`), "", 4);
            return;
        }
        if (options.all) {
            (callback as unknown as (err: null, addresses: dns.LookupAddress[]) => void)(null, list);
            return;
        }
        callback(null, list[0].address, list[0].family);
    });
};

/** A URL the server may fetch: http(s) on the default port, no credentials, a host that isn't an internal name. */
export function parsePreviewableUrl(raw: string): URL | undefined {
    if (raw.length > MAX_URL_LENGTH) return undefined;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return undefined;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (url.port !== "") return undefined;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (net.isIP(host)) {
        if (isBlockedAddress(host)) return undefined;
    } else if (
        !host.includes(".") ||
        host === "localhost" ||
        /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)
    ) {
        return undefined;
    }
    url.hash = "";
    return url;
}

export type FetchResult = { kind: "redirect"; location: string } | { kind: "page"; html?: string };

/**
 * One request, no redirect following. `timeoutMs` bounds the whole request, not just idle time: a server dripping
 * one byte at a time can't hold the connection open.
 */
export function fetchOnce(
    url: URL,
    { lookup = safeLookup, timeoutMs = FETCH_TIMEOUT_MS }: { lookup?: LookupFunction; timeoutMs?: number } = {}
): Promise<FetchResult> {
    // The request and response live only for this call: their listeners go with them.
    /* eslint-disable listeners/no-missing-remove-event-listener, listeners/no-inline-function-event-listener */
    return new Promise<FetchResult>((resolvePromise, rejectPromise) => {
        // Whatever the outcome, the connection is closed with it: nothing keeps reading after the answer.
        const resolve = (result: FetchResult) => {
            clearTimeout(deadline);
            resolvePromise(result);
            request.destroy();
        };
        const reject = (error: Error) => {
            clearTimeout(deadline);
            rejectPromise(error);
            request.destroy();
        };
        const client = url.protocol === "https:" ? https : http;
        const request = client.get(
            url,
            {
                lookup,
                timeout: timeoutMs,
                headers: {
                    "User-Agent": USER_AGENT,
                    Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
                    "Accept-Language": "en",
                },
            },
            (response) => {
                const status = response.statusCode ?? 0;
                if (status >= 300 && status < 400 && response.headers.location) {
                    resolve({ kind: "redirect", location: response.headers.location });
                    return;
                }
                if (status < 200 || status >= 300) {
                    reject(new Error(`HTTP ${status}`));
                    return;
                }
                const contentType = String(response.headers["content-type"] ?? "");
                if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
                    // A file (image, PDF…): nothing to read, the link speaks for itself.
                    resolve({ kind: "page" });
                    return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    resolve({ kind: "page", html: Buffer.concat(chunks).toString("utf8") });
                };
                response.on("data", (chunk: Buffer) => {
                    chunks.push(chunk);
                    size += chunk.length;
                    if (size >= MAX_HTML_BYTES) finish();
                });
                response.on("end", finish);
                response.on("close", finish);
                response.on("error", (error) => {
                    if (!done) reject(error);
                });
            }
        );
        // Idle sockets and the whole request are both capped.
        const deadline = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
        request.on("timeout", () => reject(new Error("Timed out")));
        request.on("error", reject);
    });
    /* eslint-enable listeners/no-missing-remove-event-listener, listeners/no-inline-function-event-listener */
}

function absoluteHttpUrl(value: string | undefined, base: URL): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value.trim(), base);
        return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

function clean(value: string | undefined, maxLength: number): string | undefined {
    const text = value?.replace(/\s+/g, " ").trim();
    if (!text) return undefined;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function siteNameOf(url: URL): string {
    return url.hostname.replace(/^www\./, "");
}

/** Reads a page's preview tags (Open Graph, Twitter, then plain title and description). */
export function parsePreviewTags(html: string, pageUrl: URL): Omit<LinkPreview, "url"> {
    const $ = cheerio.load(html);
    const meta = (...keys: string[]): string | undefined => {
        for (const key of keys) {
            const value = $(`meta[property="${key}"], meta[name="${key}"]`).first().attr("content");
            if (value && value.trim()) return value;
        }
        return undefined;
    };
    return {
        siteName: clean(meta("og:site_name", "application-name"), 80) ?? siteNameOf(pageUrl),
        title: clean(meta("og:title", "twitter:title") ?? $("title").first().text(), 200),
        description: clean(meta("og:description", "twitter:description", "description"), 300),
        image: absoluteHttpUrl(
            meta("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"),
            pageUrl
        ),
    };
}

async function loadPreview(url: URL): Promise<LinkPreview> {
    let current = url;
    const giveUpAt = Date.now() + PREVIEW_TIMEOUT_MS;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const timeoutMs = Math.min(FETCH_TIMEOUT_MS, giveUpAt - Date.now());
        if (timeoutMs <= 0) throw new Error("Timed out");
        // Each hop depends on the previous one's answer.
        // eslint-disable-next-line no-await-in-loop
        const result = await fetchOnce(current, { timeoutMs });
        if (result.kind === "redirect") {
            const next = parsePreviewableUrl(new URL(result.location, current).toString());
            if (!next) throw new Error("Redirected to a URL that can't be previewed");
            current = next;
            continue;
        }
        if (!result.html) {
            return { url: url.toString(), siteName: siteNameOf(url) };
        }
        return { url: url.toString(), ...parsePreviewTags(result.html, current) };
    }
    throw new Error("Too many redirects");
}

type CacheEntry = { promise: Promise<LinkPreview>; expiresAt: number };

export class LinkPreviewService {
    private cache = new Map<string, CacheEntry>();

    constructor(private load: (url: URL) => Promise<LinkPreview> = loadPreview) {}

    /** Resolves the preview of a public web page; rejects for URLs that can't or mustn't be fetched. */
    getPreview(rawUrl: string): Promise<LinkPreview> {
        const url = parsePreviewableUrl(rawUrl);
        if (!url) {
            return Promise.reject(new Error("This link can't be previewed"));
        }
        const key = url.toString();
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.promise;
        }
        const promise = this.load(url);
        this.remember(key, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
        promise.catch(() => {
            // Failures are remembered for less time: the page may come back.
            if (this.cache.get(key)?.promise === promise) {
                this.cache.set(key, { promise, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
            }
        });
        return promise;
    }

    private remember(key: string, entry: CacheEntry): void {
        this.cache.delete(key);
        this.cache.set(key, entry);
        while (this.cache.size > MAX_CACHE_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
    }
}

export const linkPreviewService = new LinkPreviewService();
