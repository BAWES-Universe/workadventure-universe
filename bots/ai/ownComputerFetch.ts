/**
 * The only way the bot server calls an address a person typed (#374): an AI key on their own computer, or their own NIM.
 * Orbit applies the same rules when it adds the key (orbit lib/ai-key-fetch.ts); here they run before every call.
 *
 * - https only, with a name: never a bare IP, never `localhost`, no user name or password in the address.
 * - The name is looked up first. If ANY address it gives is private, loopback, link-local, carrier-grade, multicast,
 *   reserved or documentation space (home and office networks, this server, cloud metadata), the call is refused.
 * - The connection goes to the address that was checked, never to a second lookup, so the name can't switch to a
 *   private address between the check and the call.
 * - Only the chat and model-list paths. No redirect is followed. A short wait to connect, a size cap on the answer.
 *
 * It returns a standard `Response`, so it drops in where `fetch` was used.
 */

import https from 'https';
import { BlockList, isIP } from 'net';
import { lookup } from 'dns/promises';
import { Readable, Transform } from 'stream';
import type { TLSSocket } from 'tls';

const blocked = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
    blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
    ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) {
    blocked.addSubnet(network, prefix, 'ipv6');
}

/** Whether this server may connect to this address at all. IPv4-mapped IPv6 addresses are checked as their IPv4. */
export function isPublicAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 0) return false;
    return !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export type AddressProblem = 'not-https' | 'not-a-name' | 'credentials' | 'private' | 'unresolved' | 'path';

export class AddressError extends Error {
    constructor(public readonly problem: AddressProblem) {
        super(`Own address refused: ${problem}`);
    }
}

/** The paths an own-computer key may be asked for. */
const ALLOWED_PATHS = new Set(['/v1/chat/completions', '/v1/models', '/chat/completions', '/models']);
/** Largest answer read from an own-computer server (a long streamed reply is well under this). */
export const MAX_RESPONSE_BYTES = 20_000_000;
const CONNECT_TIMEOUT_MS = 10_000;

/** Everything about the address that can be checked without a lookup; throws an AddressError. */
export function parsePublicHttpsUrl(raw: string): URL {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        throw new AddressError('not-https');
    }
    if (url.protocol !== 'https:') throw new AddressError('not-https');
    if (url.username || url.password) throw new AddressError('credentials');
    const host = url.hostname.toLowerCase();
    // A name has a dot and a letter somewhere: not an IP in any spelling (1.2.3.4, [::1], 0x7f.1, 2130706433).
    if (isIP(host.replace(/^\[|\]$/g, '')) !== 0 || !host.includes('.') || !/[a-z]/.test(host) || host === 'localhost' || host.endsWith('.localhost')) {
        throw new AddressError('not-a-name');
    }
    if (!ALLOWED_PATHS.has(url.pathname.replace(/\/+$/, ''))) throw new AddressError('path');
    return url;
}

interface Checked {
    url: URL;
    /** Every address the name resolved to, all of them checked: the connection may fall back from one to the next */
    addresses: { address: string; family: 4 | 6 }[];
}

async function checkAddress(raw: string): Promise<Checked> {
    const url = parsePublicHttpsUrl(raw);
    let addresses: { address: string; family: number }[];
    try {
        addresses = await lookup(url.hostname, { all: true, verbatim: true });
    } catch {
        throw new AddressError('unresolved');
    }
    if (addresses.length === 0) throw new AddressError('unresolved');
    if (addresses.some((entry) => !isPublicAddress(entry.address))) throw new AddressError('private');
    return { url, addresses: addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })) };
}

/** Passes the answer through and fails it if it grows past the cap. */
function capped(limit: number): Transform {
    let size = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            if (size > limit) callback(new Error('Answer too large'));
            else callback(null, chunk);
        },
    });
}

/** `fetch` for an address a person typed: checked first, connected to as checked, redirects handed back, never followed. */
export async function ownComputerFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const checked = await checkAddress(String(input));
    const { url, addresses } = checked;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
        headers[key] = value;
    });
    const body = typeof init.body === 'string' ? init.body : undefined;
    if (init.body !== undefined && body === undefined) throw new Error('Own-computer calls only send text bodies');
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));

    return new Promise<Response>((resolve, reject) => {
        const signal = init.signal ?? undefined;
        if (signal?.aborted) {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
            return;
        }
        const request = https.request(
            {
                method: init.method ?? 'GET',
                hostname: url.hostname,
                servername: url.hostname,
                port: url.port || 443,
                path: `${url.pathname}${url.search}`,
                headers,
                // A socket of its own: a pooled one that another caller opened without this guard is never reused
                agent: false,
                // The name is never looked up again: the socket gets the addresses that were checked, and can fall back between them.
                lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
                    if (options && options.all) callback(null, addresses);
                    else callback(null, addresses[0].address, addresses[0].family);
                }) as never,
            },
            (response) => {
                clearTimeout(connectTimer);
                const stream = response.pipe(capped(MAX_RESPONSE_BYTES));
                response.on('error', (error) => stream.destroy(error));
                // A reader that cancels, or an answer past the cap, ends the stream: close the connection too, instead of leaving it open until the other side hangs up
                stream.on('close', () => response.destroy());
                const noBody = [101, 204, 205, 304].includes(response.statusCode ?? 0);
                const responseHeaders = new Headers();
                for (const [key, value] of Object.entries(response.headers)) {
                    if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(key, entry));
                    else if (value !== undefined) responseHeaders.set(key, value);
                }
                resolve(
                    new Response(noBody ? null : (Readable.toWeb(stream) as unknown as ReadableStream), {
                        // Response throws on anything outside 200-599, which an odd server can send
                        status: response.statusCode && response.statusCode >= 200 && response.statusCode <= 599 ? response.statusCode : 502,
                        statusText: response.statusMessage,
                        headers: responseHeaders,
                    })
                );
            }
        );
        const connectTimer = setTimeout(() => request.destroy(new Error('Timed out connecting')), CONNECT_TIMEOUT_MS);
        // The limit is for getting connected, not for a slow model to start answering: stop it once the handshake is done
        request.on('socket', (socket) => {
            const tls = socket as TLSSocket;
            if (!tls.connecting && tls.getProtocol?.()) clearTimeout(connectTimer);
            else socket.once('secureConnect', () => clearTimeout(connectTimer));
        });
        const onAbort = () => request.destroy(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        signal?.addEventListener('abort', onAbort, { once: true });
        request.on('error', (error) => {
            clearTimeout(connectTimer);
            signal?.removeEventListener('abort', onAbort);
            reject(error);
        });
        request.on('close', () => signal?.removeEventListener('abort', onAbort));
        if (body !== undefined) request.write(body);
        request.end();
    });
}
