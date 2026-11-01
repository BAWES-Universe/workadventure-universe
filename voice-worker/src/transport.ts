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

/** One 20 ms frame of the bot's voice. Each transport takes the form it needs. */
export interface OutputFrame {
    /** 24 kHz mono. */
    pcm24k: Int16Array;
    /** The same frame as one Opus packet, encoded once however many listeners ask. */
    opus(): Buffer;
}

/** One path the bot's audio goes out on: a person's peer connection, or the bot's LiveKit participant for the whole room. */
export interface OutputTarget {
    readonly participantId: string;
    readonly epoch: number;
    /** True only while this is the one current path and its listeners' modes play audio. */
    plays(): boolean;
    sendFrame(frame: OutputFrame): void;
    /** Drops audio already handed over but not yet played (a stop must not leave a tail). */
    clear?(): void;
}

export interface ModeHolder {
    mode: Mode;
}
