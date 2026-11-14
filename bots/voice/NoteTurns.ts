/**
 * Every bot hears voice notes (plan v3): a note is heard through Orbit's hearing answer, apart from the bot's Voice switch, in this
 * order, so nothing is paid twice or for free:
 *
 * 1. Read the clip (the caller already decided the note is for this bot) and measure its real length with ffmpeg, for free.
 * 2. Reserve it at Orbit: the payer is fixed, the person's reply is checked when the bot answers on Universe AI, and the note's
 *    seconds are counted on every limit in one go. A refusal ends it here: nothing reaches a provider.
 * 3. Take the hearing stage's lease (the key is checked again there), then hear the normalized copy with that key. The provider's
 *    ids are kept at Orbit as soon as it takes the note, so a lost hearing is looked up, never sent again.
 * 4. Say what happened: the words (kept, encrypted, for a moment) or why not, and whether the provider may have charged for it.
 *    What the provider still holds goes to Orbit's cleanup jobs, which keep deleting until it confirms.
 *
 * The same note asked again is the same turn: within this server it is the same answer, and across servers Orbit's turn record
 * gives the words already heard. Nothing here throws to the caller: every failure is a `HeardNote` with a reason.
 */
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { decryptApiKey } from '../ai/encryption';
import { HearingError, type ClipHearer, type HeardNote, type HearHooks } from './NoteHearing';
import type { NoteLength } from './NoteLength';
import type { CleanupJob, NoteHearingAnswer, Reservation, TurnEvent, VoiceNoteCapabilities, VoiceNoteOrbit } from './VoiceNoteOrbit';
import type { RecognitionConfig } from './protocol';

/** Who sent the note, and what the bot's reply would run on (for the person's reply allowance). */
export interface NoteSender {
    userId: string;
    isGuest?: boolean;
    source?: 'universe-ai' | 'provider' | 'own-key';
}

/** A reply limit that stopped the note before it was heard: the caller shows the usual limit card. */
export type TurnHeard = HeardNote | { ok: false; reason: 'reply-limit'; allowance: { limit: string; resetsAt: string; who: string } };

/** Where a guest's note to the Brick for guests stands. */
export type GuestNoteTurn =
    /** Heard: the answer stage is held for the caller, with `generation`. */
    | { kind: 'heard'; turnId: string; generation: number; transcript: string }
    /** Answered before: the kept answer, sent again without running anything. */
    | { kind: 'answered'; turnId: string; transcript: string; answer: string }
    /** Not heard, and nothing is pending: "This note is over N minutes", or "Couldn't listen to this note". */
    | { kind: 'refused'; why: 'too-long' | 'busy' | 'failed'; longestSeconds?: number }
    /** Its answer is no longer kept: "This answer is no longer available. Send it again." */
    | { kind: 'expired' }
    /** It may have been heard or answered by a server that is gone: never run again on its own. "Couldn't finish this one." */
    | { kind: 'uncertain' };

const GUEST_BRICK = 'guest-brick';

/** What the Brick for guests needs of note turns. */
export type GuestNotes = Pick<NoteTurns, 'canHearGuest' | 'guestNote' | 'answered' | 'answerFailed' | 'delivered'>;

export interface NoteTurnsOptions {
    orbit: VoiceNoteOrbit;
    hearers: Record<string, ClipHearer>;
    length: Pick<NoteLength, 'measure'>;
    /** The clip's bytes at its address, or throws. Over `maxBytes` it throws. */
    fetchClip: (url: string, maxBytes: number) => Promise<Uint8Array>;
    /** The longest voice note now (Orbit's Limits), in seconds; undefined when Orbit can't say. */
    longestSeconds: () => Promise<number | undefined>;
    maxBytes: number;
    /** How a person's key did, for its health. */
    report?: (botId: string, providerId: string, outcome: { ok: true } | { ok: false; status?: number; rejected?: boolean }) => void;
    timeoutMs?: number;
    log?: (message: string) => void;
    now?: () => number;
    /** How many notes this server reads and measures at once (each runs ffmpeg); one more is "busy", never queued. One per core by default. */
    measureAtOnce?: number;
    /** Waits, between tries of keeping the words at Orbit. */
    sleep?: (ms: number) => Promise<void>;
}

