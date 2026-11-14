import type { BotStepKind } from "../../Bots/BotSteps";

/**
 * One call with a Brick, or with a bot whose owner allows calls (game #2004, mock v10 Part 18, plan H2 and I4).
 *
 * Everything here is pure, so it is tested without a game: what the call is doing, who has the microphone, when it is
 * on hold and why, the one card for someone who walks up, and when a quiet stretch ends it. Nothing here touches the
 * person's status: "On a call" is a passing state the game shows next to their name while the call lasts, and Busy and
 * Do not disturb stay exactly as the person set them (check 63). No distance or nearest cue anywhere: the card is for
 * whoever the game says is here, whoever they are.
 *
 * The call's phases:
 *   connecting: asked for, not heard yet.
 *   on:         the bot hears the person, and the person hears the bot.
 *   hold:       the bot hears nothing and says nothing. Why: the person chose to talk with someone who walked up, or a
 *               meeting. Only `resume` brings the call back (check 64): nothing here resumes by itself.
 *   ended:      over. `endedBy` says how, so the one true line can be shown.
 */
export type CallPhase = "connecting" | "on" | "hold" | "ended";

/** What the bot is doing while the call is on. Shown as one short line, with the mood or work emoji beside its face. */
export type CallDoing = "listening" | "speaking" | "working" | "waiting";

export type HoldWhy = { kind: "person"; name: string } | { kind: "meeting" };

export type CallEnd = "you" | "bot" | "quiet" | "unavailable";

/** Someone has walked up: nobody is interrupted, one card asks (mock Part 18 picture 10). */
export interface WalkUp {
    id: string;
    name: string;
    /** Their account id, which finds their Woka on the map (the picture the other request cards show). */
    uuid?: string;
}

export interface CallState {
    phase: CallPhase;
    /**
     * What the bot is doing, worked out from the three separate facts below by `settle`, never set by hand: waiting for
     * the person's OK shows first, then work, then speech. Each fact ends by its own event, so one ending never cuts
     * short another, and a call is only quiet when none of them is going on.
     */
    doing: CallDoing;
    /** The bot is speaking right now. */
    speakingNow?: boolean;
    /** The bot waits for the person's OK. */
    waitingNow?: boolean;
    /** What it is working on, while `doing` is "working". */
    work?: BotStepKind;
    workLine?: string;
    /** When the call was asked for, in ms. The time shown counts from here, and keeps counting on hold. */
    startedAt: number;
    /** The last moment anyone said or did something in the call, in ms: a quiet stretch counts from here. */
    lastHeardAt: number;
    hold?: HoldWhy;
    /** The person joined a meeting while the call was still connecting: the call goes on hold the moment it connects. */
    meetingWhileConnecting?: boolean;
    walkUp?: WalkUp;
    endedBy?: CallEnd;
}

export type CallEvent =
    | { type: "connected"; now: number }
    | { type: "heard"; now: number }
    | { type: "bot-speaking"; speaking: boolean; now: number }
    | { type: "bot-working"; work: BotStepKind | undefined; line?: string; now: number }
    | { type: "bot-waiting"; waiting: boolean; now: number }
    | { type: "someone-here"; id: string; name: string; uuid?: string }
    | { type: "walk-up-gone"; id: string }
    | { type: "not-now" }
    | { type: "hold-and-talk" }
    | { type: "meeting-joined" }
    | { type: "resume"; now: number }
    | { type: "tick"; now: number; quietMs: number }
    | { type: "end"; by: CallEnd };

export function startCall(now: number): CallState {
    return { phase: "connecting", doing: "listening", startedAt: now, lastHeardAt: now };
}

export const isLive = (state: CallState): boolean => state.phase !== "ended";

/**
 * Who has the microphone. Only "bot" while the call is on. On hold it belongs to the people (the person and whoever
 * they chose to talk with), never to the bot, and never to both (check 64).
 */
export function micOwner(state: CallState): "bot" | "people" | "none" {
    if (state.phase === "on") return "bot";
    if (state.phase === "hold") return "people";
    return "none";
}

/** Whether the bot may hear the person right now. */
export const botMayHear = (state: CallState): boolean => micOwner(state) === "bot";

/** Whether the bot's sound plays for the person right now: stops the moment the call goes on hold. */
export const botMaySpeak = (state: CallState): boolean => state.phase === "on";

