import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { createInputFilter, createScreenGateway, screenOrbitFor, upstreamSocketUrl, type ScreenGateway, type ScreenMode, type ScreenOrbit } from '../server/ComputerScreenGateway';

const hello = Buffer.from('RFB 003.008\n', 'ascii');
const key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]);
const pointer = Buffer.from([5, 1, 0, 10, 0, 20]);
const update = Buffer.from([3, 0, 0, 0, 0, 0, 0, 100, 0, 100]);
const pixelFormat = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.alloc(16)]);
const encodings = Buffer.concat([Buffer.from([2, 0, 0, 2]), Buffer.alloc(8)]);
const cutText = (text: string) => Buffer.concat([Buffer.from([6, 0, 0, 0]), (() => { const length = Buffer.alloc(4); length.writeUInt32BE(text.length); return length; })(), Buffer.from(text)]);
const handshake = [hello, Buffer.from([1]), Buffer.from([1])];
const shake = (filter: ReturnType<typeof createInputFilter>) => {
    for (const part of handshake) filter.push(part);
};
const joined = (parts: Buffer[]) => Buffer.concat(parts);

describe('what a viewer may send', () => {
    it('watch sends the handshake, pixel format, encodings and update requests on, and drops keys, pointer and clipboard', () => {
        const filter = createInputFilter('watch');
        const handshakeOut = joined(handshake.map((part) => joined(filter.push(part).forward)));
        expect(handshakeOut).toEqual(joined(handshake));
        const result = filter.push(joined([pixelFormat, encodings, key, pointer, cutText('secret'), update]));
        expect(result.close).toBe(false);
        expect(joined(result.forward)).toEqual(joined([pixelFormat, encodings, update]));
    });

    it('input sends everything on', () => {
        const filter = createInputFilter('input');
        shake(filter);
        const all = joined([key, pointer, cutText('hello'), update]);
        expect(joined(filter.push(all).forward)).toEqual(all);
    });

    it('is not fooled by messages cut anywhere: byte by byte is the same as all at once', () => {
        const filter = createInputFilter('watch');
        const stream = joined([...handshake, pixelFormat, key, encodings, pointer, cutText('abc'), update]);
        const out: Buffer[] = [];
        for (const byte of stream) {
            const result = filter.push(Buffer.from([byte]));
            expect(result.close).toBe(false);
            out.push(...result.forward);
        }
        expect(joined(out)).toEqual(joined([...handshake, pixelFormat, encodings, update]));
    });

    it('closes on a message it does not understand, on a security choice other than none, on a strange hello and on huge clipboard text', () => {
        const odd = createInputFilter('watch');
        shake(odd);
        expect(odd.push(Buffer.from([99, 0, 0, 0])).close).toBe(true);
        const security = createInputFilter('watch');
        security.push(hello);
        expect(security.push(Buffer.from([2])).close).toBe(true);
        expect(createInputFilter('watch').push(Buffer.from('GET / HTTP/1.1\r\n')).close).toBe(true);
        const big = createInputFilter('input');
        shake(big);
        const header = Buffer.from([6, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff]);
        expect(big.push(header).close).toBe(true);
    });

    it('understands the extensions a viewer sends when the machine offers them: watch drops the QEMU key and the resize, and sends fence and continuous updates on', () => {
        const continuous = Buffer.from([150, 1, 0, 0, 0, 0, 3, 32, 2, 88]);
        const fence = Buffer.concat([Buffer.from([248, 0, 0, 0, 0, 0, 0, 1, 3]), Buffer.from('abc')]);
        const qemuKey = Buffer.concat([Buffer.from([255, 0, 0, 1]), Buffer.alloc(8)]);
        const resize = Buffer.concat([Buffer.from([251, 0, 3, 32, 2, 88, 1, 0]), Buffer.alloc(16)]);
        const watch = createInputFilter('watch');
        shake(watch);
        const result = watch.push(joined([continuous, qemuKey, fence, resize, update]));
        expect(result.close).toBe(false);
        expect(joined(result.forward)).toEqual(joined([continuous, fence, update]));
        const input = createInputFilter('input');
        shake(input);
        const all = joined([continuous, qemuKey, fence, resize]);
        expect(joined(input.push(all).forward)).toEqual(all);
        // A QEMU message of another kind is not understood
        const other = createInputFilter('input');
        shake(other);
        expect(other.push(Buffer.from([255, 1, 0, 0])).close).toBe(true);
    });

    it('reads the extended clipboard form (a negative length) by its size, and drops it when watching', () => {
        const extended = Buffer.concat([Buffer.from([6, 0, 0, 0, 0xff, 0xff, 0xff, 0xf8]), Buffer.from('12345678')]);
        const watch = createInputFilter('watch');
        shake(watch);
        const result = watch.push(joined([extended, update]));
        expect(result.close).toBe(false);
        expect(joined(result.forward)).toEqual(update);
        const input = createInputFilter('input');
        shake(input);
        expect(joined(input.push(joined([extended, update])).forward)).toEqual(joined([extended, update]));
    });

    it('version 3.3 has no choice of security, so the next byte is the hello', () => {
        const filter = createInputFilter('watch');
        filter.push(Buffer.from('RFB 003.003\n'));
        filter.push(Buffer.from([1]));
        expect(joined(filter.push(joined([key, update])).forward)).toEqual(update);
    });
});

