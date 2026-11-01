// Types for the voice bridge between the bot server and this worker. The contract is schema.json (and PROTOCOL.md);
// this file mirrors it for TypeScript. bots/voice/protocol.ts holds the bot server's copy: the integration test
// checks both against the schema.

export type Mode = 'off' | 'listen_only' | 'talk' | 'type_and_listen' | 'speak_and_read';
export const MODES: readonly Mode[] = ['off', 'listen_only', 'talk', 'type_and_listen', 'speak_and_read'];
/** Whether the worker takes this person's microphone audio in. */
export const modeListens = (m: Mode): boolean => m === 'talk' || m === 'speak_and_read';
/** Whether the worker plays the bot's audio to this person. */
export const modePlays = (m: Mode): boolean => m === 'talk' || m === 'listen_only' || m === 'type_and_listen';

/** What a person's browser sends while setting up the call (simple-peer signals). */
export type Signal =
    | { type: 'offer' | 'answer'; sdp: string }
    | { type: 'candidate'; candidate: { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null } }
    /** Only from the worker to the person: the offer had no audio, so asks the person to add one and offer again. */
    | { type: 'transceiverRequest'; transceiverRequest: { kind: 'audio'; init?: { direction: 'recvonly' | 'sendrecv' } } };

export type LeaveReason = 'closed' | 'failed' | 'left' | 'superseded' | 'timeout';
export type PlaybackReason = 'completed' | 'voice_stop' | 'retract' | 'mode' | 'lane_loss' | 'rejected';

interface Base {
    sessionId: string;
    ts?: number;
}

// bot server -> worker
export interface SessionOpen extends Base { type: 'session.open'; bubbleId: string; botId: string }
export interface LaneOpen extends Base { type: 'lane.open'; participantId: string; epoch: number; mode?: Mode }
export interface LaneSignalIn extends Base { type: 'lane.signal'; participantId: string; epoch: number; signal: Signal }
export interface LaneClose extends Base { type: 'lane.close'; participantId: string; epoch: number; reason?: LeaveReason }
export interface ModeSet extends Base { type: 'mode.set'; mode: Mode; participantId?: string }
export interface BotSay extends Base { type: 'bot.say'; segmentId: string; text: string; committed: true; lang?: string }
export interface BotRetract extends Base { type: 'bot.retract'; segmentId: string }
export interface VoiceStop extends Base { type: 'voice.stop'; reason: 'allowance_ended' | 'other' }
export interface SessionEnd extends Base { type: 'session.end' }
/** The bubble moved to LiveKit: join its room with the bot's own scoped token. */
export interface RoomJoin extends Base { type: 'room.join'; epoch: number; serverUrl: string; token: string }
export interface RoomLeave extends Base { type: 'room.leave'; epoch: number }
/** The people in the bubble whose microphone the bot may subscribe to, and how each is handled. Replaces the earlier list. */
export interface RoomPeople extends Base { type: 'room.people'; epoch: number; people: { participantId: string; mode: Mode }[] }

// worker -> bot server
export interface SessionStart extends Base { type: 'session.start'; bubbleId: string; mode: Mode; engine: { id: string; kind: 'ts' } }
export interface ParticipantJoin extends Base { type: 'participant.join'; participantId: string; epoch: number }
export interface ParticipantLeave extends Base { type: 'participant.leave'; participantId: string; epoch: number; reason: LeaveReason }
export interface LaneSignalOut extends Base { type: 'lane.signal'; participantId: string; epoch: number; signal: Signal }
export interface PlaybackProgress extends Base {
    type: 'playback.progress'; segmentId: string; playedMs: number; totalMs?: number; finished: boolean; interrupted: boolean; reason?: PlaybackReason;
}
export interface EngineStatus extends Base {
    type: 'engine.status'; engineId: string; voice: 'active' | 'stopped'; mode: Mode;
    lanes: { participantId: string; epoch: number; healthy: boolean; mode: Mode }[];
    /** Present while the bot is in the bubble's LiveKit room. */
    room?: { epoch: number; connected: boolean };
    counters?: Record<string, number>;
}
export interface RoomState extends Base { type: 'room.state'; epoch: number; state: 'connected' | 'closed' | 'failed' }
export interface ErrorMsg extends Base { type: 'error'; code: string; message: string; participantId?: string; epoch?: number }

export type BotToWorker = SessionOpen | LaneOpen | LaneSignalIn | LaneClose | ModeSet | BotSay | BotRetract | VoiceStop | SessionEnd | RoomJoin | RoomLeave | RoomPeople;
export type WorkerToBot = SessionStart | ParticipantJoin | ParticipantLeave | LaneSignalOut | PlaybackProgress | EngineStatus | RoomState | ErrorMsg;

