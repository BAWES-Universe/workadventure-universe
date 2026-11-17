// AWS's event stream framing (Transcribe's socket, #1886): each message is its total length, its headers' length and a checksum
// of those, then the headers, the payload, and a checksum of everything before it. Headers here are only ever text (type 7).
// https://docs.aws.amazon.com/transcribe/latest/dg/streaming-setting-up.html

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

/** CRC-32 (the zip and PNG one), as the event stream checksums use. */
export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** One message with text headers and a payload. */
export function encodeEventMessage(headers: Record<string, string>, payload: Uint8Array): Buffer {
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(headers)) {
        const nameBytes = Buffer.from(name, 'utf8');
        const valueBytes = Buffer.from(value, 'utf8');
        const head = Buffer.alloc(1 + nameBytes.length + 1 + 2);
        head.writeUInt8(nameBytes.length, 0);
        nameBytes.copy(head, 1);
        head.writeUInt8(7, 1 + nameBytes.length);
        head.writeUInt16BE(valueBytes.length, 2 + nameBytes.length);
        parts.push(head, valueBytes);
    }
    const headerBytes = Buffer.concat(parts);
    const total = 12 + headerBytes.length + payload.byteLength + 4;
    const message = Buffer.alloc(total);
    message.writeUInt32BE(total, 0);
    message.writeUInt32BE(headerBytes.length, 4);
    message.writeUInt32BE(crc32(message.subarray(0, 8)), 8);
    headerBytes.copy(message, 12);
    Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(message, 12 + headerBytes.length);
    message.writeUInt32BE(crc32(message.subarray(0, total - 4)), total - 4);
    return message;
}

/** Reads one message: its headers (text ones; others are skipped) and payload. Throws on bytes that aren't one. */
export function decodeEventMessage(message: Buffer): { headers: Record<string, string>; payload: Buffer } {
    if (message.length < 16) throw new Error('event stream: cut short');
    const total = message.readUInt32BE(0);
    const headersLength = message.readUInt32BE(4);
    if (total !== message.length || 12 + headersLength + 4 > total) throw new Error('event stream: wrong length');
    if (message.readUInt32BE(8) !== crc32(message.subarray(0, 8))) throw new Error('event stream: prelude checksum');
    if (message.readUInt32BE(total - 4) !== crc32(message.subarray(0, total - 4))) throw new Error('event stream: message checksum');
    const headers: Record<string, string> = {};
    let at = 12;
    const end = 12 + headersLength;
    // The length in bytes of each fixed-size header value type: bool true/false, byte, short, int, long, (bytes), (string), timestamp, uuid
    const fixed: Record<number, number> = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16 };
    while (at < end) {
        const nameLength = message.readUInt8(at);
        const name = message.toString('utf8', at + 1, at + 1 + nameLength);
        const type = message.readUInt8(at + 1 + nameLength);
        at += 2 + nameLength;
        if (type === 6 || type === 7) {
            const length = message.readUInt16BE(at);
            if (type === 7) headers[name] = message.toString('utf8', at + 2, at + 2 + length);
            at += 2 + length;
        } else if (type in fixed) at += fixed[type];
        else throw new Error('event stream: unknown header type');
    }
    return { headers, payload: message.subarray(end, total - 4) };
}