/** "On a call" for other people, while the call lasts. A passing label only: it never replaces Busy or Do not disturb. */
export const showsOnACall = (state: CallState): boolean => state.phase !== "ended";

/** Works out `doing` from the separate facts, and drops the work line once the work is over. */
function settle(state: CallState): CallState {
    const doing: CallDoing = state.waitingNow
        ? "waiting"
        : state.work
        ? "working"
        : state.speakingNow
        ? "speaking"
        : "listening";
    return { ...state, doing, ...(state.work ? {} : { workLine: undefined }) };
}

export function callReducer(state: CallState, event: CallEvent): CallState {
    if (state.phase === "ended") return state;
    switch (event.type) {
        case "connected":
            if (state.phase !== "connecting") return state;
            // Never "on" while a meeting has the microphone: the microphone never goes to both (check 64)
            if (state.meetingWhileConnecting)
                return {
                    ...state,
                    phase: "hold",
                    hold: { kind: "meeting" },
                    meetingWhileConnecting: undefined,
                    doing: "listening",
                    lastHeardAt: event.now,
                };
            return settle({ ...state, phase: "on", doing: "listening", lastHeardAt: event.now });
        case "heard":
            return state.phase === "on" ? { ...state, lastHeardAt: event.now } : state;
        case "bot-speaking":
            // Kept in every phase, so a bot that is already speaking as the call connects or resumes shows as speaking at
            // once. Only a call that is on counts it as something happening, and shows it.
            if (state.phase !== "on") return { ...state, speakingNow: event.speaking };
            return settle({ ...state, speakingNow: event.speaking, lastHeardAt: event.now });
        case "bot-working":
            if (state.phase !== "on") return state;
            return settle({
                ...state,
                work: event.work,
                workLine: event.work ? event.line : undefined,
                lastHeardAt: event.now,
            });
        case "bot-waiting":
            if (state.phase !== "on") return state;
            return settle({ ...state, waitingNow: event.waiting, lastHeardAt: event.now });
        case "someone-here":
            // One card at a time: a second person is not shown until the first card is answered. No card while the call
            // is on hold: it is already held for a person or a meeting, and joining someone else would overwrite that.
            if (state.walkUp || state.phase !== "on") return state;
            return { ...state, walkUp: { id: event.id, name: event.name, uuid: event.uuid } };
        case "walk-up-gone":
            // The person the card asks about has left the bubble: the card goes, and the call is left as it was.
            if (state.walkUp?.id !== event.id) return state;
            return { ...state, walkUp: undefined };
        case "not-now":
            // The call carries on untouched. The other person can still message.
            return { ...state, walkUp: undefined };
        case "hold-and-talk":
            // Hold first. The two people are joined by the game after this state is shown, never before.
            if (!state.walkUp || state.phase !== "on") return state;
            return {
                ...state,
                phase: "hold",
                hold: { kind: "person", name: state.walkUp.name },
                walkUp: undefined,
                doing: "listening",
                waitingNow: false,
                work: undefined,
                workLine: undefined,
            };
        case "meeting-joined":
            if (state.phase === "connecting") return { ...state, meetingWhileConnecting: true };
            return {
                ...state,
                phase: "hold",
                hold: { kind: "meeting" },
                walkUp: undefined,
                doing: "listening",
                waitingNow: false,
                work: undefined,
                workLine: undefined,
            };
        case "resume":
            if (state.phase !== "hold") return state;
            return settle({ ...state, phase: "on", hold: undefined, doing: "listening", lastHeardAt: event.now });
        case "tick":
            // A quiet stretch ends a call that is on and nothing is happening in. While the bot speaks, works or waits for
            // the person's OK the call is not quiet, however long that takes. A call on hold is never ended by quiet: only
            // the person ends it.
            if (
                state.phase === "on" &&
                state.doing === "listening" &&
                event.quietMs > 0 &&
                event.now - state.lastHeardAt >= event.quietMs
            ) {
                return { ...state, phase: "ended", endedBy: "quiet", walkUp: undefined };
            }
            return state;
        case "end":
            return { ...state, phase: "ended", endedBy: event.by, walkUp: undefined, hold: undefined };
    }
}

/** The time shown on the bar, "6:12", or "1:02:03" past an hour. */
export function clock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const two = (n: number) => String(n).padStart(2, "0");
    return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
