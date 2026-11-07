// The address guard for an address a person typed (#1874). It mirrors the bot server's own-computer guard and Orbit's: https and a
// name only, every address the name gives must be public, the connection goes to the address that was checked, only the speech
// paths, no redirect followed, a size cap.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';
import { AddressError, isPublicAddress, parsePublicHttpsUrl, publicFetch } from '../src/kit/publicFetch.ts';

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

async function problem(run: () => unknown): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error instanceof AddressError ? error.problem : `other:${String(error)}`;
    }
}

describe('isPublicAddress', () => {
    it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])('allows the public address %s', (ip) => expect(isPublicAddress(ip)).toBe(true));
    it.each([
        '0.0.0.0', '10.0.0.5', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.10', '198.18.0.1', '224.0.0.1',
        '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::7f00:1',
    ])('refuses the private, loopback or reserved address %s', (ip) => expect(isPublicAddress(ip)).toBe(false));
    it('refuses anything that is not an address', () => {
        expect(isPublicAddress('speech.example.com')).toBe(false);
        expect(isPublicAddress('')).toBe(false);
    });
});

describe('parsePublicHttpsUrl', () => {
    it('accepts an https name, with a port, on the speech paths', () => {
        expect(parsePublicHttpsUrl('https://speech.example.com/v1/audio/speech').hostname).toBe('speech.example.com');
        expect(parsePublicHttpsUrl('https://random-words.trycloudflare.com:8443/v1/audio/transcriptions').port).toBe('8443');
        expect(parsePublicHttpsUrl('https://speech.example.com/audio/speech/').pathname).toBe('/audio/speech/');
    });
    it.each([
        ['http://speech.example.com/v1/audio/speech', 'not-https'],
        ['speech.example.com/v1/audio/speech', 'not-https'],
        ['', 'not-https'],
        ['https://user:pass@speech.example.com/v1/audio/speech', 'credentials'],
        ['https://127.0.0.1/v1/audio/speech', 'not-a-name'],
        ['https://2130706433/v1/audio/speech', 'not-a-name'],
        ['https://0x7f.0.0.1/v1/audio/speech', 'not-a-name'],
        ['https://[::1]/v1/audio/speech', 'not-a-name'],
        ['https://localhost/v1/audio/speech', 'not-a-name'],
        ['https://app.localhost/v1/audio/speech', 'not-a-name'],
        ['https://intranet/v1/audio/speech', 'not-a-name'],
        ['https://speech.example.com/admin', 'path'],
        ['https://speech.example.com/', 'path'],
        ['https://speech.example.com/v1/models', 'path'],
        ['https://speech.example.com/v1/audio/speech/../../files', 'path'],
    ])('refuses %s', async (raw, expected) => {
        expect(await problem(() => parsePublicHttpsUrl(raw))).toBe(expected);
    });
});