const CAPABILITIES_MS = 5 * 60_000;
const HEARING_MS = 60_000;
const KEEP_MS = 60 * 60_000;
const KEEP_MAX = 500;
/** The waits before keeping the words at Orbit is tried again: what the provider holds is let go only after the last try. */
const KEEP_WORDS_WAITS_MS = [500, 1500];

/** The parts of Orbit this needs. */
export const needsAll = (caps: VoiceNoteCapabilities | null): boolean => !!caps && caps.hearing && caps.reservations && caps.turns;

export class NoteTurns {
    private caps: { at: number; value: VoiceNoteCapabilities | null } | undefined;
    private readonly hearingCache = new Map<string, { at: number; value: NoteHearingAnswer | null }>();
    private readonly done = new Map<string, { at: number; result: Promise<TurnHeard> }>();
    private cleanupTimer: NodeJS.Timeout | undefined;
    private cleaning = false;
    /** Notes being read and measured now, across bots and guests. */
    private measuring = 0;

    constructor(private readonly options: NoteTurnsOptions) {}

    private get timeoutMs(): number {
        return this.options.timeoutMs ?? 5000;
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }

    private log(message: string): void {
        this.options.log?.(`voice note: ${message}`);
    }

    private adapters(): string[] {
        return Object.keys(this.options.hearers);
    }

    /**
     * Which parts of voice notes Orbit has: null for an Orbit from before, which keeps the old way (hear only while the bot talks
     * live). Throws when Orbit can't be asked: that never falls back to anything broader.
     */
    async capabilities(): Promise<VoiceNoteCapabilities | null> {
        if (this.caps && this.now() - this.caps.at < CAPABILITIES_MS) return this.caps.value;
        const value = await this.options.orbit.voiceNoteCapabilities(this.timeoutMs);
        this.caps = { at: this.now(), value };
        return value;
    }

    /** Whether this bot hears voice notes now, for the mic: Orbit's hearing answer, kept for a minute. Never throws. */
    async canHear(botId: string): Promise<boolean> {
        try {
            const kept = this.hearingCache.get(botId);
            const answer = kept && this.now() - kept.at < HEARING_MS ? kept.value : await this.options.orbit.noteHearing(botId, this.adapters(), this.timeoutMs);
            if (!kept || this.now() - kept.at >= HEARING_MS) this.hearingCache.set(botId, { at: this.now(), value: answer });
            return !!answer && answer.route !== 'none' && !!answer.provider && answer.provider.adapter in this.options.hearers;
        } catch (error) {
            this.log(`could not ask Orbit whether bot ${botId} hears (${describe(error)})`);
            return false;
        }
    }

    /**
     * Hears one note for a bot. `turnId` is the chat's own id for the note, the same on every try. `onStart` is called once the note
     * is reserved and this server holds its hearing, just before the provider gets it ("Listening…"); never for a refused note.
     */
    hear(botId: string, turnId: string, clip: { url?: string; bytes?: Uint8Array }, sender: NoteSender, onStart?: () => void): Promise<TurnHeard> {
        const key = `${botId}|${turnId}`;
        const now = this.now();
        for (const [id, entry] of this.done) {
            if (now - entry.at > KEEP_MS || this.done.size > KEEP_MAX) this.done.delete(id);
            else break;
        }
        const kept = this.done.get(key);
        if (kept) return kept.result;
        const result = this.run(botId, turnId, clip, sender, onStart).catch((error): TurnHeard => {
            this.log(`could not hear a note (${describe(error)})`);
            return { ok: false, reason: 'failed' };
        });
        this.done.set(key, { at: now, result });
        // A note refused for room or a passing trouble may be asked for again; one that was heard or refused for good is not
        void result.then((heard) => {
            const reason = 'reason' in heard ? heard.reason : undefined;
            if (reason === 'busy' || reason === 'failed' || reason === 'reply-limit' || reason === 'allowance') this.done.delete(key);
        });
        return result;
    }

