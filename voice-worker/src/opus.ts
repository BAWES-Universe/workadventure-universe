// libopus (WASM build, with native builds where available) through @evan/opus. Mono, 48 kHz, 20 ms frames.
import { Decoder, Encoder } from '@evan/opus';
import { FRAME_MS } from './audioFormat.ts';

export const OPUS_RATE = 48000;
export const FRAME_SAMPLES_48K = (OPUS_RATE * FRAME_MS) / 1000;

export function newOpusEncoder(bitrate = 32000): Encoder {
    const encoder = new Encoder({ channels: 1, sample_rate: OPUS_RATE, application: 'voip' });
    encoder.bitrate = bitrate;
    return encoder;
}

export const newOpusDecoder = (): Decoder => new Decoder({ channels: 1, sample_rate: OPUS_RATE });

export const asInt16 = (u8: Uint8Array): Int16Array => new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1);
