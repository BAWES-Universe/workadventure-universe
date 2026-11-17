/**
 * The bot server's side of the voice bridge (voice-worker/PROTOCOL.md, voice-worker/schema.json).
 * The worker keeps the authoritative copy; voice-worker/test checks this file's messages against the schema.
 */

export type VoiceMode = 'off' | 'listen_only' | 'talk' | 'type_and_listen' | 'speak_and_read';
/** Where one person's audio with the bot stands, as the bot tells them (the game draws its Voice button from it). */
export type VoiceStatus = 'connecting' | 'on' | 'paused';
/**
 * Whether the bot takes a person's microphone in a group, as the bot tells them (the game draws the bar and the panel from it). In a group
 * (two or more people in the bubble or meeting) a person's talk reaches the bot only once they asked it to keep listening, for this visit.
 *   '': nothing to choose: they are alone with the bot (it hears them hands-free), or their mode does not take the microphone.
 *   off: it does not take their microphone. pending: they asked it to keep listening and the worker has not confirmed it yet.
 *   on: it does, confirmed. stopping: they asked it to stop, not confirmed yet. checking: the stop is not confirmed after the wait,
 *   so it may still hear them.
 */
export type ListenState = '' | 'off' | 'pending' | 'on' | 'stopping' | 'checking';
/**
 * Why it is off, when there is something to say. others_joined: they had it hands-free until someone joined. failed: asking to keep
 * listening was not confirmed in time. limit: the bot's daily listening, or the person's spoken replies, are used for now.
 */
export type ListenReason = '' | 'others_joined' | 'failed' | 'limit';
export interface ListenInfo { state: ListenState; reason: ListenReason }
export type LeaveReason = 'closed' | 'failed' | 'left' | 'superseded' | 'timeout';

/** What a person's browser sends while setting up a call (simple-peer signals). */
export type VoiceSignal =
    | { type: 'offer' | 'answer'; sdp: string }
    | { type: 'candidate'; candidate: { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null } }
    /** Only from the worker to the person: the offer had no audio, so the person is asked to add one and offer again. */
    | { type: 'transceiverRequest'; transceiverRequest: { kind: 'audio'; init?: { direction: 'recvonly' | 'sendrecv' } } };

/** How much feeling the voice puts in. */
export type VoiceExpression = 'restrained' | 'natural' | 'expressive';
/** Which of the two jobs a provider does. */
export type ProviderPart = 'recognition' | 'speech';
/** The provider a bubble hears with, named by the adapter name Orbit stores (lowercase). The key is used for the provider call only. */
export interface RecognitionConfig {
    adapter: string; model: string; key?: string; endpoint?: string; region?: string; language?: string;
    /** Names the hearing should expect and spell as written: this bot's own name, then the other voice bots' (#1864). */
    terms?: string[];
}
/** The provider a bubble speaks with. */
export interface SpeechConfig { adapter: string; model: string; voiceId: string; key?: string; endpoint?: string; region?: string; language?: string }

/**
 * Named by a worker in `session.start` when `bot.say` may carry `onlyFor`: the one person a reply is for, whose audio then
 * reaches nobody else (game #1993). A worker from before ignores the field and speaks to everyone in the bubble, so the
 * bot server sends it only to a worker that named this.
 */
export const SAY_ONLY_FOR = 'say.onlyFor';

