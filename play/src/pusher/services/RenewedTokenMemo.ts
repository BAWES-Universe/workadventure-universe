import type { IntrospectionResponse } from "openid-client";

/**
 * Remembers, for a short time, the answer to a token renewal, keyed by the game token the browser presented.
 *
 * Why: some sign-in providers cancel the old refresh token as soon as they hand out a new one. The new one only exists
 * in the answer to /me. If the browser stopped waiting (its 10 second limit, a closed tab) or two tabs renewed the same
 * token at once, the next try presented the old game token again and the provider refused it: the player had to sign
 * in again. With the answer remembered, a repeat gets the same renewed token instead of a second, doomed renewal.
 *
 * Only a successful renewal is kept, in memory only (nothing survives a restart), for RENEWED_TOKEN_TTL_MS, and the
 * map is capped. Renewals of one token that overlap share one provider call.
 */
export const RENEWED_TOKEN_TTL_MS = 60_000;
export const RENEWED_TOKEN_MAX_ENTRIES = 1000;

interface Entry<T> {
    identifier: string;
    promise: Promise<T | null>;
    /** Set once the renewal succeeded; the answer is served until `expiresAt`. */
    settled?: { result: T; expiresAt: number };
    /** The player signed out while the renewal ran: its answer must not be kept. */
    discarded: boolean;
}

export class RenewedTokenMemo<T> {
    private readonly entries = new Map<string, Entry<T>>();

    constructor(
        private readonly ttlMs: number = RENEWED_TOKEN_TTL_MS,
        private readonly maxEntries: number = RENEWED_TOKEN_MAX_ENTRIES
    ) {}

    /**
     * The remembered renewal for this presented token, the one already running, or a new one from `renew`.
     * `renew` answers null when it could not renew; that answer is never kept.
     */
    renew(presentedToken: string, identifier: string, renew: () => Promise<T | null>): Promise<T | null> {
        const now = Date.now();
        const existing = this.entries.get(presentedToken);
        if (existing) {
            if (!existing.settled) return existing.promise;
            if (existing.settled.expiresAt > now) return Promise.resolve(existing.settled.result);
            this.entries.delete(presentedToken);
        }

        this.makeRoom(now);
        const entry: Entry<T> = { identifier, discarded: false, promise: Promise.resolve(null) };
        const forget = () => {
            if (this.entries.get(presentedToken) === entry) this.entries.delete(presentedToken);
        };
        entry.promise = renew().then(
            (result) => {
                if (result === null || entry.discarded) {
                    forget();
                } else {
                    entry.settled = { result, expiresAt: Date.now() + this.ttlMs };
                }
                return result;
            },
            (error) => {
                forget();
                throw error;
            }
        );
        this.entries.set(presentedToken, entry);
        return entry.promise;
    }

    /** Forgets everything remembered for this player, and keeps the renewals still running from being remembered. */
    forgetPlayer(identifier: string): void {
        for (const [key, entry] of this.entries) {
            if (entry.identifier !== identifier) continue;
            entry.discarded = true;
            this.entries.delete(key);
        }
    }

    clear(): void {
        for (const entry of this.entries.values()) entry.discarded = true;
        this.entries.clear();
    }

    private makeRoom(now: number): void {
        if (this.entries.size < this.maxEntries) return;
        for (const [key, entry] of this.entries) {
            if (entry.settled && entry.settled.expiresAt <= now) this.entries.delete(key);
        }
        // Still full: drop the oldest ones (a Map iterates in insertion order). A dropped renewal that is still running
        // simply isn't shared or remembered; its own caller still gets the answer.
        for (const [key, entry] of this.entries) {
            if (this.entries.size < this.maxEntries) break;
            entry.discarded = true;
            this.entries.delete(key);
        }
    }
}

/** What a successful renewal gives: the renewed game token, its access token, and the provider's user info. */
export interface RenewedTokens {
    authToken: string;
    accessToken: string;
    checked: IntrospectionResponse;
}

export const renewedTokenMemo = new RenewedTokenMemo<RenewedTokens>();
