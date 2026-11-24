/**
 * The screen of a Brick's computer, carried by the bot server (build handoff v2, section 4). Orbit decides, this carries: Orbit runs on
 * plain `next start` and cannot hold a WebSocket, so the socket lives here, and every decision is Orbit's.
 *
 *  1. The person's page has a ticket from Orbit (60 seconds, one Brick, watch or input) and connects to `/computer/screen?ticket=...`.
 *  2. Orbit looks again at everything and answers with Agent37's own link for the machine, for this socket only. That link stays here.
 *  3. The two sockets are joined. In WATCH mode every key, pointer and clipboard message the viewer sends is dropped before it is sent
 *     on, so a modified viewer cannot send input; INPUT is only for a person who has taken over.
 *  4. Every few seconds Orbit is asked whether the socket may go on. A no (the job is over, the machine rests, the keyboard was handed
 *     back) or no answer from Orbit closes both sockets. A socket is never kept past the longest time Orbit allows.
 *  5. An INPUT socket also has a deadline of its own, kept here and independent of Orbit: it is closed INPUT_YES_MS after the last
 *     moment a "yes" was asked for (the open, or a check). A check that hangs, or an Orbit that does not answer, can therefore never
 *     leave the person's keyboard open longer than Orbit's own input lease (8 s after a check, 10 s after an open), which is how long a
 *     hand back waits before Brick resumes.
 *
 * Nothing the screen shows or the person types is logged or kept here. A machine that is not running has no link, so nothing here ever
 * wakes one.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

export type ScreenMode = 'watch' | 'input';

/** What the gateway needs of Orbit: the two calls of /api/computer/screen. */
export interface ScreenOrbit {
    open(ticket: string): Promise<{ ok: true; upstream: string; mode: ScreenMode; checkEveryMs: number; maxMs: number } | { ok: false; reason: string }>;
    check(ticket: string): Promise<{ ok: true; mode: ScreenMode } | { ok: false; reason: string }>;
}

