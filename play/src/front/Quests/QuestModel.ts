/**
 * The Welcome chapter: three short paths a newcomer can pick from. Pure state and transitions only; the stores,
 * detectors and components drive it (see QuestStore.ts).
 */
export type QuestPath = "meet" | "explore" | "build";
export const QUEST_PATHS: readonly QuestPath[] = ["meet", "explore", "build"];

export type QuestStampId = "first-hello" | "explorer" | "builder";
export const QUEST_STAMPS: Readonly<Record<QuestPath, QuestStampId>> = {
    meet: "first-hello",
    explore: "explorer",
    build: "builder",
};

/** Rough minutes shown on each option row. */
export const QUEST_MINUTES: Readonly<Record<QuestPath, number>> = { meet: 2, explore: 1, build: 2 };

export type QuestPauseReason = "no-eligible-target";

export interface QuestEntry {
    accepted: boolean;
    done: boolean;
    paused: QuestPauseReason | null;
    acceptedAt: number | null;
    doneAt: number | null;
    viaShowMe: boolean;
}

/**
 * What the dock shows. "none" is an empty dock. The log opens over the dock and remembers what it covered.
 */
export type QuestSurface = "none" | "invitation" | "options" | "pill" | "card" | "log" | "payoff" | "follow-up";
export type QuestFollowUp = "sign-in" | "continuation";
export type QuestStatus = "available" | "accepted" | "tracked" | "done";

export interface QuestState {
    version: 1;
    quests: Record<QuestPath, QuestEntry>;
    tracked: QuestPath | null;
    /** "Not now" on the invitation: never offered again, in any room. */
    declined: boolean;
    /** How many times the invitation has been shown. Once more is allowed after it faded unanswered. */
    invitationSeen: number;
    /** "Hide quests" in the log. */
    hidden: boolean;
    /** The area Explore asks for, fixed when it was accepted so walking around never moves the goal. */
    exploreArea: QuestAreaRef | null;
    signInOfferSkipped: boolean;
    /** Completions of the tracked quest waiting for a moment when they can be shown. */
    pending: QuestPath[];
    payoff: QuestPath | null;
    followUp: QuestFollowUp | null;
    surface: QuestSurface;
    /** What the log covered, to put back when it closes. */
    beforeLog: QuestSurface | null;
    /** Something happened the person has not seen yet: a dot on the Quests row. */
    news: boolean;
}

export const MAX_INVITATION_SHOWS = 2;

export interface QuestAreaRef {
    id: string;
    name: string;
}

export type QuestEvent =
    | { type: "invitation-shown" }
    | { type: "invitation-faded" }
    | { type: "decline" }
    | { type: "open-options" }
    | { type: "accept"; path: QuestPath; now: number; exploreArea?: QuestAreaRef }
    | { type: "track"; path: QuestPath }
    | { type: "set-aside" }
    | { type: "remove"; path: QuestPath }
    | { type: "open-card" }
    | { type: "open-log" }
    | { type: "close" }
    | { type: "hide" }
    | { type: "show-quests" }
    | { type: "show-me"; path: QuestPath }
    | { type: "complete"; path: QuestPath; now: number }
    | { type: "pause"; path: QuestPath; reason: QuestPauseReason }
    | { type: "resume"; path: QuestPath }
    | { type: "news" }
    | { type: "payoff-settled"; followUp: QuestFollowUp | null }
    | { type: "sign-in-later"; continuation: boolean }
    | { type: "follow-up-closed" }
    | { type: "reset" };

export function emptyEntry(): QuestEntry {
    return { accepted: false, done: false, paused: null, acceptedAt: null, doneAt: null, viaShowMe: false };
}

export function initialQuestState(): QuestState {
    return {
        version: 1,
        quests: { meet: emptyEntry(), explore: emptyEntry(), build: emptyEntry() },
        tracked: null,
        declined: false,
        invitationSeen: 0,
        hidden: false,
        exploreArea: null,
        signInOfferSkipped: false,
        pending: [],
        payoff: null,
        followUp: null,
        surface: "none",
        beforeLog: null,
        news: false,
    };
}

