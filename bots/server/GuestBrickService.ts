/**
 * The Brick for guests (game #1997): what answers a guest who writes to the Brick in their Chats.
 *
 * It is Universe's own, one shared definition for every universe, and it has no bot row: nothing is created for a guest,
 * nothing about a guest is kept here, and nothing is written to a bot's conversation log. The chat itself lives on the
 * guest's device, which sends the lines it holds with each message; this service reads them for this one answer and
 * forgets them. Orbit keeps totals only (who, where, when, what a reply took).
 *
 * The order of a turn, so nothing is spent that is not counted and nothing counted that was not tried:
 *   1. read what steers the Brick for this place, and how to reach Universe AI, from Orbit (never a host's key);
 *   2. ask Orbit whether this guest may have one more reply (their own allowance, the universe's pool); Orbit counts it at once;
 *   3. only then ask the model;
 *   4. close the turn at Orbit: a reply that failed is given back, and what it took is kept as totals.
 * The hello is the game's own fixed text and never comes through here.
 */
import { AIProviderRegistry } from '../ai/AIProviderRegistry';
import { readBotLimits, type AIProviderConfig, type BotLimits } from '../ai/types';
import { priceMetadata } from '../ai/pricing/ledger';
import type { AdminApiService, GuestBrickAllowance, GuestBrickSetup } from './AdminApiService';
import type { GuestChatNote } from '../matrix/MatrixDmBridge';

/** One line of the chat the guest holds, as their device sends it back. */
export interface GuestChatLine {
    from: 'guest' | 'brick';
    text: string;
}

export interface GuestBrickAsk {
    /** The guest: from their game token, never from the request. */
    guestId: string;
    /** One id for each try; a retry of the same try is counted once. */
    turnId: string;
    /** The room they are in: it decides which place the Brick helps with. */
    roomUrl: string;
    /** What they wrote now. */
    message: string;
    /** The chat so far, oldest first, without the message above. */
    history: GuestChatLine[];
    /** The Brick already said, once in this chat, that something needs an account: it does not say it again. */
    saidNeedsAccount: boolean;
}

export type GuestBrickAnswer =
    /** `needsAccount` is true when this answer says that something needs an account: the game then offers to sign in. */
    | { kind: 'reply'; text: string; needsAccount: boolean }
    /** The guest's own allowance, or the universe's pool for guests, is used up: no model was asked. */
    | { kind: 'limit'; limit: 'guest' | 'universe'; resetsAt: string }
    /** Another message of this guest is being answered: they send it again once it is. */
    | { kind: 'busy' }
    /** It could not answer (the AI failed, Orbit could not be asked): nothing was counted, they can send it again. */
    | { kind: 'failed' };

/** The Brick ends an answer with this when that answer says something needs an account; the game never shows it. */
export const NEEDS_ACCOUNT_MARK = '[NEEDS_ACCOUNT]';
const NEEDS_ACCOUNT_MARKS = /\s*\[NEEDS_ACCOUNT\]\s*/gi;

/** Words added to what Orbit says steers the Brick, so the game can tell an answer that points to signing in. */
function markRule(saidAlready: boolean): string {
    return saidAlready
        ? 'You already told this guest that something needs an account. Do not say it again and do not use any marker.'
        : `When your answer tells them that something needs an account (you cannot remember things after this visit, keep what you make, use apps, make more Bricks or use a computer until they sign in), end that answer with ${NEEDS_ACCOUNT_MARK} on its own at the very end. Never use it in any other answer.`;
}