export type ToWorker =
    | { type: 'session.open'; sessionId: string; bubbleId: string; botId: string; recognition?: RecognitionConfig; speech?: SpeechConfig; expression?: VoiceExpression; turnSeconds?: number }
    | { type: 'lane.open'; sessionId: string; participantId: string; epoch: number; mode?: VoiceMode }
    | { type: 'lane.signal'; sessionId: string; participantId: string; epoch: number; signal: VoiceSignal }
    | { type: 'lane.close'; sessionId: string; participantId: string; epoch: number; reason?: LeaveReason }
    /** `requestId`: the worker answers with `mode.ack` once the person's audio path follows the mode (only with `participantId`). */
    | { type: 'mode.set'; sessionId: string; mode: VoiceMode; participantId?: string; requestId?: string }
    /** `onlyFor`: the one person this reply is for (their participant id); see `SAY_ONLY_FOR`. */
    | { type: 'bot.say'; sessionId: string; segmentId: string; text: string; committed: true; lang?: string; maxMs?: number; onlyFor?: string }
    | { type: 'bot.retract'; sessionId: string; segmentId: string }
    | { type: 'voice.stop'; sessionId: string; reason: 'allowance_ended' | 'other' }
    | { type: 'session.end'; sessionId: string }
    | { type: 'room.join'; sessionId: string; epoch: number; serverUrl: string; token: string }
    | { type: 'room.leave'; sessionId: string; epoch: number }
    | { type: 'room.people'; sessionId: string; epoch: number; people: { participantId: string; mode: VoiceMode }[] }
    /** Another voice bot came or went: the names the hearing should expect from the next stretch of speech, replacing the earlier list. */
    | { type: 'recognition.terms'; sessionId: string; terms: string[] };

/** Why a stretch of speech was not sent: the words that did come through are only offered back to the person. */
export type LostReason = 'cap' | 'gap' | 'path' | 'stopped' | 'provider';

/** What the bot tells one person about what it is hearing them say, to be drawn above their message box. */
export interface VoiceDraft {
    turnId: string;
    /** `final`: every word came through, so the person's own game sends it as their line. `lost`: only offered back. */
    state: 'live' | 'final' | 'lost' | 'cleared';
    text: string;
    reason?: LostReason;
}

export type FromWorker =
    /** `features`: what the worker can do beyond the first version of the bridge (`SAY_ONLY_FOR`). Left out by an older worker. */
    | { type: 'session.start'; sessionId: string; bubbleId: string; mode: VoiceMode; features?: string[] }
    | { type: 'participant.join'; sessionId: string; participantId: string; epoch: number }
    | { type: 'participant.leave'; sessionId: string; participantId: string; epoch: number; reason: LeaveReason }
    | { type: 'lane.signal'; sessionId: string; participantId: string; epoch: number; signal: VoiceSignal }
    /** `reason` `private`: the reply was for one person alone and the path it would go out on reaches other people too, so it was not said (or stopped). */
    | { type: 'playback.progress'; sessionId: string; segmentId: string; playedMs: number; totalMs?: number; finished: boolean; interrupted: boolean; reason?: string }
    | { type: 'engine.status'; sessionId: string; engineId: string; voice: 'active' | 'stopped'; mode: VoiceMode; lanes: unknown[]; room?: { epoch: number; connected: boolean }; counters?: Record<string, number> }
    /** A `mode.set` with a `requestId` is applied: the path that carries the person's audio now (their connection, the room, or none yet) and its epoch. */
    | { type: 'mode.ack'; sessionId: string; participantId: string; requestId: string; mode: VoiceMode; path: 'lane' | 'room' | 'none'; epoch?: number }
    | { type: 'room.state'; sessionId: string; epoch: number; state: 'connected' | 'closed' | 'failed' }
    | { type: 'user.speech_started'; sessionId: string; participantId: string; epoch: number; turnId: string }
    | { type: 'user.partial'; sessionId: string; participantId: string; epoch: number; turnId: string; text: string }
    | { type: 'user.turn'; sessionId: string; participantId: string; epoch: number; turnId: string; outcome: 'final' | 'lost' | 'cleared'; text?: string; reason?: LostReason; audioMs: number }
    /** A provider call worked (speech: once per spoken reply). */
    | { type: 'provider.ok'; sessionId: string; part: ProviderPart; adapter: string }
    /** A provider call failed. `status`: its HTTP status when it had one. `rejected`: it refused the key itself (401 or 403). */
    | { type: 'provider.failed'; sessionId: string; part: ProviderPart; adapter: string; status?: number; rejected?: true }
    | { type: 'error'; sessionId: string; code: string; message: string; participantId?: string; epoch?: number };
