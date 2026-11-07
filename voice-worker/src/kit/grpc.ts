// gRPC over HTTP/2 with Node's own http2, for companies that only speak gRPC (NVIDIA Riva, #1899). No library and no .proto
// files: the few messages a connector needs are written and read field by field with the small protobuf helpers below.
//
// A call is one HTTP/2 POST to /package.Service/Method with content-type application/grpc. Each message, both ways, is one byte
// (0: not compressed), its length as four big-endian bytes, then the protobuf bytes. The call's outcome comes in the trailers:
// grpc-status 0 is success, anything else a failure with grpc-message saying why.
import { EventEmitter } from 'node:events';
import http2 from 'node:http2';

// ---------------------------------------------------------------------------------------------------------------------
// Protobuf, the parts a connector needs
// ---------------------------------------------------------------------------------------------------------------------

function varint(value: number): Buffer {
    const bytes: number[] = [];
    let v = Math.max(0, Math.floor(value));
    while (v > 0x7f) {
        bytes.push((v % 0x80) | 0x80);
        v = Math.floor(v / 0x80);
    }
    bytes.push(v);
    return Buffer.from(bytes);
}

const tag = (field: number, wire: number) => varint(field * 8 + wire);

/** One field of a protobuf message, ready to join with others. */
export const pb = {
    /** A whole number, enum or bool (wire type 0). Zero is the default and is left out, as protobuf does. */
    uint: (field: number, value: number | boolean): Buffer => {
        const n = typeof value === 'boolean' ? (value ? 1 : 0) : value;
        return n ? Buffer.concat([tag(field, 0), varint(n)]) : Buffer.alloc(0);
    },
    /** Bytes, text, or a message inside a message (wire type 2). Empty text is left out. */
    bytes: (field: number, value: Uint8Array | string): Buffer => {
        const body = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        if (typeof value === 'string' && body.length === 0) return Buffer.alloc(0);
        return Buffer.concat([tag(field, 2), varint(body.length), body]);
    },
    message: (field: number, ...parts: Buffer[]): Buffer => pb.bytes(field, Buffer.concat(parts)),
};

/** A message read into its fields: each field number with every value it had, numbers for wire type 0 and bytes otherwise. */
export type PbFields = Map<number, (number | Buffer)[]>;

/** Reads a protobuf message. Throws on bytes that aren't one. */
export function pbRead(buf: Buffer): PbFields {
    const fields: PbFields = new Map();
    let at = 0;
    const readVarint = (): number => {
        let result = 0;
        let scale = 1;
        for (let i = 0; i < 10; i++) {
            if (at >= buf.length) throw new Error('protobuf: cut short');
            const byte = buf[at++];
            result += (byte & 0x7f) * scale;
            if (!(byte & 0x80)) return result;
            scale *= 0x80;
        }
        throw new Error('protobuf: varint too long');
    };
    while (at < buf.length) {
        const key = readVarint();
        const field = Math.floor(key / 8);
        const wire = key % 8;
        let value: number | Buffer;
        if (wire === 0) value = readVarint();
        else if (wire === 2) {
            const length = readVarint();
            if (at + length > buf.length) throw new Error('protobuf: cut short');
            value = buf.subarray(at, at + length);
            at += length;
        } else if (wire === 1 || wire === 5) {
            const length = wire === 1 ? 8 : 4;
            if (at + length > buf.length) throw new Error('protobuf: cut short');
            value = buf.subarray(at, at + length);
            at += length;
        } else throw new Error('protobuf: unknown wire type');
        const list = fields.get(field) ?? [];
        list.push(value);
        fields.set(field, list);
    }
    return fields;
}

/** Every value of a field that holds bytes (text or messages). */
export const pbBytes = (fields: PbFields, field: number): Buffer[] => (fields.get(field) ?? []).filter((v): v is Buffer => Buffer.isBuffer(v));
/** The last value of a whole-number field, or 0 (protobuf's default). */
export const pbUint = (fields: PbFields, field: number): number => {
    const values = (fields.get(field) ?? []).filter((v): v is number => typeof v === 'number');
    return values.length ? values[values.length - 1] : 0;
};

// ---------------------------------------------------------------------------------------------------------------------
// gRPC framing and calls
// ---------------------------------------------------------------------------------------------------------------------

/** One gRPC message on the wire: not compressed, its length, then the protobuf bytes. */
export function grpcFrame(message: Uint8Array): Buffer {
    const head = Buffer.alloc(5);
    head.writeUInt32BE(message.byteLength, 1);
    return Buffer.concat([head, Buffer.from(message.buffer, message.byteOffset, message.byteLength)]);
}

/** Splits the bytes of a call's answer into its messages, however HTTP/2 cut them. */
export class GrpcFrames {
    private held = Buffer.alloc(0);
    /** The largest message read: past this the answer is not gRPC, or not one a connector wants. */
    static readonly MAX_MESSAGE = 16 * 1024 * 1024;

    take(chunk: Buffer): Buffer[] {
        this.held = this.held.length ? Buffer.concat([this.held, chunk]) : chunk;
        const out: Buffer[] = [];
        while (this.held.length >= 5) {
            if (this.held[0] !== 0) throw new Error('grpc: compressed message');
            const length = this.held.readUInt32BE(1);
            if (length > GrpcFrames.MAX_MESSAGE) throw new Error('grpc: message too large');
            if (this.held.length < 5 + length) break;
            out.push(this.held.subarray(5, 5 + length));
            this.held = this.held.subarray(5 + length);
        }
        return out;
    }
}

