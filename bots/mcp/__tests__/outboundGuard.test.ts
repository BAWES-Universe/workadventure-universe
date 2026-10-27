import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookup = vi.fn();
vi.mock('dns/promises', () => ({ lookup: (...args: unknown[]) => lookup(...args) }));

import { checkOutboundUrl, isAllowedServerUrl } from '../outboundGuard';

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

    it('refuses a hostname that does not resolve', async () => {
        lookup.mockRejectedValue(new Error('ENOTFOUND'));
        expect((await checkOutboundUrl('https://nowhere.example.com/')).allowed).toBe(false);
    });

    it('refuses an internal URL without looking it up', async () => {
        expect((await checkOutboundUrl('https://[::ffff:a9fe:a9fe]/')).allowed).toBe(false);
        expect(lookup).not.toHaveBeenCalled();
    });
});
