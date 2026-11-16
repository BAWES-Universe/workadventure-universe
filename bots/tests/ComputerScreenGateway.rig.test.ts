/**
 * The screen gateway against a REAL screen server: an X display with a terminal in it, a VNC server for that display (x0vncserver) and
 * websockify in front of it, the way the computer image runs them. Skipped unless the rig is running (SCREEN_RIG=yes):
 *
 *   Xvfb :77 -screen 0 800x500x24 &
 *   DISPLAY=:77 xterm -geometry 90x30+0+0 -e 'cat > /tmp/typed.txt' &
 *   x0vncserver -display :77 -rfbport 5977 -SecurityTypes None -AlwaysShared &
 *   websockify 6977 127.0.0.1:5977 &
 *   SCREEN_RIG=yes npx vitest run tests/ComputerScreenGateway.rig.test.ts
 *
 * It proves what the unit tests cannot: a real handshake passes the viewer filter, a watching viewer's keys and clicks never reach the
 * display while the same keys from a viewer in control are typed into it, and the picture comes back.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createScreenGateway, type ScreenGateway, type ScreenMode, type ScreenOrbit } from '../server/ComputerScreenGateway';

const rig = process.env.SCREEN_RIG === 'yes' ? describe : describe.skip;
const TYPED = '/tmp/typed.txt';

/** A small viewer that speaks the screen protocol (RFB 3.8, no security, raw pixels) through the gateway. */
async function viewer(url: string) {
    const socket = new WebSocket(url, 'binary');
    const chunks: Buffer[] = [];
    let waiting: (() => void) | null = null;
    socket.on('message', (data) => {
        chunks.push(Buffer.from(data as Buffer));
        waiting?.();
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
        socket.once('unexpected-response', (_request, response) => reject(new Error(`status ${response.statusCode}`)));
    });
    const take = async (count: number): Promise<Buffer> => {
        const end = Date.now() + 8000;
        for (;;) {
            const have = Buffer.concat(chunks);
            if (have.length >= count) {
                chunks.length = 0;
                if (have.length > count) chunks.push(have.subarray(count));
                return have.subarray(0, count);
            }
            if (Date.now() > end) throw new Error(`waited for ${count} bytes, have ${have.length}`);
            await new Promise<void>((resolve) => {
                waiting = resolve;
                setTimeout(resolve, 100);
            });
        }
    };
    // Handshake
    expect((await take(12)).toString('ascii')).toMatch(/^RFB 003\.00\d\n$/);
    socket.send(Buffer.from('RFB 003.008\n'));
    const types = await take(1);
    await take(types[0]);
    socket.send(Buffer.from([1]));
    expect((await take(4)).readUInt32BE(0)).toBe(0);
    socket.send(Buffer.from([1]));
    const init = await take(24);
    const width = init.readUInt16BE(0);
    const height = init.readUInt16BE(2);
    await take(init.readUInt32BE(20));
    // Raw pixels, then ask for the whole screen
    socket.send(Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]));
    const request = Buffer.alloc(10);
    request[0] = 3;
    request.writeUInt16BE(width, 6);
    request.writeUInt16BE(height, 8);
    socket.send(request);
    const update = await take(4);
    expect(update[0]).toBe(0);
    return {
        socket,
        width,
        height,
        key: (code: number, down: boolean) => {
            const message = Buffer.alloc(8);
            message[0] = 4;
            message[1] = down ? 1 : 0;
            message.writeUInt32BE(code, 4);
            socket.send(message);
        },
        pointer: (x: number, y: number) => {
            const message = Buffer.alloc(6);
            message[0] = 5;
            message.writeUInt16BE(x, 2);
            message.writeUInt16BE(y, 4);
            socket.send(message);
        },
        async picture(): Promise<boolean> {
            // Some picture bytes came back
            const end = Date.now() + 4000;
            while (Date.now() < end) {
                if (chunks.length > 0 && Buffer.concat(chunks).length > 1000) return true;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return false;
        },
    };
}

rig('the screen gateway against a real screen server', () => {
    let http: Server;
    let gateway: ScreenGateway;
    let url: string;
    let mode: ScreenMode = 'watch';
    const orbit: ScreenOrbit = {
        open: async () => ({ ok: true, upstream: 'http://127.0.0.1:6977/?a37_token=rig', mode, checkEveryMs: 1000, maxMs: 60_000 }),
        check: async () => ({ ok: true, mode }),
    };

    beforeAll(async () => {
        gateway = createScreenGateway({ orbit });
        http = createServer();
        http.on('upgrade', (request, socket, head) => {
            if (!gateway.handleUpgrade(request, socket, head)) socket.destroy();
        });
        await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
        url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/computer/screen?ticket=rig`;
    });
    afterAll(async () => {
        gateway.close();
        await new Promise<void>((resolve) => {
            http.closeAllConnections();
            http.close(() => resolve());
        });
    });

    const typeHi = async (view: Awaited<ReturnType<typeof viewer>>) => {
        // Click into the terminal, then type "hi" and Enter (key symbols for h, i and Return)
        view.pointer(100, 100);
        await new Promise((resolve) => setTimeout(resolve, 200));
        for (const code of [0x68, 0x69, 0xff0d]) {
            view.key(code, true);
            view.key(code, false);
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
    };

    it('a viewer that is only watching gets the picture, and nothing it types or clicks reaches the display', async () => {
        writeFileSync(TYPED, '');  // truncates in place: the terminal keeps the same file open
        mode = 'watch';
        const view = await viewer(url);
        expect(view.width).toBe(800);
        expect(await view.picture()).toBe(true);
        await typeHi(view);
        view.socket.close();
        expect(readFileSync(TYPED, 'utf8')).toBe('');
    });

    it('a viewer in control types into the display', async () => {
        writeFileSync(TYPED, '');  // truncates in place: the terminal keeps the same file open
        mode = 'input';
        const view = await viewer(url);
        await typeHi(view);
        view.socket.close();
        // The terminal passes a line to the file once Enter is pressed
        expect(existsSync(TYPED) ? readFileSync(TYPED, 'utf8') : '').toContain('hi');
    });
});