describe('where the machine’s screen socket is', () => {
    it('takes the link’s host and token and the socket path, and nothing else', () => {
        expect(upstreamSocketUrl('https://m1.agent37.app/vnc.html?a37_token=abc#x')).toBe('wss://m1.agent37.app/websockify?a37_token=abc');
        expect(upstreamSocketUrl('ftp://x')).toBeNull();
        expect(upstreamSocketUrl('not a url')).toBeNull();
    });
});

describe('asking Orbit', () => {
    it('reads what Orbit answers and throws when it cannot be understood', async () => {
        const admin = { computerScreenCall: vi.fn() };
        const orbit = screenOrbitFor(admin);
        admin.computerScreenCall.mockResolvedValueOnce({ status: 200, data: { ok: true, upstream: 'https://m', mode: 'input', checkEveryMs: 4000, maxMs: 9000 } });
        expect(await orbit.open('t')).toEqual({ ok: true, upstream: 'https://m', mode: 'input', checkEveryMs: 4000, maxMs: 9000 });
        admin.computerScreenCall.mockResolvedValueOnce({ status: 200, data: { ok: false, reason: 'resting' } });
        expect(await orbit.open('t')).toEqual({ ok: false, reason: 'resting' });
        admin.computerScreenCall.mockResolvedValueOnce({ status: 401, data: {} });
        await expect(orbit.open('t')).rejects.toThrow();
        admin.computerScreenCall.mockResolvedValueOnce({ status: 200, data: { ok: true } });
        expect(await orbit.check('t')).toEqual({ ok: true, mode: 'watch' });
        admin.computerScreenCall.mockResolvedValueOnce({ status: 200, data: { ok: false, reason: 'not_taken_over' } });
        expect(await orbit.check('t')).toEqual({ ok: false, reason: 'not_taken_over' });
        admin.computerScreenCall.mockResolvedValueOnce({ status: 500, data: {} });
        await expect(orbit.check('t')).rejects.toThrow();
    });
});