describe('publicFetch', () => {
    let seen: any;
    let written: Buffer[];

    function fakeServer(status: number, body: string | Buffer, headers: Record<string, string> = {}, statusMessage = 'x') {
        vi.spyOn(https, 'request').mockImplementation(((options: any, callback: (res: any) => void) => {
            seen = options;
            written = [];
            const req: any = Object.assign(new EventEmitter(), {
                destroy: vi.fn((error?: Error) => error && req.emit('error', error)),
                write: (chunk: Buffer) => written.push(Buffer.from(chunk)),
                end: () => {
                    const res: any = new PassThrough();
                    res.statusCode = status;
                    res.statusMessage = statusMessage;
                    res.headers = headers;
                    callback(res);
                    res.end(body);
                },
            });
            return req;
        }) as never);
    }

    beforeEach(() => {
        lookupMock.mockReset();
        seen = undefined;
        written = [];
    });
    afterEach(() => vi.restoreAllMocks());

    it('looks the name up, then connects only to the addresses that were checked, with the name kept for the certificate', async () => {
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]);
        fakeServer(200, 'ok');
        const response = await publicFetch('https://speech.example.com/v1/audio/speech', { method: 'POST', headers: { authorization: 'Bearer k' }, body: '{"a":1}' });
        expect(await response.text()).toBe('ok');
        expect(seen).toMatchObject({ hostname: 'speech.example.com', servername: 'speech.example.com', path: '/v1/audio/speech', method: 'POST', agent: false });
        expect(seen.headers).toMatchObject({ authorization: 'Bearer k', 'content-length': '7' });
        // The connection's own lookup answers with the checked addresses and never asks DNS again
        const answered: unknown[] = [];
        seen.lookup('speech.example.com', { all: true }, (...args: unknown[]) => answered.push(args));
        expect(answered).toEqual([[null, [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]]]);
        expect(lookupMock).toHaveBeenCalledTimes(1);
        expect(Buffer.concat(written).toString()).toBe('{"a":1}');
    });

    it('refuses a name that gives ANY private address, and never connects', async () => {
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.5', family: 4 }]);
        const request = vi.spyOn(https, 'request');
        expect(await problem(() => publicFetch('https://speech.example.com/v1/audio/speech'))).toBe('private');
        lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        expect(await problem(() => publicFetch('https://speech.example.com/v1/audio/speech'))).toBe('private');
        lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
        expect(await problem(() => publicFetch('https://speech.example.com/v1/audio/speech'))).toBe('private');
        expect(request).not.toHaveBeenCalled();
    });

    it('says a name that does not exist is unresolved', async () => {
        lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
        expect(await problem(() => publicFetch('https://gone.example.com/v1/audio/speech'))).toBe('unresolved');
        lookupMock.mockResolvedValue([]);
        expect(await problem(() => publicFetch('https://gone.example.com/v1/audio/speech'))).toBe('unresolved');
    });

    it('refuses a bare address, plain http and any other path before a lookup', async () => {
        for (const raw of ['https://10.0.0.1/v1/audio/speech', 'http://speech.example.com/v1/audio/speech', 'https://speech.example.com/v1/chat/completions']) {
            expect(await problem(() => publicFetch(raw))).not.toBeNull();
        }
        expect(lookupMock).not.toHaveBeenCalled();
    });

    it('hands a redirect back as it is and never follows it', async () => {
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        fakeServer(302, '', { location: 'https://169.254.169.254/latest' });
        const response = await publicFetch('https://speech.example.com/v1/audio/speech', { redirect: 'manual' });
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('https://169.254.169.254/latest');
        expect(https.request).toHaveBeenCalledTimes(1);
    });

    it('answers, rather than crashes, when a server sends a reason phrase or headers a Response would refuse', async () => {
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        fakeServer(200, '{}', {}, 'bad\u0100phrase');
        const response = await publicFetch('https://speech.example.com/v1/audio/speech');
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('{}');
        // Anything else that makes Response throw rejects the call, never an uncaught error
        fakeServer(200, '{}', { 'bad header': 'x' });
        await expect(publicFetch('https://speech.example.com/v1/audio/speech')).rejects.toThrow();
    });

    it('sends a recording and its settings as a form, with the boundary in the content type', async () => {
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        fakeServer(200, '{}');
        const form = new FormData();
        form.set('model', 'whisper-small');
        form.set('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), 'speech.wav');
        await publicFetch('https://speech.example.com/v1/audio/transcriptions', { method: 'POST', body: form });
        expect(String(seen.headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/);
        const sent = Buffer.concat(written);
        expect(sent.toString('latin1')).toContain('name="model"');
        expect(sent.toString('latin1')).toContain('filename="speech.wav"');
        expect(seen.headers['content-length']).toBe(String(sent.length));
    });

    it('sends bytes as they are', async () => {
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        fakeServer(200, '{}');
        await publicFetch('https://speech.example.com/v1/audio/speech', { method: 'POST', body: new Uint8Array([9, 8, 7]) });
        expect([...Buffer.concat(written)]).toEqual([9, 8, 7]);
    });

    it('is cancelled by the caller', async () => {
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        const controller = new AbortController();
        controller.abort();
        await expect(publicFetch('https://speech.example.com/v1/audio/speech', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    });
});
