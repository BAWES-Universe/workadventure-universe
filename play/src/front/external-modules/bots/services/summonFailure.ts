/**
 * Why a Summon did not happen, in the terms the player cares about. The bot server answers with a status and a
 * `code`; this turns either into one of these so the game can show a short line for every refusal.
 */
export type SummonFailure =
    /** The bot is in the room but cannot see the player. */
    | "cannot_see_you"
    /** The bot is chatting, leading or already called over by someone else. */
    | "busy"
    /** The bot is already with the player asking. */
    | "already_with_you"
    /** The bot is not in this room right now. */
    | "not_here"
    /** The player's Orbit login ended and could not be renewed. */
    | "sign_in"
    /** Anything else: the bot server could not be reached, or it failed. */
    | "failed";

export type SummonResult = { summoned: true } | { summoned: false; failure: SummonFailure };

export function classifySummonFailure(error: unknown): SummonFailure {
    const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };
    if (code === "busy") return "busy";
    if (code === "already_with_you") return "already_with_you";
    if (code === "cannot_see_you") return "cannot_see_you";
    if (code === "not_here" || status === 404) return "not_here";
    if (status === 409) return "cannot_see_you";
    if (status === 401 || status === 403 || (error as { isAuthError?: unknown } | undefined)?.isAuthError === true) {
        return "sign_in";
    }
    return "failed";
}

/**
 * Which line to show for a failure. A guest has no login to renew, so "sign in again" would send them nowhere: they
 * get the plain "couldn't reach" line instead.
 */
export function summonFailureLine(
    failure: SummonFailure,
    isSignedIn: boolean
): "cannotSeeYou" | "notHere" | "busy" | "withYou" | "signIn" | "failed" {
    switch (failure) {
        case "cannot_see_you":
            return "cannotSeeYou";
        case "not_here":
            return "notHere";
        case "busy":
            return "busy";
        case "already_with_you":
            return "withYou";
        case "sign_in":
            return isSignedIn ? "signIn" : "failed";
        default:
            return "failed";
    }
}