/** The answer without the mark, and whether it had one. */
export function readMark(text: string): { text: string; needsAccount: boolean } {
    const needsAccount = new RegExp(NEEDS_ACCOUNT_MARKS.source, 'i').test(text);
    return { text: text.replace(NEEDS_ACCOUNT_MARKS, ' ').replace(/[ \t]+\n/g, '\n').trim(), needsAccount };
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Whether a string can be one of the ids this service takes in. */
export function isGuestBrickId(value: unknown): value is string {
    return typeof value === 'string' && ID.test(value);
}

/** The lines a request carries, kept to the ones the Brick may read: the newest `max`, each cut to `chars`. */
export function readHistory(value: unknown, max: number, chars: number): GuestChatLine[] {
    if (!Array.isArray(value)) return [];
    const lines: GuestChatLine[] = [];
    for (const one of value) {
        if (!one || typeof one !== 'object') continue;
        const { from, text } = one as Record<string, unknown>;
        if ((from !== 'guest' && from !== 'brick') || typeof text !== 'string' || !text.trim()) continue;
        lines.push({ from, text: text.trim().slice(0, chars) });
    }
    return lines.slice(-Math.max(0, max));
}

/**
 * The most a carried chat holds, so the one message that brings it never goes past what a homeserver takes in an event
 * (the lines are in it twice: as text and as data) or what a request may carry: the newest lines, each cut, within a byte budget.
 */
export const CARRIED_LINES_MAX = 200;
export const CARRIED_LINE_CHARS = 2000;
export const CARRIED_BYTES_MAX = 20000;

/** The longest the model may take for a guest's answer. The device stops waiting after a little more than this (Orbit round trips on top), so a counted answer always arrives. */
export const GUEST_REPLY_CEILING_MS = 90_000;

/** The lines of a chat a guest held, as their device brings them along after sign-in: each with when it was said. */
export function readCarriedLines(value: unknown): GuestChatNote[] {
    if (!Array.isArray(value)) return [];
    const lines: GuestChatNote[] = [];
    for (const one of value) {
        if (!one || typeof one !== 'object') continue;
        const { from, text, at } = one as Record<string, unknown>;
        if ((from !== 'guest' && from !== 'brick') || typeof text !== 'string' || !text.trim()) continue;
        lines.push({ from, text: text.trim().slice(0, CARRIED_LINE_CHARS), at: typeof at === 'number' && Number.isFinite(at) && at > 0 ? Math.floor(at) : Date.now() });
    }
    // The newest ones that fit: the start of a long chat is what is left behind
    const kept: GuestChatNote[] = [];
    let bytes = 0;
    for (let index = lines.length - 1; index >= 0 && kept.length < CARRIED_LINES_MAX; index--) {
        // A line is sent twice in the event (as the message text and as data), both JSON-escaped
        bytes += 2 * Buffer.byteLength(JSON.stringify(lines[index]), 'utf8');
        if (bytes > CARRIED_BYTES_MAX) break;
        kept.unshift(lines[index]);
    }
    return kept;
}

/** What the model is given as the guest's turn: the chat so far, then what they write now. */
export function guestTurn(history: GuestChatLine[], message: string): string {
    const before = history.map((line) => `${line.from === 'guest' ? 'Guest' : 'You'}: ${line.text}`).join('\n');
    return before ? `The chat so far:\n${before}\n\nThe guest now writes:\n${message}` : message;
}

/** The turn can only fail in these ways, and the guest only ever hears "try again". */
const AI_FAILED = 'The AI did not answer';

export class GuestBrickService {
    private readonly asking = new Set<string>();

    constructor(
        private readonly admin: Pick<AdminApiService, 'isConfigured' | 'getGuestBrick' | 'claimGuestBrickReply' | 'finishGuestBrickReply'>,
        private readonly providers: Pick<AIProviderRegistry, 'getOrCreateProvider'> = new AIProviderRegistry(),
        private readonly clock: () => Date = () => new Date()
    ) {}

    /** Whether Orbit is set up to run the Brick for guests at all. */
    available(): boolean {
        return this.admin.isConfigured();
    }

    async reply(ask: GuestBrickAsk): Promise<GuestBrickAnswer> {
        // One answer at a time per guest: two taps never spend two replies on one question
        if (this.asking.has(ask.guestId)) return { kind: 'busy' };
        this.asking.add(ask.guestId);
        try {
            return await this.turn(ask);
        } finally {
            this.asking.delete(ask.guestId);
        }
    }

    private async turn(ask: GuestBrickAsk): Promise<GuestBrickAnswer> {
        let setup: GuestBrickSetup;
        let allowance: GuestBrickAllowance;
        try {
            setup = await this.admin.getGuestBrick(ask.roomUrl);
        } catch (error) {
            console.warn('[GuestBrick] Could not ask Orbit:', error instanceof Error ? error.message : error);
            return { kind: 'failed' };
        }
        try {
            allowance = await this.admin.claimGuestBrickReply({ guestId: ask.guestId, turnId: ask.turnId, roomUrl: ask.roomUrl });
        } catch (error) {
            console.warn('[GuestBrick] Could not ask Orbit:', error instanceof Error ? error.message : error);
            // Orbit may have counted the turn before the answer was lost: it is closed as failed, so nothing is kept for an answer never given
            await this.admin.finishGuestBrickReply(ask.turnId, { failed: true });
            return { kind: 'failed' };
        }
        if (allowance.allowed === false) return { kind: 'limit', limit: allowance.limit, resetsAt: allowance.resetsAt };
        // This very try was counted before and did not fail: it is answered or being answered, so the model is not paid for again.
        // A try that failed before is counted again by Orbit (`counted` is true), so it runs.
        if (allowance.counted === false) {
            console.warn('[GuestBrick] This try was already counted, so no model runs again:', ask.turnId);
            return { kind: 'failed' };
        }

        const limits: BotLimits = readBotLimits(setup.credentials.limits);
        const config = {
            ...setup.credentials,
            maxTokens: typeof setup.credentials.maxTokens === 'number' ? setup.credentials.maxTokens : limits.replyTokens,
            // Never longer than the device waits for an answer (BotApiService GUEST_REPLY_TIMEOUT_MS), whatever Orbit says: a reply that finished after the device gave up would be counted but never seen
            settings: { ...(setup.credentials.settings ?? {}), timeout: Math.min(limits.waitSeconds * 1000, GUEST_REPLY_CEILING_MS) },
        } as unknown as AIProviderConfig;
        const history = readHistory(ask.history, limits.messages, limits.readChars);
        const message = ask.message.trim().slice(0, limits.readChars);
        const sentAt = this.clock();
        try {
            const provider = this.providers.getOrCreateProvider(config);
            if (!provider.isReady()) throw new Error(AI_FAILED);
            const system = `${setup.brick.chatInstructions}\n\n${markRule(ask.saidNeedsAccount)}`;
            const response = await provider.generate(system, guestTurn(history, message), config);
            if (response.error || !response.content?.trim()) throw new Error(AI_FAILED);
            const priced = priceMetadata(
                config,
                {
                    tokensUsed: response.tokensUsed,
                    promptTokens: response.usage?.promptTokens,
                    completionTokens: response.usage?.completionTokens,
                    cachedPromptTokens: response.usage?.cachedPromptTokens,
                    cacheWriteTokens: response.usage?.cacheWriteTokens,
                    reasoningTokens: response.usage?.reasoningTokens,
                    costUsd: response.usage?.costUsd,
                    error: response.error,
                },
                sentAt
            );
            const answer = readMark(response.content);
            // An answer that was only the marker has nothing to show: it fails, and the allowance is given back
            if (!answer.text.trim()) throw new Error(AI_FAILED);
            // What was said is never kept: only what it took
            await this.admin.finishGuestBrickReply(ask.turnId, { tokensUsed: response.tokensUsed, costMicros: priced.cost.micros });
            return { kind: 'reply', text: answer.text, needsAccount: answer.needsAccount && !ask.saidNeedsAccount };
        } catch (error) {
            console.warn('[GuestBrick] The reply failed:', error instanceof Error ? error.message : error);
            // Given back: a guest is never charged an allowance for an answer they did not get
            await this.admin.finishGuestBrickReply(ask.turnId, { failed: true });
            return { kind: 'failed' };
        }
    }
}