export function screenOrbitFor(admin: { computerScreenCall(step: 'open' | 'check', body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> }): ScreenOrbit {
    return {
        async open(ticket) {
            const { status, data } = await admin.computerScreenCall('open', { ticket });
            if (status !== 200) throw new Error(`Orbit answered the screen with ${status}`);
            const mode = data.mode === 'input' ? 'input' : 'watch';
            if (data.ok === true && typeof data.upstream === 'string') {
                return { ok: true, upstream: data.upstream, mode, checkEveryMs: Number(data.checkEveryMs) > 0 ? Number(data.checkEveryMs) : 5000, maxMs: Number(data.maxMs) > 0 ? Number(data.maxMs) : 60 * 60 * 1000 };
            }
            return { ok: false, reason: typeof data.reason === 'string' ? data.reason : 'refused' };
        },
        async check(ticket) {
            const { status, data } = await admin.computerScreenCall('check', { ticket });
            if (status !== 200) throw new Error(`Orbit answered the screen check with ${status}`);
            return data.ok === true ? { ok: true, mode: data.mode === 'input' ? 'input' : 'watch' } : { ok: false, reason: typeof data.reason === 'string' ? data.reason : 'refused' };
        },
    };
}

// ---------- What the viewer may send ----------

/** The longest clipboard text from the viewer that is carried on in input mode. */
const CUT_TEXT_MAX = 1024 * 1024;

export interface InputFilter {
    /** Gives the viewer's next bytes; says what to send on to the machine, and whether the socket must close (a message that is not understood). */
    push(chunk: Buffer): { forward: Buffer[]; close: boolean };
}

/** Encodings that change the size or form of what the viewer sends. They are asked for by the viewer and would have to be understood here. */
const FRAMING_ENCODINGS = new Set([-316, -257]);

/** A SetEncodings message without the encodings in FRAMING_ENCODINGS (and with its count made right). */
function withoutFramingEncodings(message: Buffer): Buffer {
    const count = message.readUInt16BE(2);
    const kept: number[] = [];
    for (let i = 0; i < count; i++) {
        const encoding = message.readInt32BE(4 + 4 * i);
        if (!FRAMING_ENCODINGS.has(encoding)) kept.push(encoding);
    }
    if (kept.length === count) return message;
    const out = Buffer.alloc(4 + 4 * kept.length);
    out[0] = 2;
    out.writeUInt16BE(kept.length, 2);
    kept.forEach((encoding, i) => out.writeInt32BE(encoding, 4 + 4 * i));
    return out;
}

/**
 * Reads the viewer's side of the screen protocol (RFB) so it can be filtered. After the handshake (version, the security choice, the
 * client's hello) every message is one of a few kinds with a known size. Watch mode drops key events (4, and the QEMU form, 255), pointer
 * events (5), clipboard text (6) and size changes (251), and sends the rest on (pixel format, encodings, update requests). A message of a kind not listed here is not understood:
 * the socket closes rather than carrying what cannot be checked.
 */
export function createInputFilter(mode: ScreenMode): InputFilter {
    let buffer = Buffer.alloc(0);
    // version (12 bytes), then the security type the viewer picks (1 byte, none only), then the hello (1 byte), then messages
    let phase: 'version' | 'security' | 'hello' | 'messages' = 'version';

    return {
        push(chunk) {
            buffer = Buffer.concat([buffer, chunk]);
            const forward: Buffer[] = [];
            for (;;) {
                if (phase === 'version') {
                    if (buffer.length < 12) break;
                    const hello = buffer.subarray(0, 12).toString('ascii');
                    if (!/^RFB 003\.00[3-8]\n$/.test(hello)) return { forward, close: true };
                    forward.push(Buffer.from(buffer.subarray(0, 12)));
                    buffer = buffer.subarray(12);
                    // Version 3.3 has no choice of security: the machine decides
                    phase = hello === 'RFB 003.003\n' ? 'hello' : 'security';
                } else if (phase === 'security') {
                    if (buffer.length < 1) break;
                    // The machine offers "none" only; a viewer that picks anything else is not talking to it
                    if (buffer[0] !== 1) return { forward, close: true };
                    forward.push(Buffer.from(buffer.subarray(0, 1)));
                    buffer = buffer.subarray(1);
                    phase = 'hello';
                } else if (phase === 'hello') {
                    if (buffer.length < 1) break;
                    forward.push(Buffer.from(buffer.subarray(0, 1)));
                    buffer = buffer.subarray(1);
                    phase = 'messages';
                } else {
                    if (buffer.length < 1) break;
                    const type = buffer[0];
                    let size: number;
                    if (type === 0) size = 20;
                    else if (type === 2) {
                        if (buffer.length < 4) break;
                        size = 4 + 4 * buffer.readUInt16BE(2);
                    } else if (type === 3) size = 10;
                    else if (type === 4) size = 8;
                    else if (type === 5) size = 6;
                    // Extensions the viewer uses when the machine offers them: continuous updates (150), fence (248, up to 64 bytes
                    // of text), a change of the screen's size (251), and the QEMU key event (255, subtype 0)
                    else if (type === 150) size = 10;
                    else if (type === 248) {
                        if (buffer.length < 9) break;
                        size = 9 + buffer[8];
                    } else if (type === 251) {
                        if (buffer.length < 8) break;
                        size = 8 + 16 * buffer[6];
                    } else if (type === 255) {
                        if (buffer.length < 2) break;
                        if (buffer[1] !== 0) return { forward, close: true };
                        size = 12;
                    } else if (type === 6) {
                        if (buffer.length < 8) break;
                        // A negative length is the extended clipboard form: its size is the length without the sign
                        const length = Math.abs(buffer.readInt32BE(4));
                        if (length > CUT_TEXT_MAX) return { forward, close: true };
                        size = 8 + length;
                    } else return { forward, close: true };
                    if (buffer.length < size) break;
                    let message = buffer.subarray(0, size);
                    buffer = buffer.subarray(size);
                    // The filter measures the viewer's messages by the plain forms. An encoding that makes the viewer send them longer or
                    // differently (ExtendedMouseButtons, QEMU pointer motion) is never passed on, so the machine never turns it on
                    if (type === 2) message = withoutFramingEncodings(message);
                    // Watch: nothing the viewer types, moves, pastes or resizes is sent on (keys 4 and 255, pointer 5, clipboard 6, size 251)
                    // A kept message is a copy of its own size: a view would hold the whole chunk it came out of in memory until it was sent
                    if (mode === 'input' || (type !== 4 && type !== 5 && type !== 6 && type !== 251 && type !== 255)) forward.push(Buffer.from(message));
                }
            }
            // The same for what waits for the rest of its message: only those bytes are kept, never the large chunk they arrived in
            buffer = Buffer.from(buffer);
            return { forward, close: false };
        },
    };
}

/**
 * Where the machine's screen socket is, from Agent37's link for its screen port. UNPROVEN until the first real machine: the link is
 * taken to serve the web screen's socket at /websockify with the same query (which carries its token), as the screen's own page does.
 */
export function upstreamSocketUrl(link: string): string | null {
    try {
        const url = new URL(link);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/websockify';
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

// ---------- The gateway ----------

export const SCREEN_PATH = '/computer/screen';
/**
 * How long an input socket may stay open after the last "yes" was ASKED FOR (not when it came back: Orbit grants its lease when it
 * handles the ask). Shorter than Orbit's input lease (8 s after a check, 10 s after an open, in Orbit's lib/computer-control.ts), so a
 * hand back that waits out that lease finds every input socket already closed here.
 */
export const INPUT_YES_MS = 7000;
/** Held back on the way from the machine when the viewer is slower than it: past this the socket is closed instead of piling up. */
const BACKLOG_MAX = 16 * 1024 * 1024;
/** The most a viewer may have waiting to be sent to the machine (before it is open, or while it takes it in): what the viewer sends is small. */
const INPUT_BACKLOG_MAX = 2 * 1024 * 1024;

export interface ScreenGatewayOptions {
    orbit: ScreenOrbit;
    /** For tests: how the machine's socket is opened. */
    connect?: (url: string) => WebSocket;
    /** For tests: how long an input socket stays open after the last "yes" was asked for. */
    inputYesMs?: number;
    log?: Pick<Console, 'warn' | 'error'>;
}

export interface ScreenGateway {
    /** Hand every `upgrade` of the bot server's HTTP server to this: it takes the ones for the screen and leaves the rest. Returns whether it took it. */
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
    /** Closes every socket (the server is stopping). */
    close(): void;
    open(): number;
}

export function createScreenGateway(options: ScreenGatewayOptions): ScreenGateway {
    const log = options.log ?? console;
    const connect = options.connect ?? ((url: string) => new WebSocket(url, 'binary', { handshakeTimeout: 15_000, maxPayload: 32 * 1024 * 1024 }));
    const inputYesMs = options.inputYesMs ?? INPUT_YES_MS;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false) });
    const sockets = new Set<WebSocket>();

    const refuse = (socket: Duplex, status: number, text: string) => {
        socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        socket.destroy();
    };

    const carry = (viewer: WebSocket, ticket: string, opened: Extract<Awaited<ReturnType<ScreenOrbit['open']>>, { ok: true }>, askedAt: number) => {
        const upstreamUrl = upstreamSocketUrl(opened.upstream);
        if (!upstreamUrl) {
            viewer.close(1011, 'The screen is not available');
            // Nothing below is attached to it, so nothing else would take it out of the count
            sockets.delete(viewer);
            return;
        }
        const machine = connect(upstreamUrl);
        const filter = createInputFilter(opened.mode);
        let over = false;
        let timer: ReturnType<typeof setInterval> | null = null;
        let limit: ReturnType<typeof setTimeout> | null = null;
        let yesDeadline: ReturnType<typeof setTimeout> | null = null;
        let checking = false;
        const end = (code: number, why: string) => {
            if (over) return;
            over = true;
            if (timer) clearInterval(timer);
            if (limit) clearTimeout(limit);
            if (yesDeadline) clearTimeout(yesDeadline);
            for (const socket of [viewer, machine]) {
                try {
                    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(code, why);
                    // A socket that does not close in a moment is cut
                    setTimeout(() => socket.terminate(), 2000).unref();
                } catch {
                    /* already gone */
                }
            }
            sockets.delete(viewer);
        };

        // The viewer may not send before the machine is open: what it sends first waits, in order
        const waiting: Buffer[] = [];
        let waitingBytes = 0;
        machine.on('open', () => {
            waitingBytes = 0;
            for (const bytes of waiting.splice(0)) machine.send(bytes);
        });
        viewer.on('message', (data: RawData) => {
            if (over) return;
            const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
            const result = filter.push(bytes);
            for (const part of result.forward) {
                if (machine.readyState === WebSocket.OPEN) {
                    if (machine.bufferedAmount + part.length > INPUT_BACKLOG_MAX) return end(1013, 'Too much at once');
                    machine.send(part);
                } else {
                    waitingBytes += part.length;
                    if (waitingBytes > INPUT_BACKLOG_MAX) return end(1013, 'Too much at once');
                    waiting.push(part);
                }
            }
            if (result.close) end(1008, 'Not allowed');
        });
        machine.on('message', (data: RawData) => {
            if (over || viewer.readyState !== WebSocket.OPEN) return;
            if (viewer.bufferedAmount > BACKLOG_MAX) {
                end(1013, 'Too slow');
                return;
            }
            viewer.send(data, { binary: true });
        });
        viewer.on('close', () => end(1000, 'Closed'));
        machine.on('close', () => end(1000, 'The computer closed the screen'));
        viewer.on('error', () => end(1011, 'Error'));
        machine.on('error', () => end(1011, 'The screen could not be reached'));

        // An input socket's own deadline, counted from when the last yes was asked for and moved only by a yes. It does not wait for Orbit:
        // a check that never comes back leaves it running, and it closes the socket.
        const grantedAt = (askedFor: number) => {
            if (opened.mode !== 'input' || over) return;
            if (yesDeadline) clearTimeout(yesDeadline);
            yesDeadline = setTimeout(() => end(1011, 'The screen was not confirmed in time'), Math.max(0, askedFor + inputYesMs - Date.now()));
        };
        grantedAt(askedAt);

        // Orbit is asked every few seconds; no answer from it is a no (a screen is never left open on a state nobody can vouch for).
        // An input socket is asked often enough to be confirmed before its own deadline, whatever interval Orbit names: 60% of the deadline
        // leaves the rest (2.8 s of 7) for the round trip of a check.
        const everyMs = Math.max(1000, opened.mode === 'input' ? Math.min(opened.checkEveryMs, Math.round(inputYesMs * 0.6)) : opened.checkEveryMs);
        const ask = () => {
            if (checking || over) return;
            checking = true;
            const asked = Date.now();
            options.orbit
                .check(ticket)
                .then((answer) => {
                    // The mode a ticket was opened in never goes up: a viewer opened for watching stays watching
                    if (!answer.ok || (opened.mode === 'input' && answer.mode !== 'input')) end(1008, 'The screen is closed');
                    else grantedAt(asked);
                })
                .catch(() => end(1011, 'The screen could not be checked'))
                .finally(() => (checking = false));
        };
        // The first ask of an input socket counts from when the open was asked for, not from when Orbit answered it: an open that took
        // a few seconds must still be confirmed before the deadline that began with it.
        timer = setTimeout(
            () => {
                ask();
                timer = setInterval(ask, everyMs);
            },
            opened.mode === 'input' ? Math.max(0, askedAt + everyMs - Date.now()) : everyMs,
        );
        limit = setTimeout(() => end(1000, 'The screen was open too long'), Math.max(1000, opened.maxMs));
    };

    return {
        handleUpgrade(request, socket, head) {
            let url: URL;
            try {
                url = new URL(request.url ?? '/', 'http://screen.invalid');
            } catch {
                // An address that cannot be read is nobody's screen
                return false;
            }
            if (url.pathname !== SCREEN_PATH) return false;
            const ticket = url.searchParams.get('ticket') ?? '';
            if (!ticket || ticket.length > 1000) {
                refuse(socket, 400, 'Bad Request');
                return true;
            }
            // While Orbit is asked, nobody listens for this socket's errors (Node drops its own on 'upgrade', and ws adds its own only once it takes
            // the socket): a reset in that gap would be an unhandled error and bring the bot server down
            const ignore = () => undefined;
            socket.on('error', ignore);
            // Orbit's lease for this ticket starts when it handles the ask, so the input deadline counts from here, not from the answer
            const askedAt = Date.now();
            options.orbit
                .open(ticket)
                .then((opened) => {
                    if (!opened.ok) {
                        const resting = 'reason' in opened && opened.reason === 'resting';
                        refuse(socket, resting ? 409 : 403, resting ? 'Conflict' : 'Forbidden');
                        return;
                    }
                    wss.handleUpgrade(request, socket, head, (viewer) => {
                        socket.off('error', ignore);
                        sockets.add(viewer);
                        carry(viewer, ticket, opened, askedAt);
                    });
                })
                .catch((error: unknown) => {
                    log.warn('[ComputerScreen] Could not open a screen:', error instanceof Error ? error.message : 'unknown');
                    refuse(socket, 503, 'Service Unavailable');
                });
            return true;
        },
        close() {
            for (const socket of sockets) socket.close(1001, 'Going away');
            sockets.clear();
        },
        open: () => sockets.size,
    };
}
