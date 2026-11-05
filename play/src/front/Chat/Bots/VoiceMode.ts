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
    const { botId, botName, state, followUpSeconds, repliesLeft, repliesResetAt } = value as Partial<
        Record<string, unknown>
    >;
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
    };
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
