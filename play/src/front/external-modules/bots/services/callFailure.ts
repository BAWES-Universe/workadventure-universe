/**
 * Why a call with a bot did not start (game #2004). The bot server answers with a status and a `code`; this turns either
 * into one of these so the game can show one short line for every refusal.
 */
export type CallFailure =
    /** The owner's "Call" rule says no (or the person is a guest): `reason` is Orbit's line, shown as it is. */
    | "not_allowed"
    /** Orbit did not answer: asking again in a moment may work. `reason` is the line for the person. */
    | "cannot_check"
    /** The bot has no voice. */
    | "no_voice"
    /** The bot is not there any more. */
    | "not_here"
    /** The person's Orbit login ended and could not be renewed. */
    | "sign_in"
    /** Anything else: the bot server could not be reached, or it failed. */
    | "failed";

export type CallResult =
    | { started: true; spaceName: string }
    | { started: false; failure: CallFailure; reason?: string };

export function classifyCallFailure(error: unknown): CallFailure {
    const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };
    if (code === "not_allowed") return "not_allowed";
    if (code === "cannot_check") return "cannot_check";
    if (code === "no_voice" || status === 409) return "no_voice";
    if (code === "not_here" || status === 404) return "not_here";
    if (code === "session_expired" || code === "not_you") return "sign_in";
    if (status === 401 || (error as { isAuthError?: unknown } | undefined)?.isAuthError === true) return "sign_in";
    if (status === 403) return "not_allowed";
    return "failed";
}
