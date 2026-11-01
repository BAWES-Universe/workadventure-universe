// What the rest of the worker needs from a way of carrying audio. Peer-to-peer connections (lane.ts) implement it today;
// a LiveKit participant would implement the same two sides, with one output target for the whole room.
import type { Mode } from './protocol.ts';

/** A frame of permitted microphone audio from one person, 16 kHz mono. Recognition plugs in here. */
export interface InputFrame {
    participantId: string;
    epoch: number;
    pcm16k: Int16Array;
    /** Milliseconds of audio known to be missing just before this frame (network loss). */
    droppedMs: number;
}
export type InputSink = (frame: InputFrame) => void;

/** One listener of the bot's audio. */
export interface OutputTarget {
    readonly participantId: string;
    readonly epoch: number;
    /** True only while this is the one current path for the person and its mode plays audio. */
    plays(): boolean;
    /** Sends one 20 ms Opus packet. */
    sendOpus(payload: Buffer): void;
}

export interface ModeHolder {
    mode: Mode;
}