    /** A place to read and measure one note, or false when this server is measuring as many as it takes at once. */
    private admit(): (() => void) | false {
        const most = this.options.measureAtOnce ?? Math.max(2, availableParallelism());
        if (this.measuring >= most) return false;
        this.measuring++;
        let freed = false;
        return () => {
            if (freed) return;
            freed = true;
            this.measuring--;
        };
    }

    private async run(botId: string, turnId: string, clip: { url?: string; bytes?: Uint8Array }, sender: NoteSender, onStart?: () => void): Promise<TurnHeard> {
        const started = this.now();
        // A burst of notes never starts more ffmpeg runs than the server takes: one more is "busy", asked again later
        const free = this.admit();
        if (!free) return { ok: false, reason: 'busy' };
        let bytes: Uint8Array;
        let measured: Awaited<ReturnType<NoteTurnsOptions['length']['measure']>>;
        let downloadMs: number;
        try {
            try {
                bytes = clip.bytes ?? (await this.options.fetchClip(clip.url ?? '', this.options.maxBytes));
            } catch (error) {
                if (/too large/i.test((error as Error)?.message ?? '')) return { ok: false, reason: 'too-big' };
                throw error;
            }
            if (bytes.byteLength > this.options.maxBytes) return { ok: false, reason: 'too-big' };
            downloadMs = this.now() - started;

            // The real length, for free, before anything is paid
            measured = await this.options.length.measure(bytes, await this.options.longestSeconds());
        } finally {
            free();
        }
        if ('reason' in measured) {
            if (measured.reason === 'unavailable') this.log('ffmpeg is not available: notes are not heard');
            return { ok: false, reason: measured.reason === 'too-long' ? 'too-long' : 'failed' };
        }

        const reservation = await this.options.orbit.reserveVoiceNote(
            {
                scope: 'bot',
                botId,
                userId: sender.userId,
                ...(sender.isGuest !== undefined ? { isGuest: sender.isGuest } : {}),
                clientTurnId: clientTurnIdOf(turnId),
                contentHash: createHash('sha256').update(bytes).digest('hex'),
                seconds: Math.max(1, Math.ceil(measured.seconds)),
                adapters: this.adapters(),
                source: sender.source ?? 'universe-ai',
            },
            this.timeoutMs
        );
        const refused = refusal(reservation);
        if (refused) return refused;
        if (!('turn' in reservation)) return { ok: false, reason: 'failed' };
        const turn = reservation.turn;

        // Heard before, on this server or another: the words, never a second hearing
        if (turn.state === 'heard' || turn.state === 'answering' || turn.state === 'answered' || turn.state === 'delivered') {
            const words = reservation.answer?.transcript ?? (await this.wordsOf(turn.id));
            return words !== null ? { ok: true, text: words, provider: 'kept', clipSeconds: measured.seconds, timings: { downloadMs, uploadMs: 0, waitMs: 0, totalMs: this.now() - started } } : { ok: false, reason: 'failed' };
        }
        if (turn.state !== 'reserved' && turn.state !== 'hearing') return { ok: false, reason: 'failed' };
        return this.hearStage(turn.id, measured, { started, downloadMs, botId, onStart });
    }

