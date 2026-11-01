/**
 * The bot server's side of the voice bridge (voice-worker/PROTOCOL.md, voice-worker/schema.json).
 * The worker keeps the authoritative copy; voice-worker/test checks this file's messages against the schema.
 */

export type VoiceMode = 'off' | 'listen_only' | 'talk' | 'type_and_listen' | 'speak_and_read';
export type LeaveReason = 'closed' | 'failed' | 'left' | 'superseded' | 'timeout';

/** What a person's browser sends while setting up a call (simple-peer signals). */
export type VoiceSignal =
    | { type: 'offer' | 'answer'; sdp: string }
    | { type: 'candidate'; candidate: { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null } };

export type ToWorker =
    | { type: 'session.open'; sessionId: string; bubbleId: string; botId: string }
    | { type: 'lane.open'; sessionId: string; participantId: string; epoch: number; mode?: VoiceMode }
    | { type: 'lane.signal'; sessionId: string; participantId: string; epoch: number; signal: VoiceSignal }
    | { type: 'lane.close'; sessionId: string; participantId: string; epoch: number; reason?: LeaveReason }
    | { type: 'mode.set'; sessionId: string; mode: VoiceMode; participantId?: string }
    | { type: 'bot.say'; sessionId: string; segmentId: string; text: string; committed: true; lang?: string }
    | { type: 'bot.retract'; sessionId: string; segmentId: string }
    | { type: 'voice.stop'; sessionId: string; reason: 'allowance_ended' | 'other' }
    | { type: 'session.end'; sessionId: string };

export type FromWorker =
    | { type: 'session.start'; sessionId: string; bubbleId: string; mode: VoiceMode }
    | { type: 'participant.join'; sessionId: string; participantId: string; epoch: number }
    | { type: 'participant.leave'; sessionId: string; participantId: string; epoch: number; reason: LeaveReason }
    | { type: 'lane.signal'; sessionId: string; participantId: string; epoch: number; signal: VoiceSignal }
    | { type: 'playback.progress'; sessionId: string; segmentId: string; playedMs: number; totalMs?: number; finished: boolean; interrupted: boolean; reason?: string }
    | { type: 'engine.status'; sessionId: string; engineId: string; voice: 'active' | 'stopped'; mode: VoiceMode; lanes: unknown[]; counters?: Record<string, number> }
    | { type: 'error'; sessionId: string; code: string; message: string; participantId?: string; epoch?: number };