/** The gateway end to end, with a real viewer, a real bot-server socket and a pretend machine. */
describe('the screen gateway', () => {
    let http: Server;
    let machineServer: WebSocketServer;
    let machineUrl: string;
    let gatewayUrl: string;
    let gateway: ScreenGateway;
    let machineReceived: Buffer[];
    let machineSockets: WebSocket[];
    let connectedTo: string[];
    const orbit = { open: vi.fn(), check: vi.fn() } satisfies ScreenOrbit;
    const opened = (mode: ScreenMode = 'watch', over: Record<string, unknown> = {}) => ({ ok: true as const, upstream: 'https://m1.agent37.app/?a37_token=zzz', mode, checkEveryMs: 1000, maxMs: 60_000, ...over });
    const viewers: WebSocket[] = [];

    beforeEach(async () => {
        orbit.open.mockReset();
        orbit.check.mockReset();
        orbit.check.mockResolvedValue({ ok: true, mode: 'watch' });
        machineReceived = [];
        machineSockets = [];
        connectedTo = [];
        machineServer = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false) });
        machineServer.on('connection', (socket) => {
            machineSockets.push(socket);
            socket.on('message', (data) => machineReceived.push(Buffer.from(data as Buffer)));
        });
        await new Promise<void>((resolve) => machineServer.on('listening', () => resolve()));
        machineUrl = `ws://127.0.0.1:${(machineServer.address() as AddressInfo).port}`;
        gateway = createScreenGateway({
            orbit,
            connect: (url) => {
                connectedTo.push(url);
                return new WebSocket(machineUrl, 'binary');
            },
            log: { warn: () => undefined, error: () => undefined },
        });
        http = createServer((_request, response) => response.end('ok'));
        http.on('upgrade', (request, socket, head) => {
            if (!gateway.handleUpgrade(request, socket, head)) socket.destroy();
        });
        await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
        gatewayUrl = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/computer/screen`;
    });

    afterEach(async () => {
        for (const viewer of viewers.splice(0)) viewer.terminate();
        gateway.close();
        for (const socket of machineSockets) socket.terminate();
        await new Promise<void>((resolve) => machineServer.close(() => resolve()));
        await new Promise<void>((resolve) => {
            http.closeAllConnections();
            http.close(() => resolve());
        });
    });

    const viewer = async (ticket = 'ticket-1'): Promise<WebSocket> => {
        const socket = new WebSocket(`${gatewayUrl}?ticket=${ticket}`, 'binary');
        viewers.push(socket);
        await new Promise<void>((resolve, reject) => {
            socket.once('open', () => resolve());
            socket.once('error', reject);
            socket.once('unexpected-response', (_request, response) => reject(new Error(`status ${response.statusCode}`)));
        });
        return socket;
    };
    const closed = (socket: WebSocket) => new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    const until = async (check: () => boolean, ms = 3000) => {
        const end = Date.now() + ms;
        while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
        expect(check()).toBe(true);
    };

    it('joins the viewer to the machine, with Agent37’s link used for the machine only, and drops what a watching viewer types', async () => {
        orbit.open.mockResolvedValue(opened('watch'));
        const socket = await viewer();
        const seen: Buffer[] = [];
        socket.on('message', (data) => seen.push(Buffer.from(data as Buffer)));
        for (const part of [...handshake, key, pointer, update]) socket.send(part);
        await until(() => machineReceived.length >= 4);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(machineReceived).toEqual([...handshake, update]);
        expect(connectedTo).toEqual(['wss://m1.agent37.app/websockify?a37_token=zzz']);
        machineSockets[0].send(Buffer.from('pixels'));
        await until(() => seen.length === 1);
        expect(seen[0].toString()).toBe('pixels');
        // The viewer never saw the link
        expect(JSON.stringify(seen.map((part) => part.toString()))).not.toContain('zzz');
    });

    it('sends everything on to the machine for the person who took over', async () => {
        orbit.open.mockResolvedValue(opened('input'));
        orbit.check.mockResolvedValue({ ok: true, mode: 'input' });
        const socket = await viewer();
        for (const part of [...handshake, key, pointer]) socket.send(part);
        await until(() => machineReceived.length >= 5);
        expect(machineReceived.slice(3)).toEqual([key, pointer]);
    });

    it('closes both sockets on a message it does not understand', async () => {
        orbit.open.mockResolvedValue(opened('watch'));
        const socket = await viewer();
        const code = closed(socket);
        for (const part of handshake) socket.send(part);
        socket.send(Buffer.from([99, 0, 0, 0]));
        expect(await code).toBe(1008);
        await until(() => machineSockets[0].readyState === WebSocket.CLOSED || machineSockets[0].readyState === WebSocket.CLOSING);
    });

    it('closes both sockets the moment Orbit says no: the job is over, the machine rests, or the keyboard was handed back', async () => {
        orbit.open.mockResolvedValue(opened('input'));
        orbit.check.mockResolvedValueOnce({ ok: true, mode: 'input' }).mockResolvedValue({ ok: false, reason: 'not_taken_over' });
        const socket = await viewer();
        expect(await closed(socket)).toBe(1008);
        await until(() => machineSockets[0].readyState !== WebSocket.OPEN);
        expect(orbit.check).toHaveBeenCalledWith('ticket-1');
    });

    it('closes when Orbit cannot be reached, and when an input socket is only allowed to watch now', async () => {
        orbit.open.mockResolvedValue(opened('watch'));
        orbit.check.mockRejectedValue(new Error('down'));
        expect(await closed(await viewer())).toBe(1011);
        orbit.open.mockResolvedValue(opened('input'));
        orbit.check.mockResolvedValue({ ok: true, mode: 'watch' });
        expect(await closed(await viewer())).toBe(1008);
    });

    it('closes the viewer when the machine closes its screen, and is never kept past the longest time Orbit allows', async () => {
        orbit.open.mockResolvedValue(opened('watch'));
        const socket = await viewer();
        await until(() => machineSockets.length === 1);
        const code = closed(socket);
        machineSockets[0].close();
        await code;
        orbit.open.mockResolvedValue(opened('watch', { maxMs: 1000, checkEveryMs: 60_000 }));
        const late = await viewer();
        expect(await closed(late)).toBe(1000);
    });

    it('opens nothing without a ticket, with a ticket Orbit refuses, with a resting machine, or when Orbit is down', async () => {
        const attempt = (query: string) =>
            new Promise<number>((resolve) => {
                const upgrade = httpRequest({ host: '127.0.0.1', port: (http.address() as AddressInfo).port, path: `/computer/screen${query}`, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
                upgrade.on('response', (response) => resolve(response.statusCode ?? 0));
                upgrade.on('upgrade', (response) => resolve(response.statusCode ?? 0));
                upgrade.on('error', () => resolve(0));
                upgrade.end();
            });
        expect(await attempt('')).toBe(400);
        expect(orbit.open).not.toHaveBeenCalled();
        orbit.open.mockResolvedValueOnce({ ok: false, reason: 'invalid' });
        expect(await attempt('?ticket=bad')).toBe(403);
        orbit.open.mockResolvedValueOnce({ ok: false, reason: 'resting' });
        expect(await attempt('?ticket=t')).toBe(409);
        orbit.open.mockRejectedValueOnce(new Error('down'));
        expect(await attempt('?ticket=t')).toBe(503);
        expect(gateway.open()).toBe(0);
        expect(connectedTo).toEqual([]);
    });

    it('leaves every other upgrade alone', () => {
        const socket = { write: vi.fn(), destroy: vi.fn() };
        expect(gateway.handleUpgrade({ url: '/other' } as never, socket as never, Buffer.alloc(0))).toBe(false);
        expect(socket.destroy).not.toHaveBeenCalled();
    });
});