/** The HTTP status a gRPC status reads as, the way gRPC's own docs map them. */
export function grpcHttpStatus(grpcStatus: number): number | undefined {
    const map: Record<number, number> = {
        3: 400, // INVALID_ARGUMENT
        5: 404, // NOT_FOUND
        7: 403, // PERMISSION_DENIED
        8: 429, // RESOURCE_EXHAUSTED
        9: 400, // FAILED_PRECONDITION
        11: 400, // OUT_OF_RANGE
        12: 501, // UNIMPLEMENTED
        13: 500, // INTERNAL
        14: 503, // UNAVAILABLE
        16: 401, // UNAUTHENTICATED
    };
    return map[grpcStatus];
}

export interface GrpcAddress {
    /** The server, `https://host[:port]` (or `http://` for a server on loopback in tests). */
    origin: string;
    /** `/package.Service/Method`. */
    path: string;
    /** Sent with the call: the key as a bearer, NVIDIA's function-id. */
    headers?: Record<string, string>;
}

/** How a call ended: `ok`, or the HTTP status the failure reads as (undefined when it says nothing that maps). */
export type GrpcEnd = { ok: true } | { ok: false; status?: number };

/**
 * One gRPC call with messages going both ways. `onMessage` gets each message the server sends; `onEnd` is called once,
 * with how the call ended (including a call refused at the HTTP level, or a connection that broke).
 */
export class GrpcCall {
    private readonly session: http2.ClientHttp2Session;
    private readonly stream: http2.ClientHttp2Stream;
    private ended = false;
    private grpcStatus?: number;
    private httpStatus?: number;

    constructor(address: GrpcAddress, onMessage: (message: Buffer) => void, onEnd: (end: GrpcEnd) => void) {
        const frames = new GrpcFrames();
        const end = (result: GrpcEnd) => {
            if (this.ended) return;
            this.ended = true;
            this.close();
            onEnd(result);
        };
        this.session = http2.connect(address.origin);
        this.session.on('error', () => end({ ok: false }));
        this.stream = this.session.request({
            ':method': 'POST',
            ':path': address.path,
            'content-type': 'application/grpc',
            te: 'trailers',
            ...(address.headers ?? {}),
        });
        this.stream.on('response', (headers) => {
            this.httpStatus = Number(headers[':status']);
            // A refusal can come as headers only, with the status in them ("trailers-only")
            const status = headers['grpc-status'];
            if (status !== undefined) this.grpcStatus = Number(status);
        });
        this.stream.on('data', (chunk: Buffer) => {
            if (this.ended) return;
            let messages: Buffer[];
            try {
                messages = frames.take(chunk);
            } catch {
                return end({ ok: false });
            }
            for (const message of messages) {
                if (this.ended) return;
                // A message the reader can't make sense of ends the call; thrown out of this listener it would end the worker
                try {
                    onMessage(message);
                } catch {
                    return end({ ok: false });
                }
            }
        });
        this.stream.on('trailers', (trailers) => {
            const status = trailers['grpc-status'];
            if (status !== undefined) this.grpcStatus = Number(status);
        });
        this.stream.on('error', () => end({ ok: false }));
        // The server's side ending is the end of the call, whether or not this side is still open (a refusal comes before any
        // audio is done), and the stream closing without it is a call that broke
        const settle = () => {
            if (this.httpStatus !== undefined && this.httpStatus !== 200) return end({ ok: false, status: this.httpStatus });
            if (this.grpcStatus === 0) return end({ ok: true });
            end({ ok: false, status: this.grpcStatus === undefined ? undefined : grpcHttpStatus(this.grpcStatus) });
        };
        this.stream.on('end', settle);
        this.stream.on('close', settle);
    }

    send(message: Uint8Array): void {
        if (!this.ended && !this.stream.writableEnded) this.stream.write(grpcFrame(message));
    }

    /** No more messages from this side; the server sends what it still has, then ends the call. */
    finish(): void {
        if (!this.ended && !this.stream.writableEnded) this.stream.end();
    }

    close(): void {
        if (!this.stream.closed) this.stream.close(http2.constants.NGHTTP2_CANCEL);
        if (!this.session.closed) this.session.close();
    }
}

/**
 * A gRPC call dressed as the WebSocket the hearing kit drives (src/kit/socketHearing.ts `transport`): `send` writes a message,
 * sending the empty string ends this side, and the call's end is a `close` whose code says how it went (see `grpcCloseStatus`).
 * Each server message arrives as a binary `message`.
 */
export class GrpcSocket extends EventEmitter {
    readyState = 0;
    private readonly call: GrpcCall;

    constructor(address: GrpcAddress) {
        super();
        this.call = new GrpcCall(
            address,
            (message) => this.emit('message', message, true),
            (end) => {
                this.readyState = 3;
                this.emit('close', end.ok ? 1000 : 4000 + (end.status ?? 0), Buffer.alloc(0));
            },
        );
        // Messages can go out at once: the call is open as soon as it's asked for
        queueMicrotask(() => {
            if (this.readyState !== 0) return;
            this.readyState = 1;
            this.emit('open');
        });
    }

    send(data: string | Uint8Array): void {
        if (typeof data === 'string') {
            if (data === '') this.call.finish();
            return;
        }
        this.call.send(data);
    }

    terminate(): void {
        this.readyState = 3;
        this.call.close();
    }
}

/** The HTTP status a GrpcSocket close code carries (4000 + status), or undefined for a normal end or one that says nothing. */
export function grpcCloseStatus(code: number): number | undefined {
    return code > 4000 && code < 5000 ? code - 4000 : undefined;
}
