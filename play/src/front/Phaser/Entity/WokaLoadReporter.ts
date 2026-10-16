import * as Sentry from "@sentry/svelte";
import { ResourceLoadError } from "../Services/SuperLoaderPlugin";

/**
 * Tells Sentry when a Woka's pictures can't be drawn. On an installed phone app nobody can read the console, so
 * without this an invisible Woka leaves no trace.
 *
 * - "character": the Woka of a player on the map (including the player's own).
 * - "snapshot": the flat picture of a Woka used by the interface (chat picture, cards).
 * - "loader": the loading itself, before anything knows who asked.
 */
export type WokaLoadSource = "character" | "snapshot" | "loader";

/** What ended up on screen after the Woka's own pictures failed. */
export type WokaLoadOutcome = "stand-in-drawn" | "nothing-drawn" | "stalled";

export interface WokaTextureRef {
    id: string;
    url: string;
}

/** A load that has not finished after this long (10 s timeout, two retries, plus slack) is reported as stalled. */
export const WOKA_STALL_REPORT_MS = 40_000;

// Each distinct case is sent once per page session, and only a handful of cases in total: a broken Woka picture is
// shared by everyone who wears it, and one bad connection fails every picture at once.
const MAX_REPORTS_PER_SESSION = 15;
const reported = new Set<string>();

/** Test helper: forget what was already reported. */
export function resetWokaLoadReports(): void {
    reported.clear();
}

function describeFailure(error: unknown): { reason: string; failedId?: string; failedUrl?: string; message: string } {
    if (error instanceof ResourceLoadError) {
        return {
            reason: error.reason,
            failedId: error.resourceKey,
            failedUrl: error.url,
            message: error.message,
        };
    }
    return { reason: "unknown", message: error instanceof Error ? error.message : String(error) };
}

function send(
    source: WokaLoadSource,
    outcome: WokaLoadOutcome,
    reason: string,
    textures: WokaTextureRef[],
    dedupeId: string,
    error: unknown,
    extra: Record<string, unknown>
): void {
    const key = [source, outcome, reason, dedupeId].join("|");
    if (reported.has(key) || reported.size >= MAX_REPORTS_PER_SESSION) {
        return;
    }
    reported.add(key);

    try {
        Sentry.withScope((scope) => {
            scope.setLevel(outcome === "stand-in-drawn" ? "warning" : "error");
            scope.setTags({ woka_source: source, woka_outcome: outcome, woka_reason: reason });
            scope.setFingerprint(["woka-load", source, outcome, reason, dedupeId]);
            scope.setExtras({
                textureIds: textures.map((texture) => texture.id),
                textureUrls: textures.map((texture) => texture.url),
                online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
                visibility: typeof document !== "undefined" ? document.visibilityState : undefined,
                ...extra,
            });
            Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
    } catch (e) {
        // Reporting must never break drawing a Woka.
        console.warn("Could not report a Woka load problem", e);
    }
}

export interface WokaLoadFailureDetails {
    /** The pictures asked for, when the caller still has them. The failing one is always named by the error. */
    textures?: WokaTextureRef[];
    /** Set when the stand-in body failed too, so nothing is drawn. */
    standInError?: unknown;
    userId?: number | string | null;
}

/** The Woka's own pictures could not be loaded and the stand-in body was tried instead. */
export function reportWokaLoadFailure(
    source: WokaLoadSource,
    error: unknown,
    details: WokaLoadFailureDetails = {}
): void {
    const { textures = [], standInError, userId } = details;
    const failure = describeFailure(error);
    const outcome: WokaLoadOutcome = standInError === undefined ? "stand-in-drawn" : "nothing-drawn";
    send(source, outcome, failure.reason, textures, failure.failedId ?? textures.map((t) => t.id).join(","), error, {
        message: failure.message,
        failedTextureId: failure.failedId,
        failedTextureUrl: failure.failedUrl,
        standInError: standInError === undefined ? undefined : describeFailure(standInError).message,
        userId,
    });
}

/** The Woka's pictures were still not here after `WOKA_STALL_REPORT_MS`, with the scene still alive. */
export function reportWokaLoadStalled(textures: WokaTextureRef[]): void {
    send(
        "loader",
        "stalled",
        "no-answer",
        textures,
        textures.map((t) => t.id).join(","),
        new Error(`Woka pictures not loaded after ${WOKA_STALL_REPORT_MS / 1000}s`),
        {}
    );
}