export function isQuestPath(value: unknown): value is QuestPath {
    return typeof value === "string" && (QUEST_PATHS as readonly string[]).includes(value);
}

export function anyAccepted(state: QuestState): boolean {
    return QUEST_PATHS.some((path) => state.quests[path].accepted);
}

export function questStatus(state: QuestState, path: QuestPath): QuestStatus {
    const entry = state.quests[path];
    if (entry.done) return "done";
    if (state.tracked === path) return "tracked";
    return entry.accepted ? "accepted" : "available";
}

/** Accepted and not done nor tracked: the count on the Quests row when nothing is tracked. */
export function acceptedUntrackedCount(state: QuestState): number {
    return QUEST_PATHS.filter((path) => questStatus(state, path) === "accepted").length;
}

/** The surface the dock rests on when nothing else is open. */
export function restingSurface(state: QuestState): QuestSurface {
    return state.tracked && !state.hidden ? "pill" : "none";
}

/**
 * Whether the arrival invitation may be shown now. Presence, suppression, deep links and timing are the caller's.
 */
export function canOfferInvitation(state: QuestState): boolean {
    return (
        !state.declined &&
        !state.hidden &&
        state.invitationSeen < MAX_INVITATION_SHOWS &&
        !anyAccepted(state) &&
        state.surface === "none"
    );
}

function clone(state: QuestState): QuestState {
    return {
        ...state,
        quests: {
            meet: { ...state.quests.meet },
            explore: { ...state.quests.explore },
            build: { ...state.quests.build },
        },
        pending: [...state.pending],
    };
}

function afterClose(state: QuestState): QuestSurface {
    switch (state.surface) {
        case "options":
            // Closing the options is not a decline: back to the invitation if nothing was picked yet.
            return !anyAccepted(state) && !state.declined ? "invitation" : restingSurface(state);
        case "card":
            return restingSurface(state);
        case "log": {
            const before = state.beforeLog;
            if (before === "invitation" || before === "options") return canReturnToInvitation(state) ? before : "none";
            return restingSurface(state);
        }
        default:
            return restingSurface(state);
    }
}

function canReturnToInvitation(state: QuestState): boolean {
    return !state.declined && !state.hidden && !anyAccepted(state);
}

