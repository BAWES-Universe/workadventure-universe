/**
 * Outbound destination guard (SSRF prevention) for the MCP servers a bot owner configured.
 *
 * The same rules as the admin app's `lib/mcp/outbound-guard.ts`, which checks these URLs when they are saved and
 * tested. This copy runs before every request the bot sends, so it is the one that also catches a hostname whose DNS
 * changed after it was saved (#435).
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'dns';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * The IPv4 address inside an IPv4-mapped IPv6 address, in either spelling: `::ffff:127.0.0.1`, or `::ffff:7f00:1`,
 * which is how `new URL()` and DNS lookups write it. Returns null for anything else.
 */
function mappedIpv4(ip: string): string | null {
    const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
    if (dotted) return dotted[1];
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
    if (!hex) return null;
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** Whether an IPv4 address is loopback, unspecified, private or link-local (which covers cloud metadata). */
function isPrivateIpv4(ip: string): boolean {
    return (
        /^127\./.test(ip) ||
        ip === '0.0.0.0' ||
        /^10\./.test(ip) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
        /^192\.168\./.test(ip) ||
        /^169\.254\./.test(ip)
    );
}

/**
 * Whether an IP address may be sent to. A mapped IPv4 address is read in both spellings, and one that can't be read
 * is refused rather than let through unchecked.
 */
function isAllowedIp(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return false;
    if (/^::ffff:/.test(lower)) {
        const ipv4 = mappedIpv4(lower);
        return ipv4 !== null && !isPrivateIpv4(ipv4);
    }
    if (isPrivateIpv4(lower)) return false;
    if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return false; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return false; // fe80::/10 link-local
    return true;
}

/** The URL check alone, without DNS: protocol, internal hostnames and IP literals. */
export function isAllowedServerUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return false;
        const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
        if (hostname.endsWith('.internal')) return false; // metadata.google.internal and the like
        if (isIP(hostname) > 0) return isAllowedIp(hostname);
        return true;
    } catch {
        return false;
    }
}

/**
 * The URL check, then every address its hostname resolves to (an IP literal resolves to itself). Resolves to
 * `{ allowed: false, error }` rather than throwing.
 */
export async function checkOutboundUrl(url: string): Promise<{ allowed: boolean; error?: string }> {
    if (!isAllowedServerUrl(url)) {
        return { allowed: false, error: 'URL points to an internal or private address' };
    }
    try {
        const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
        const addresses = await lookup(hostname, { all: true });
        if (addresses.length === 0) return { allowed: false, error: 'Hostname did not resolve' };
        const blocked = addresses.find((address) => !isAllowedIp(address.address));
        if (blocked) return { allowed: false, error: `Hostname resolves to an internal or private address (${blocked.address})` };
        return { allowed: true };
    } catch (error: unknown) {
        return { allowed: false, error: `DNS resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
}

type ResolvedAddress = { address: string; family?: 4 | 6 };

/**
 * A `lookup` for the request itself, so the address the connection is made to is the one that was checked: the name
 * is resolved again when the request connects, and a private answer then (a name re-pointed after the check above,
 * "DNS rebinding") fails the request.
 */
export function guardedLookup(
    hostname: string,
    options: object,
    callback: (error: Error | null, address: ResolvedAddress | ResolvedAddress[], family?: 4 | 6) => void
): void {
    const { all } = options as { all?: boolean };
    dnsLookup(hostname, { ...(options as LookupOptions), all: true }, (error, found: LookupAddress[]) => {
        if (error) return callback(error, []);
        const addresses = found.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
        const blocked = addresses.find((entry) => !isAllowedIp(entry.address));
        if (blocked || addresses.length === 0) {
            return callback(new Error(`Refused: ${hostname} resolves to an internal or private address`), []);
        }
        if (all) return callback(null, addresses);
        callback(null, addresses[0], addresses[0].family);
    });
}
