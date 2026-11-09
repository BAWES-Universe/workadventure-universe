/**
 * How a person talks with voice bots (#1666), and where a bot's voice stands for them.
 *
 * Everything here is pure, so it can be tested without a game: the four choices and the mode the bot's voice worker
 * is given for each, how a bot's status event is read, and which of the button's states shows.
 */

/** The four ways to talk with bots, as the menu names them. One choice for every voice bot. */
export type VoiceChoice = "talk" | "speak_and_read" | "type_and_listen" | "text_only";

export const VOICE_CHOICES: readonly VoiceChoice[] = ["talk", "speak_and_read", "type_and_listen", "text_only"];
export const DEFAULT_VOICE_CHOICE: VoiceChoice = "talk";

/** The voice worker's modes for each choice (bots/voice/protocol.ts): who it takes the microphone of, and who it plays to. */
export type VoiceWorkerMode = "talk" | "speak_and_read" | "type_and_listen" | "off";

export function voiceModeOf(choice: VoiceChoice): VoiceWorkerMode {
    return choice === "text_only" ? "off" : choice;
}

/** Whether the bot's voice plays for this person: only talk and listen, and type and listen, are heard. */
export function choiceHearsBot(choice: VoiceChoice): boolean {
    return choice === "talk" || choice === "type_and_listen";
}

/** Whether the bot may take this person's microphone: only talk and listen, and speak and read. */
export function choiceSpeaksToBot(choice: VoiceChoice): boolean {
    return choice === "talk" || choice === "speak_and_read";
}

/** Where a bot says its voice with this person stands. paused: the bot says voice is unavailable. */
export type VoiceBotState = "connecting" | "on" | "paused";

/**
 * Whether the bot takes this person's microphone in a group (round 8), as the bot says (bots/voice/protocol.ts ListenState).
 *   "": nothing to choose: alone with the bot (it hears them hands-free), or a mode that takes no microphone.
 *   off: it doesn't take it. pending: they asked it to keep listening, not confirmed yet. on: it does (confirmed).
 *   stopping: they asked it to stop, not confirmed yet. checking: the stop isn't confirmed after the wait, so it may still hear them.
 */
export type ListenState = "" | "off" | "pending" | "on" | "stopping" | "checking";
/** Why: others_joined (it heard them hands-free until someone joined), failed (couldn't start in time), limit (used for now). */
export type ListenReason = "" | "others_joined" | "failed" | "limit";

const LISTEN_STATES: readonly ListenState[] = ["", "off", "pending", "on", "stopping", "checking"];
const LISTEN_REASONS: readonly ListenReason[] = ["", "others_joined", "failed", "limit"];

export interface BotVoiceStatus {
    botId: string;
    botName: string;
    state: VoiceBotState;
    /** Seconds the bot keeps listening after it answers without hearing its name; 0 when the bot says none. */
    followUpSeconds: number;
    /** The spoken replies this person has left in their window (#1669); undefined when the bot has no count. */
    repliesLeft?: number;
    /** When their window ends, in milliseconds; undefined when none is running or the bot doesn't know. */
    repliesResetAt?: number;
    /** Whether it takes their microphone in a group, and why not (round 8). A bot that says nothing about it: "". */
    listening: ListenState;
    listeningReason: ListenReason;
}

const STATES: readonly VoiceBotState[] = ["connecting", "on", "paused"];
const ID_MAX = 128;
const NAME_MAX = 120;
/** A longer wait than a day is not a setting of a bot. */
const FOLLOW_UP_MAX_SECONDS = 24 * 60 * 60;
/** No window is this large: a count above it is not one a bot gave. */
const REPLIES_LEFT_MAX = 100_000;

