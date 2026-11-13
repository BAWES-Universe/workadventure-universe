/**
 * What Orbit says about voice notes for every bot (Orbit /api/voice-notes/*, /api/bots/:id/voice/hearing): the shapes the bot server
 * reads and sends. See Orbit lib/voice-note-hearing.ts and lib/voice-note-turns.ts for what each one means.
 */

/** Which parts this Orbit has. Absent (an Orbit from before): hear only when the bot talks live, as before. */
export interface VoiceNoteCapabilities {
    v: number;
    hearing: boolean;
    reservations: boolean;
    turns: boolean;
    receipts: boolean;
    carry: boolean;
}

/** What a bot hears notes with now, apart from talking live. The key comes encrypted, for this server only. */
export interface NoteHearingAnswer {
    v: 1;
    route: 'owner-key' | 'universe-ai' | 'none';
    reason: string | null;
    payer: 'owner' | 'universe-ai' | null;
    provider: { id: string; adapter: string; name: string; endpoint: string | null; region: string | null; apiKeyEncrypted: string } | null;
    model: string | null;
    language: string | null;
}

export type TurnState = 'reserved' | 'hearing' | 'heard' | 'answering' | 'answered' | 'delivered' | 'failed' | 'uncertain';

export interface TurnView {
    id: string;
    state: TurnState;
    payer: 'owner' | 'universe-ai';
    seconds: number;
}

export interface ReserveInput {
    scope: 'bot' | 'guest-brick';
    botId?: string;
    roomUrl?: string;
    userId: string;
    isGuest?: boolean;
    clientTurnId: string;
    contentHash: string;
    seconds: number;
    adapters: string[];
    source?: 'universe-ai' | 'provider' | 'own-key';
}

export type Reservation =
    | { ok: true; turn: TurnView; replay: boolean; answer?: { transcript: string; answer?: string } }
    | { ok: false; reason: 'reply-limit'; allowance: { allowed: false; limit: string; resetsAt: string; who: string } }
    | { ok: false; reason: 'note-minutes'; limit: 'person' | 'universe' | 'bot'; resetsAt: string }
    | { ok: false; reason: 'too-long'; longestSeconds: number }
    | { ok: false; reason: 'busy' | 'no-hearing' | 'expired' };

export type Lease =
    | { granted: true; generation: number; leaseUntil: string; hearing?: NoteHearingAnswer; reconcile?: Record<string, unknown>; transcript?: string }
    | { granted: false; reason: string };

export type TurnEvent =
    | { event: 'submitted'; generation: number; refs: Record<string, string> }
    | { event: 'heard'; generation: number; transcript: string; seconds?: number; costMicros?: number }
    | { event: 'hearing-failed'; generation: number; charged: 'no' | 'yes' | 'unknown' }
    | { event: 'answered'; generation: number; answer: string }
    | { event: 'answer-failed'; generation: number }
    | { event: 'delivered' };

export interface CleanupJob {
    id: string;
    kind: 'file' | 'transcription';
    objectId: string;
    /** Sent back when settling: Orbit only takes the answer of the server holding the job now (409 for a late one). */
    lease: string;
    provider: { id: string; adapter: string; endpoint: string | null; region: string | null; apiKeyEncrypted: string };
}

/** What a provider answered a delete with (or `failed` for no answer), with the job's `lease`. */
export type CleanupOutcome = ({ status: number } | { failed: true }) & { lease: string };

/** The Orbit calls voice notes make (AdminApiService is the real one; tests give a fake). */
export interface VoiceNoteOrbit {
    /** Null when this Orbit has no bundle (an Orbit from before). Throws when Orbit can't be asked. */
    voiceNoteCapabilities(timeoutMs: number): Promise<VoiceNoteCapabilities | null>;
    /** Null when Orbit does not know the bot. Throws when Orbit can't be asked. */
    noteHearing(botId: string, adapters: string[], timeoutMs: number): Promise<NoteHearingAnswer | null>;
    guestBrickHearing(adapters: string[], timeoutMs: number): Promise<NoteHearingAnswer>;
    reserveVoiceNote(input: ReserveInput, timeoutMs: number): Promise<Reservation>;
    leaseVoiceNote(turnId: string, input: { stage: 'hearing' | 'answer'; adapters?: string[] }, timeoutMs: number): Promise<Lease>;
    recordVoiceNote(turnId: string, event: TurnEvent, timeoutMs: number): Promise<void>;
    addVoiceNoteCleanup(job: { providerId: string; region?: string | null; kind: 'file' | 'transcription'; objectId: string }, timeoutMs: number): Promise<void>;
    claimVoiceNoteCleanups(limit: number, timeoutMs: number): Promise<CleanupJob[]>;
    settleVoiceNoteCleanup(id: string, outcome: CleanupOutcome, timeoutMs: number): Promise<void>;
}
