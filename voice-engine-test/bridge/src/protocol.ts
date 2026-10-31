// Types for the voice bridge v1. The authoritative contract is ../schema.json; this file mirrors it for TypeScript code.
export type Mode = 'off' | 'listen_only' | 'talk' | 'type_and_listen' | 'speak_and_read';
export const MODES: Mode[] = ['off', 'listen_only', 'talk', 'type_and_listen', 'speak_and_read'];
export const modeListens = (m: Mode) => m === 'talk' || m === 'speak_and_read';
export const modePlays = (m: Mode) => m === 'talk' || m === 'listen_only' || m === 'type_and_listen';

interface Base { sessionId: string; ts?: number }
export type EngineKind = 'pipecat' | 'ts';
export type TurnEnd = 'local' | 'provider';
export type EndReason = 'smart_turn' | 'provider_eot' | 'stop_secs_timeout' | 'mode_change' | 'voice_stop' | 'lane_closed';
export type PlaybackReason = 'completed' | 'barge_in' | 'voice_stop' | 'retract' | 'mode' | 'lane_loss' | 'rejected';

// engine -> brain
export interface SessionStart extends Base { type: 'session.start'; bubbleId: string; participants: { participantId: string; lane: number }[]; mode: Mode; engine: { id: string; kind: EngineKind; turnEnd: TurnEnd } }
export interface ParticipantJoin extends Base { type: 'participant.join'; participantId: string; lane: number; rejoin?: boolean }
export interface ParticipantLeave extends Base { type: 'participant.leave'; participantId: string; lane: number; reason: 'closed' | 'failed' | 'left' }
export interface UserSpeechStarted extends Base { type: 'user.speech_started'; lane: number; participantId: string; whileBotSpeaking: boolean; turnId?: string }
export interface UserTurn extends Base { type: 'user.turn'; lane: number; participantId: string; turnId: string; text: string; partial: boolean; droppedAudioMs: number; incomplete?: boolean; speechMs?: number; endReason?: EndReason; speechStartedAt?: number; turnEndedAt?: number }
export interface PlaybackProgress extends Base { type: 'playback.progress'; segmentId: string; playedMs: number; totalMs?: number; finished: boolean; interrupted: boolean; reason?: PlaybackReason }
export interface EngineStatus extends Base { type: 'engine.status'; engineId: string; voice: 'active' | 'stopped'; mode: Mode; lanes: { participantId: string; lane: number; healthy: boolean; mode: Mode }[]; counters?: Record<string, number> }
export interface ErrorMsg extends Base { type: 'error'; code: string; message: string }
// brain -> engine
export interface ModeSet extends Base { type: 'mode.set'; mode: Mode; participantId?: string }
export interface BotSay extends Base { type: 'bot.say'; segmentId: string; text: string; committed: true; lang?: string }
export interface BotRetract extends Base { type: 'bot.retract'; segmentId: string }
export interface VoiceStop extends Base { type: 'voice.stop'; reason: 'allowance_ended' | 'other' }
export interface SessionEnd extends Base { type: 'session.end' }
// chat path -> brain
export interface UserText extends Base { type: 'user.text'; participantId: string; text: string; messageId?: string }

export type EngineToBrain = SessionStart | ParticipantJoin | ParticipantLeave | UserSpeechStarted | UserTurn | PlaybackProgress | EngineStatus | ErrorMsg;
export type BrainToEngine = ModeSet | BotSay | BotRetract | VoiceStop | SessionEnd | ErrorMsg;
export type AnyMsg = EngineToBrain | BrainToEngine | UserText;

/** Audio maths used everywhere (rule 5 in PROTOCOL.md). */
export const frameBytes = (sampleRate: number, channels: number, bytesPerSample: number, ms: number) => Math.round((sampleRate * channels * bytesPerSample * ms) / 1000);