/** What a bot's status event says, or undefined when any part of it is missing or not one we know. */
export function parseBotVoiceStatus(value: unknown, fallbackName: string): BotVoiceStatus | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { botId, botName, state, followUpSeconds, repliesLeft, repliesResetAt, listening, listeningReason } =
        value as Partial<Record<string, unknown>>;
    if (typeof botId !== "string" || botId === "" || botId.length > ID_MAX) return undefined;
    if (!STATES.includes(state as VoiceBotState)) return undefined;
    const name = (typeof botName === "string" && botName.trim() !== "" ? botName : fallbackName)
        .trim()
        .slice(0, NAME_MAX);
    const seconds =
        typeof followUpSeconds === "number" &&
        Number.isInteger(followUpSeconds) &&
        followUpSeconds > 0 &&
        followUpSeconds <= FOLLOW_UP_MAX_SECONDS
            ? followUpSeconds
            : 0;
    const left =
        typeof repliesLeft === "number" &&
        Number.isInteger(repliesLeft) &&
        repliesLeft >= 0 &&
        repliesLeft <= REPLIES_LEFT_MAX
            ? repliesLeft
            : undefined;
    const resetAt = typeof repliesResetAt === "string" && repliesResetAt !== "" ? Date.parse(repliesResetAt) : NaN;
    return {
        botId,
        botName: name,
        state: state as VoiceBotState,
        followUpSeconds: seconds,
        repliesLeft: left,
        repliesResetAt: left !== undefined && !Number.isNaN(resetAt) ? resetAt : undefined,
        // Anything not known is nothing to show: the button stays as it is today
        listening: LISTEN_STATES.includes(listening as ListenState) ? (listening as ListenState) : "",
        listeningReason: LISTEN_REASONS.includes(listeningReason as ListenReason)
            ? (listeningReason as ListenReason)
            : "",
    };
}

/**
 * What the short bar beside the Voice button says (round 8), or nothing. The bar explains a change, then folds back into the button; the
 * same words stay in the voice options. Shown for a change only, never again on its own: `before` is what the bot said last time.
 *   paused: it heard you hands-free and a friend joined. not_listening: you came into a group (once a visit). failed: it couldn't start.
 *   turning_on, listening, checking: your ask to keep listening or to stop, as it goes.
 */
export type VoiceBar = "paused" | "not_listening" | "failed" | "turning_on" | "listening" | "checking";

export function voiceBarFor(
    before: Pick<BotVoiceStatus, "listening" | "listeningReason"> | undefined,
    now: Pick<BotVoiceStatus, "listening" | "listeningReason">,
    seenNotListening: boolean
): VoiceBar | undefined {
    const was = before?.listening ?? "";
    if (now.listening === was && now.listeningReason === (before?.listeningReason ?? "")) return undefined;
    if (now.listening === "pending") return "turning_on";
    if (now.listening === "checking") return "checking";
    if (now.listening === "on" && was === "pending" && now.listeningReason === "") return "listening";
    if (now.listening === "off") {
        if (now.listeningReason === "others_joined" && was !== "off") return "paused";
        if (now.listeningReason === "failed" && was === "pending") return "failed";
        if (was === "" && now.listeningReason === "" && !seenNotListening) return "not_listening";
    }
    return undefined;
}

/** How long a bar stays before it folds, in ms; undefined: until the next change (round 8 pilot values). */
export function voiceBarMs(bar: VoiceBar): number | undefined {
    if (bar === "turning_on" || bar === "checking") return undefined;
    return bar === "listening" ? 3000 : 8000;
}

/**
 * What the Voice menu says about the person's spoken replies (#1669), from what the bot told and the time now. A count whose window
 * has ended is not true any more, so it says nothing.
 *   left: spoken replies are left, so the menu says how many and when more come (`resetsAt` only while a window is running).
 *   used_up: none is left until `resetsAt`.
 *   none: nothing to say (the maker's own keys pay, the bot has no count, or the window ended).
 */
export type VoiceAllowanceLine =
    | { kind: "left"; count: number; resetsAt: number | undefined }
    | { kind: "used_up"; resetsAt: number | undefined }
    | { kind: "none" };

export function voiceAllowanceLine(
    status: Pick<BotVoiceStatus, "repliesLeft" | "repliesResetAt">,
    now: number
): VoiceAllowanceLine {
    const { repliesLeft, repliesResetAt } = status;
    if (repliesLeft === undefined) return { kind: "none" };
    // A window that has ended has given everything back: what the bot last said is old
    if (repliesResetAt !== undefined && repliesResetAt <= now) return { kind: "none" };
    return repliesLeft > 0
        ? { kind: "left", count: repliesLeft, resetsAt: repliesResetAt }
        : { kind: "used_up", resetsAt: repliesResetAt };
}

/** What the Voice button shows: one of the person's four choices, or what the bot's voice is doing instead. */
export type VoiceButtonState = VoiceChoice | "paused" | "connecting" | "tap_to_hear";

/**
 * The state the button shows. A paused voice and a connecting one come first, then sound the browser has not let
 * play (only when the choice is to hear the bot), then the choice itself.
 */
export function voiceButtonState(
    choice: VoiceChoice,
    botState: VoiceBotState,
    soundBlocked: boolean
): VoiceButtonState {
    if (botState === "paused") return "paused";
    if (botState === "connecting") return "connecting";
    if (soundBlocked && choiceHearsBot(choice)) return "tap_to_hear";
    return choice;
}