export function reduceQuest(previous: QuestState, event: QuestEvent): QuestState {
    if (event.type === "reset") return initialQuestState();
    const state = clone(previous);
    switch (event.type) {
        case "invitation-shown":
            if (!canOfferInvitation(previous)) return previous;
            state.invitationSeen += 1;
            state.surface = "invitation";
            return state;
        case "invitation-faded":
            if (state.surface !== "invitation" && state.surface !== "options") return previous;
            if (anyAccepted(state)) return previous;
            state.surface = "none";
            state.news = true;
            return state;
        case "decline":
            state.declined = true;
            state.surface = "none";
            return state;
        case "open-options":
            state.surface = "options";
            state.followUp = null;
            return state;
        case "accept": {
            const entry = state.quests[event.path];
            if (entry.done) return previous;
            if (!entry.accepted) {
                entry.accepted = true;
                entry.acceptedAt = event.now;
            }
            if (event.path === "explore" && event.exploreArea) state.exploreArea = { ...event.exploreArea };
            state.tracked = event.path;
            state.hidden = false;
            state.followUp = null;
            state.surface = "pill";
            return state;
        }
        case "track": {
            const entry = state.quests[event.path];
            if (!entry.accepted || entry.done) return previous;
            state.tracked = event.path;
            state.hidden = false;
            if (state.surface !== "log") state.surface = "pill";
            return state;
        }
        case "set-aside":
            if (!state.tracked) return previous;
            state.tracked = null;
            if (state.surface === "pill" || state.surface === "card") state.surface = "none";
            return state;
        case "remove": {
            const entry = state.quests[event.path];
            if (!entry.accepted || entry.done) return previous;
            state.quests[event.path] = emptyEntry();
            if (event.path === "explore") state.exploreArea = null;
            if (state.tracked === event.path) {
                state.tracked = null;
                if (state.surface === "pill" || state.surface === "card") state.surface = "none";
            }
            return state;
        }
        case "open-card":
            if (!state.tracked || state.hidden) return previous;
            state.surface = "card";
            state.news = false;
            return state;
        case "open-log":
            if (state.surface === "log") return previous;
            // Opening the log over a payoff or follow-up ends it, as tapping it away would.
            state.beforeLog = state.surface === "payoff" || state.surface === "follow-up" ? null : state.surface;
            state.payoff = null;
            state.followUp = null;
            state.surface = "log";
            state.news = false;
            return state;
        case "close":
            if (state.surface === "none" || state.surface === "pill" || state.surface === "invitation") {
                return previous;
            }
            if (state.surface === "payoff") return previous;
            state.surface = afterClose(state);
            state.beforeLog = null;
            state.followUp = null;
            return state;
        case "hide":
            state.hidden = true;
            state.payoff = null;
            state.followUp = null;
            if (state.surface !== "log") state.surface = "none";
            return state;
        case "show-quests":
            state.hidden = false;
            return state;
        case "show-me":
            if (!state.quests[event.path].accepted || state.quests[event.path].done) return previous;
            state.quests[event.path].viaShowMe = true;
            return state;
        case "complete": {
            const entry = state.quests[event.path];
            if (!entry.accepted || entry.done) return previous;
            entry.done = true;
            entry.paused = null;
            entry.doneAt = event.now;
            // Only the tracked quest earns a presentation. Any other finishes quietly in the log.
            if (state.tracked === event.path) {
                if (!state.pending.includes(event.path)) state.pending.push(event.path);
            } else {
                state.news = true;
            }
            return state;
        }
        case "pause": {
            const entry = state.quests[event.path];
            if (!entry.accepted || entry.done || entry.paused === event.reason) return previous;
            entry.paused = event.reason;
            return state;
        }
        case "resume": {
            const entry = state.quests[event.path];
            if (entry.paused === null) return previous;
            entry.paused = null;
            return state;
        }
        case "news":
            if (state.news) return previous;
            state.news = true;
            return state;
        case "payoff-settled":
            if (state.surface !== "payoff") return previous;
            state.payoff = null;
            state.followUp = event.followUp;
            state.surface = event.followUp ? "follow-up" : restingSurface(state);
            return state;
        case "sign-in-later":
            state.signInOfferSkipped = true;
            state.followUp = event.continuation ? "continuation" : null;
            state.surface = event.continuation ? "follow-up" : restingSurface(state);
            return state;
        case "follow-up-closed":
            if (state.surface !== "follow-up") return previous;
            state.followUp = null;
            state.surface = restingSurface(state);
            return state;
    }
    return previous;
}

/**
 * Plays the next waiting completion if the dock is free. `blocked` is true while surfaces are suppressed or the
 * person is busy (a call, Do not disturb, typing): the completion stays recorded and waits.
 *
 * A waiting completion belongs to the quest that was tracked when it finished. If the person has tracked another
 * quest since, the completion stays in the log and never takes over their new choice.
 */
export function revealPending(previous: QuestState, blocked: boolean): QuestState {
    let state = previous;
    const kept = state.pending.filter((path) => path === state.tracked);
    if (kept.length !== state.pending.length) state = { ...state, pending: kept };
    if (
        blocked ||
        state.hidden ||
        state.pending.length === 0 ||
        state.surface === "log" ||
        state.surface === "payoff" ||
        state.surface === "follow-up" ||
        state.surface === "options"
    ) {
        return state;
    }
    const [payoff, ...pending] = state.pending;
    return {
        ...state,
        payoff,
        pending,
        surface: "payoff",
        tracked: state.tracked === payoff ? null : state.tracked,
    };
}

/** What the dock actually renders, given what is covering the game right now. */
export function visibleSurface(state: QuestState, suppression: { surfaces: boolean; pill: boolean }): QuestSurface {
    if (state.hidden && state.surface !== "log") return "none";
    if (state.surface === "pill") return suppression.pill ? "none" : "pill";
    if (state.surface === "none") return "none";
    return suppression.surfaces ? "none" : state.surface;
}
