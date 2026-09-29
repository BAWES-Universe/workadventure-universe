/**
 * State helpers for the global message composer (text, audio and live megaphone).
 * Pure functions, kept out of Svelte so they can be unit tested.
 */
export type GlobalMessageKind = "text" | "audio" | "live";
export type GlobalMessageTarget = "room" | "world";
/** Who the live megaphone reaches, from Configure my room > Megaphone > scope. */
export type MegaphoneAudience = "room" | "world";

/** Text and audio messages are admin-only. The live megaphone depends on the room's megaphone setting. */
export function availableKinds(isAdmin: boolean): GlobalMessageKind[] {
    return isAdmin ? ["text", "audio", "live"] : ["live"];
}

/**
 * Tab to open on. A running broadcast always wins, so reopening the composer shows how to stop it.
 * Otherwise keep the last tab if it is still allowed, else the first allowed one.
 */
export function initialKind(
    kinds: GlobalMessageKind[],
    isLive: boolean,
    previous: GlobalMessageKind | undefined
): GlobalMessageKind {
    if (isLive && kinds.includes("live")) {
        return "live";
    }
    if (previous && kinds.includes(previous)) {
        return previous;
    }
    return kinds[0] ?? "live";
}

export function isBroadcastToWorld(target: GlobalMessageTarget): boolean {
    return target === "world";
}

/** The megaphone space is per room when the scope is "ROOM"; anything else (including unset) is the world default. */
export function megaphoneAudience(scope: string | undefined): MegaphoneAudience {
    return scope === "ROOM" ? "room" : "world";
}

/** Quill keeps a trailing newline in an empty editor, so treat whitespace-only content as empty. */
export function isQuillTextEmpty(text: string): boolean {
    return text.trim().length === 0;
}
