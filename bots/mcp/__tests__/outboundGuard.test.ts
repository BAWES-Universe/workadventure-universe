import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookup = vi.fn();
vi.mock('dns/promises', () => ({ lookup: (...args: unknown[]) => lookup(...args) }));
const callbackLookup = vi.fn();
vi.mock('dns', () => ({ lookup: (...args: unknown[]) => callbackLookup(...args) }));

import { checkOutboundUrl, guardedLookup, isAllowedServerUrl } from '../outboundGuard';

beforeEach(() => {
    lookup.mockReset();
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('isAllowedServerUrl', () => {
    it.each([
        // the cases the old check let through (#435)
        'https://127.0.0.2/',
        'https://[::ffff:127.0.0.1]/',
        'https://[::ffff:a9fe:a9fe]/',
        'https://[::ffff:a00:1]/',
        'https://[fe80::1]/',
        'https://foo.internal/',
        // and the ones it already refused
        'https://127.0.0.1/',
        'https://localhost/',
        'https://169.254.169.254/',
        'https://10.0.0.1/',
        'https://172.16.5.4/',
        'https://192.168.1.1/',
        'https://[::1]/',
        'https://[::]/',
        'https://[fd00::1]/',
        'https://0.0.0.0/',
        'https://metadata.google.internal/',
        'ftp://mcp.example.com/',
        'not a url',
    ])('refuses %s', (url) => {
        expect(isAllowedServerUrl(url)).toBe(false);
    });

    it.each(['https://mcp.example.com/mcp', 'http://mcp.example.com:8080/', 'https://93.184.216.34/', 'https://[2606:2800:220:1::1]/'])(
        'allows %s',
        (url) => {
            expect(isAllowedServerUrl(url)).toBe(true);
        }
    );
});

describe('checkOutboundUrl', () => {
    it('allows a public hostname that resolves to public addresses', async () => {
        expect(await checkOutboundUrl('https://mcp.example.com/mcp')).toEqual({ allowed: true });
        expect(lookup).toHaveBeenCalledWith('mcp.example.com', { all: true });
    });

    it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:7f00:1', 'fe80::1', 'fd12::1'])(
        'refuses a public hostname that resolves to %s',
        async (address) => {
            lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }]);
            expect((await checkOutboundUrl('https://mcp.example.com/mcp')).allowed).toBe(false);
        }
    );

    it.each(['0.1.2.3', '100.64.0.1', '100.100.100.200', '100.127.255.254', '192.0.0.8', '198.18.0.1', '198.19.255.255'])(
        'refuses the shared and reserved address %s, as a literal and as a lookup result',
        async (address) => {
            expect(isAllowedServerUrl(`https://${address}/`)).toBe(false);
            lookup.mockResolvedValue([{ address, family: 4 }]);
            expect((await checkOutboundUrl('https://mcp.example.com/mcp')).allowed).toBe(false);
        }
    );

    it.each(['100.63.255.255', '100.128.0.1', '198.17.255.255', '198.20.0.1', '198.51.100.7', '203.0.113.9'])(
        'still allows the public address %s next to those ranges',
        (address) => {
            expect(isAllowedServerUrl(`https://${address}/`)).toBe(true);
        }
    );

    it('refuses a hostname that does not resolve', async () => {
        lookup.mockRejectedValue(new Error('ENOTFOUND'));
        expect((await checkOutboundUrl('https://nowhere.example.com/')).allowed).toBe(false);
    });

    it('refuses an internal URL without looking it up', async () => {
        expect((await checkOutboundUrl('https://[::ffff:a9fe:a9fe]/')).allowed).toBe(false);
        expect(lookup).not.toHaveBeenCalled();
    });
});

describe('guardedLookup (the lookup the request connects with)', () => {
    const answer = (addresses: { address: string; family: number }[]) =>
        callbackLookup.mockImplementation((_host: string, _options: unknown, cb: (e: null, a: unknown) => void) => cb(null, addresses));
    const run = (all: boolean) =>
        new Promise<{ error: Error | null; address: unknown; family?: number }>((resolve) =>
            guardedLookup('mcp.example.com', { all }, (error, address, family) => resolve({ error, address, family }))
        );

    it('connects to a public address, in both answer shapes', async () => {
        answer([{ address: '93.184.216.34', family: 4 }]);
        expect(await run(false)).toEqual({ error: null, address: { address: '93.184.216.34', family: 4 }, family: 4 });
        expect((await run(true)).address).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });

    it('fails the connection when the name now resolves to a private address (DNS rebinding)', async () => {
        answer([{ address: '127.0.0.1', family: 4 }]);
        expect((await run(false)).error).toBeInstanceOf(Error);
        answer([{ address: '93.184.216.34', family: 4 }, { address: '::ffff:a9fe:a9fe', family: 6 }]);
        expect((await run(true)).error).toBeInstanceOf(Error);
    });

    it('passes a DNS error on', async () => {
        const failure = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
        callbackLookup.mockImplementation((_host: string, _options: unknown, cb: (e: Error) => void) => cb(failure));
        expect((await run(false)).error).toBe(failure);
    });
});