    /** Takes the hearing stage of a reserved turn and hears its normalized copy; the words are kept at Orbit. */
    private async hearStage(
        turnId: string,
        measured: { seconds: number; bytes: Uint8Array; filename: string },
        context: { started: number; downloadMs: number; botId?: string; onStart?: () => void }
    ): Promise<HeardNote> {
        const { started, downloadMs, botId, onStart } = context;
        const turn = { id: turnId };
        const lease = await this.options.orbit.leaseVoiceNote(turn.id, { stage: 'hearing', adapters: this.adapters() }, this.timeoutMs);
        if ('reason' in lease) return { ok: false, reason: lease.reason === 'held' ? 'busy' : lease.reason === 'no-hearing' ? 'none' : 'failed' };
        const hearing = lease.hearing;
        const hearer = hearing?.provider ? this.options.hearers[hearing.provider.adapter] : undefined;
        if (!hearing?.provider || !hearing.model || !hearer) {
            await this.record(turn.id, { event: 'hearing-failed', generation: lease.generation, charged: 'no' });
            return { ok: false, reason: 'unsupported' };
        }
        let key: string | null = null;
        try {
            key = decryptApiKey(hearing.provider.apiKeyEncrypted);
        } catch {
            key = null;
        }
        if (!key) {
            this.log(`the key of provider ${hearing.provider.id} could not be read`);
            await this.record(turn.id, { event: 'hearing-failed', generation: lease.generation, charged: 'no' });
            return { ok: false, reason: 'failed' };
        }
        const settings: RecognitionConfig = {
            adapter: hearing.provider.adapter,
            model: hearing.model,
            key,
            ...(hearing.provider.endpoint ? { endpoint: hearing.provider.endpoint } : {}),
            ...(hearing.provider.region ? { region: hearing.provider.region } : {}),
            ...(hearing.language ? { language: hearing.language } : {}),
        };
        const owner = hearing.payer === 'owner';
        const providerId = hearing.provider.id;
        let submitted = !!lease.reconcile;
        // What the provider holds is let go only once the words are kept at Orbit (or the hearing failed), so a paid transcript is
        // never deleted before it is stored. The hearing hands its ids over here instead of deleting them itself
        let left: { file?: string; transcription?: string } | undefined;
        const region = hearing.provider.region;
        const letGo = async (): Promise<void> => {
            if (!left) return;
            const unkept = await this.cleanUp(providerId, region, left);
            left = undefined;
            // What Orbit could not keep as a job is deleted at once, as before cleanup jobs
            const remove = hearer.remove?.bind(hearer);
            const direct: ['file' | 'transcription', string][] = [];
            if (unkept.transcription) direct.push(['transcription', unkept.transcription]);
            if (unkept.file) direct.push(['file', unkept.file]);
            for (const [kind, id] of direct) {
                await (remove ? remove({ key: settings.key ?? '', ...(settings.endpoint ? { endpoint: settings.endpoint } : {}) }, kind, id) : Promise.resolve(0)).catch(() => undefined);
            }
        };
        const hooks: HearHooks = {
            onSubmitted: async (refs) => {
                submitted = true;
                const ids = Object.fromEntries(Object.entries(refs).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
                await this.record(turn.id, { event: 'submitted', generation: lease.generation, refs: ids });
            },
            cleanup: async (refs) => {
                left = { ...(refs.file ? { file: refs.file } : {}), ...(refs.transcription ? { transcription: refs.transcription } : {}) };
                return {};
            },
        };

        onStart?.();
        try {
            const heard = lease.reconcile && hearer.reconcile ? await hearer.reconcile(settings, lease.reconcile, hooks) : await hearer.hear(settings, { bytes: measured.bytes, filename: measured.filename }, hooks);
            if (owner && botId) this.options.report?.(botId, providerId, { ok: true });
            await this.keepWords(turn.id, { event: 'heard', generation: lease.generation, transcript: heard.text, seconds: Math.max(0, Math.ceil(heard.seconds ?? measured.seconds)) });
            // Kept, or Orbit still could not be told after the tries above (logged): nothing stays at the provider either way, as
            // the plan says. Without the words at Orbit a guest's turn is not answered, and the guest sends the note again
            await letGo();
            const totalMs = this.now() - started;
            this.log(`heard a ${measured.seconds.toFixed(1)} s note with ${settings.adapter} in ${totalMs} ms (download ${downloadMs}, upload ${heard.uploadMs}, wait ${heard.waitMs})`);
            return { ok: true, text: heard.text, provider: settings.adapter, clipSeconds: measured.seconds, timings: { downloadMs, uploadMs: heard.uploadMs, waitMs: heard.waitMs, totalMs } };
        } catch (error) {
            // Taken by the provider, or cut off by the clock: it may have been charged, so it stays counted
            const charged = submitted ? 'yes' : error instanceof HearingError && error.status !== 504 && error.status !== undefined ? 'no' : 'unknown';
            await this.record(turn.id, { event: 'hearing-failed', generation: lease.generation, charged });
            await letGo();
            if (error instanceof HearingError) {
                if (owner && botId) this.options.report?.(botId, providerId, { ok: false, ...(error.status !== undefined ? { status: error.status } : {}), ...(error.rejected ? { rejected: true } : {}) });
                if (error.rejected) return { ok: false, reason: 'rejected', status: error.status };
                return { ok: false, reason: 'failed', ...(error.status !== undefined ? { status: error.status } : {}) };
            }
            throw error;
        }
    }

    /** Whether the Brick for guests hears voice notes now, for the mic: every part at Orbit, and Universe AI hearing. Never throws. */
    async canHearGuest(): Promise<boolean> {
        try {
            if (!needsAll(await this.capabilities())) return false;
            const kept = this.hearingCache.get(GUEST_BRICK);
            const answer = kept && this.now() - kept.at < HEARING_MS ? kept.value : await this.options.orbit.guestBrickHearing(this.adapters(), this.timeoutMs);
            if (!kept || this.now() - kept.at >= HEARING_MS) this.hearingCache.set(GUEST_BRICK, { at: this.now(), value: answer });
            return !!answer && answer.route !== 'none' && !!answer.provider && answer.provider.adapter in this.options.hearers;
        } catch (error) {
            this.log(`could not ask Orbit whether the Brick for guests hears (${describe(error)})`);
            return false;
        }
    }

    /**
     * A guest's voice note to the Brick for guests (plan v3): measured, reserved on the guest Brick's own note minutes (per guest and
     * per universe, on Universe AI), heard, and then the answer stage is held for the caller, who runs the model and says
     * `answered` or `answerFailed`. The same turn asked again gives back its kept answer, or its words without a second hearing.
     * `contentHash` covers everything the turn holds (the note, the text, the files, the history), so a reused id is refused.
     */
    async guestNote(input: { guestId: string; roomUrl: string; turnId: string; bytes: Uint8Array; contentHash: string }): Promise<GuestNoteTurn> {
        try {
            if (!needsAll(await this.capabilities())) return { kind: 'refused', why: 'failed' };
            const free = this.admit();
            if (!free) return { kind: 'refused', why: 'busy' };
            let measured: Awaited<ReturnType<NoteTurnsOptions['length']['measure']>>;
            try {
                measured = await this.options.length.measure(input.bytes, await this.options.longestSeconds());
            } finally {
                free();
            }
            if ('reason' in measured) {
                if (measured.reason === 'unavailable') this.log('ffmpeg is not available: notes are not heard');
                return { kind: 'refused', why: measured.reason === 'too-long' ? 'too-long' : 'failed' };
            }
            const reservation = await this.options.orbit.reserveVoiceNote(
                {
                    scope: 'guest-brick',
                    roomUrl: input.roomUrl,
                    userId: input.guestId,
                    isGuest: true,
                    clientTurnId: clientTurnIdOf(input.turnId),
                    contentHash: input.contentHash,
                    seconds: Math.max(1, Math.ceil(measured.seconds)),
                    adapters: this.adapters(),
                },
                this.timeoutMs
            );
            if ('reason' in reservation) {
                if (reservation.reason === 'expired') return { kind: 'expired' };
                if (reservation.reason === 'too-long') return { kind: 'refused', why: 'too-long', longestSeconds: (reservation as Extract<Reservation, { reason: 'too-long' }>).longestSeconds };
                return { kind: 'refused', why: reservation.reason === 'busy' ? 'busy' : 'failed' };
            }
            const turn = reservation.turn;
            if (reservation.answer?.answer !== undefined) return { kind: 'answered', turnId: turn.id, transcript: reservation.answer.transcript, answer: reservation.answer.answer };
            if (turn.state === 'reserved' || turn.state === 'hearing') {
                const started = this.now();
                const heard = await this.hearStage(turn.id, measured, { started, downloadMs: 0 });
                if ('reason' in heard) return { kind: 'refused', why: heard.reason === 'busy' ? 'busy' : 'failed' };
            } else if (turn.state === 'answering') {
                return { kind: 'refused', why: 'busy' };
            } else if (turn.state === 'answered' || turn.state === 'delivered') {
                return { kind: 'expired' };
            } else if (turn.state !== 'heard') {
                return { kind: 'uncertain' };
            }
            const lease = await this.options.orbit.leaseVoiceNote(turn.id, { stage: 'answer' }, this.timeoutMs);
            if (!('generation' in lease)) {
                const reason = (lease as { reason: string }).reason;
                return reason === 'held' ? { kind: 'refused', why: 'busy' } : reason === 'expired' ? { kind: 'expired' } : { kind: 'uncertain' };
            }
            if (typeof lease.transcript !== 'string') return { kind: 'uncertain' };
            return { kind: 'heard', turnId: turn.id, generation: lease.generation, transcript: lease.transcript };
        } catch (error) {
            this.log(`could not hear a note for the Brick for guests (${describe(error)})`);
            return { kind: 'refused', why: 'failed' };
        }
    }

    /**
     * The answer of a guest's note: kept at Orbit, encrypted, until the device says it has it (15 minutes at most). Throws when
     * Orbit did not keep it. The guest reply path then still sends the answer and keeps the try counted (never given back), so
     * a retry of the turn is refused by Orbit's count and the model never runs twice for one note.
     */
    answered(turnId: string, generation: number, answer: string): Promise<void> {
        return this.options.orbit.recordVoiceNote(turnId, { event: 'answered', generation, answer }, this.timeoutMs);
    }

    /** The model failed: the words stay, so the next try answers without hearing the note again. */
    answerFailed(turnId: string, generation: number): Promise<void> {
        return this.record(turnId, { event: 'answer-failed', generation });
    }

    /** The device has the answer: Orbit deletes it. */
    delivered(turnId: string): Promise<void> {
        return this.record(turnId, { event: 'delivered' });
    }

    /** The words a turn already has, read through the answer stage and handed straight back, so nothing is heard again. */
    private async wordsOf(turnId: string): Promise<string | null> {
        const lease = await this.options.orbit.leaseVoiceNote(turnId, { stage: 'answer' }, this.timeoutMs);
        if (!('generation' in lease) || typeof lease.transcript !== 'string') return null;
        await this.record(turnId, { event: 'answer-failed', generation: lease.generation });
        return lease.transcript;
    }

    /**
     * Keeps the words heard at Orbit before what the provider holds is let go: tried again a little later when Orbit can't be
     * reached or fails for a moment, never when it refuses (another server took over). Never throws: a last failure is logged.
     */
    private async keepWords(turnId: string, event: TurnEvent): Promise<void> {
        const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        for (let attempt = 0; ; attempt++) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await this.options.orbit.recordVoiceNote(turnId, event, this.timeoutMs);
                return;
            } catch (error) {
                const status = (error as { response?: { status?: number } } | null)?.response?.status;
                const passing = status === undefined || status >= 500 || status === 429;
                if (!passing || attempt >= KEEP_WORDS_WAITS_MS.length) {
                    this.log(`could not tell Orbit "${event.event}" for a turn (${describe(error)})`);
                    return;
                }
                // eslint-disable-next-line no-await-in-loop
                await sleep(KEEP_WORDS_WAITS_MS[attempt]);
            }
        }
    }

    /** Says what happened. A refusal (another server took over) or an Orbit that can't be reached is only logged. */
    private async record(turnId: string, event: TurnEvent): Promise<void> {
        try {
            await this.options.orbit.recordVoiceNote(turnId, event, this.timeoutMs);
        } catch (error) {
            this.log(`could not tell Orbit "${event.event}" for a turn (${describe(error)})`);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------------
    // What the provider still holds
    // ---------------------------------------------------------------------------------------------------------------------

    /**
     * Hands the provider's copies to Orbit's cleanup jobs, then tries them at once. Answers the copies Orbit could not keep, so
     * the hearing deletes those itself instead of leaving them unrecorded. Never throws.
     */
    async cleanUp(providerId: string, region: string | null, refs: { file?: string; transcription?: string }): Promise<{ file?: string; transcription?: string }> {
        const jobs: { kind: 'file' | 'transcription'; objectId: string }[] = [];
        if (refs.transcription) jobs.push({ kind: 'transcription', objectId: refs.transcription });
        if (refs.file) jobs.push({ kind: 'file', objectId: refs.file });
        const unkept: { file?: string; transcription?: string } = {};
        for (const job of jobs) {
            try {
                await this.options.orbit.addVoiceNoteCleanup({ providerId, region, ...job }, this.timeoutMs);
            } catch (error) {
                unkept[job.kind] = job.objectId;
                this.log(`could not keep a ${job.kind} to delete, deleting it at once instead (${describe(error)})`);
            }
        }
        void this.cleanNow();
        return unkept;
    }

    /** Deletes what is due, until the provider confirms each. Runs one round at a time; never throws. */
    async cleanNow(): Promise<number> {
        if (this.cleaning) return 0;
        this.cleaning = true;
        let settled = 0;
        try {
            // An Orbit from before has no cleanup jobs: its notes are deleted at once, as before
            if (!needsAll(await this.capabilities().catch(() => null))) return 0;
            const jobs = await this.options.orbit.claimVoiceNoteCleanups(20, this.timeoutMs);
            for (const job of jobs) {
                await this.cleanOne(job);
                settled++;
            }
        } catch (error) {
            this.log(`could not read the cleanups that are due (${describe(error)})`);
        } finally {
            this.cleaning = false;
        }
        return settled;
    }

    private async cleanOne(job: CleanupJob): Promise<void> {
        const hearer = this.options.hearers[job.provider.adapter];
        let outcome: { status: number } | { failed: true };
        try {
            const key = decryptApiKey(job.provider.apiKeyEncrypted);
            if (!key || !hearer?.remove) throw new Error('no way to delete it here');
            outcome = { status: await hearer.remove({ key, ...(job.provider.endpoint ? { endpoint: job.provider.endpoint } : {}) }, job.kind, job.objectId) };
        } catch {
            outcome = { failed: true };
        }
        try {
            await this.options.orbit.settleVoiceNoteCleanup(job.id, { ...outcome, lease: job.lease }, this.timeoutMs);
        } catch (error) {
            this.log(`could not tell Orbit how a cleanup went (${describe(error)})`);
        }
    }

    /** Keeps deleting what is due, every `everyMs`, for as long as the server runs. */
    startCleaning(everyMs = 60_000): void {
        if (this.cleanupTimer) return;
        this.cleanupTimer = setInterval(() => void this.cleanNow(), everyMs);
        this.cleanupTimer.unref?.();
    }

    stopCleaning(): void {
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
    }
}

/** A turn id Orbit takes (255 characters at most): long ones are hashed, so the same note always has the same id. */
export function clientTurnIdOf(turnId: string): string {
    return turnId.length <= 200 ? turnId : `h:${createHash('sha256').update(turnId).digest('hex')}`;
}

/** Orbit's refusal as the chat's reason, or null when the note was reserved. */
function refusal(reservation: Reservation): TurnHeard | null {
    if (!('reason' in reservation)) return null;
    switch (reservation.reason) {
        case 'reply-limit': {
            const { limit, resetsAt, who } = (reservation as Extract<Reservation, { reason: 'reply-limit' }>).allowance;
            return { ok: false, reason: 'reply-limit', allowance: { limit, resetsAt, who } };
        }
        case 'note-minutes':
            return { ok: false, reason: 'allowance' };
        case 'too-long':
            return { ok: false, reason: 'too-long' };
        case 'busy':
            return { ok: false, reason: 'busy' };
        case 'no-hearing':
            return { ok: false, reason: 'none' };
        default:
            return { ok: false, reason: 'failed' };
    }
}

/** A line about a failure that cannot carry a key or words. */
function describe(error: unknown): string {
    if (error instanceof HearingError) return error.status ? `status ${error.status}` : 'provider error';
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status) return `status ${status}`;
    return error instanceof Error ? error.constructor.name : 'error';
}
