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

/**
 * Who gave a quest, frozen when it was offered: the game only knows the people near the player, so the live host
 * comes and goes as they walk. A bot keeps its uuid so its live Woka can be found again when it is near, and a
 * snapshot of its face (`portrait`, a data URL) for when it is not.
 */
export type QuestGiver =
    | { kind: "bot"; name: string; uuid?: string; portrait?: string }
    | { kind: "area"; name: string };

/** Where a quest was accepted: the panel and Orbit say "{giver} · {room}" wherever the player is now. */
export interface QuestOrigin {
    room: string;
    /** Null: the room itself offered it. */
    giver: QuestGiver | null;
    /** The room's address, to go back to it from anywhere ("Go to {room}"). */
    url?: string;
}

export interface QuestEntry {
    accepted: boolean;
    done: boolean;
    paused: QuestPauseReason | null;
    acceptedAt: number | null;
    doneAt: number | null;
    origin: QuestOrigin | null;
}

/**
 * What the dock shows. "none" is an empty dock (the Quests pill still rests there when the room offers something).
 * The panel ("log", the quest log) opens above the pill. A "celebration" plays a completion.
 */
export type QuestSurface = "none" | "invitation" | "pill" | "log" | "celebration";
export type QuestVisibleSurface = QuestSurface;
export type QuestStatus = "available" | "accepted" | "tracked" | "done";

export interface QuestState {
    version: 1;
    quests: Record<QuestPath, QuestEntry>;
    /** The quest on the map: its target is marked and its objective is on the pill. */
    tracked: QuestPath | null;
    /**
     * "Not now" on the invitation: not offered again on this page (the panel still lists what is available). Never
     * stored: a refresh offers again.
     */
    declined: boolean;
    /**
     * How many times the invitation has been shown and left unanswered. Once more is allowed after it faded; an
     * answered offer (Not now) does not count.
     */
    invitationSeen: number;
    /** Who offered the quests when the invitation was shown, and where: what an acceptance freezes as its origin. */
    offeredBy: QuestOrigin | null;
    /** The area Explore asks for, fixed when it was accepted so walking around never moves the goal. */
    exploreArea: QuestAreaRef | null;
    /** Completions of the tracked quest waiting for a moment when they can be celebrated. */
    pending: QuestPath[];
    /** The completion being celebrated; null with the "celebration" surface means the whole chapter. */
    celebrating: QuestPath | null;
    /** The chapter's own celebration has played (once per browser). */
    chapterCelebrated: boolean;
    surface: QuestSurface;
    /** Something happened the person has not seen yet: a dot on the Quests row. */
    news: boolean;
}

export const MAX_INVITATION_SHOWS = 2;

export interface QuestAreaRef {
    id: string;
    name: string;
}

export type QuestEvent =
    | { type: "invitation-shown"; origin?: QuestOrigin }
    | { type: "invitation-faded" }
    | { type: "decline" }
    | { type: "accept"; path: QuestPath; now: number; exploreArea?: QuestAreaRef; origin?: QuestOrigin }
    | { type: "track"; path: QuestPath }
    | { type: "abandon"; path: QuestPath }
    | { type: "open-log" }
    | { type: "toggle-log" }
    | { type: "close" }
    | { type: "complete"; path: QuestPath; now: number }
    | { type: "pause"; path: QuestPath; reason: QuestPauseReason }
    | { type: "resume"; path: QuestPath }
    | { type: "news" }
    | { type: "celebration-settled" }
    | { type: "reset" };

export function emptyEntry(): QuestEntry {
    return {
        accepted: false,
        done: false,
        paused: null,
        acceptedAt: null,
        doneAt: null,
        origin: null,
    };
}

export function initialQuestState(): QuestState {
    return {
        version: 1,
        quests: { meet: emptyEntry(), explore: emptyEntry(), build: emptyEntry() },
        tracked: null,
        declined: false,
        invitationSeen: 0,
        offeredBy: null,
        exploreArea: null,
        pending: [],
        celebrating: null,
        chapterCelebrated: false,
        surface: "none",
        news: false,
    };
}

export function isQuestPath(value: unknown): value is QuestPath {
    return typeof value === "string" && (QUEST_PATHS as readonly string[]).includes(value);
}

export function anyAccepted(state: QuestState): boolean {
    return QUEST_PATHS.some((path) => state.quests[path].accepted);
}

export function anyDone(state: QuestState): boolean {
    return QUEST_PATHS.some((path) => state.quests[path].done);
}

export function allDone(state: QuestState): boolean {
    return QUEST_PATHS.every((path) => state.quests[path].done);
}

export function doneCount(state: QuestState): number {
    return QUEST_PATHS.filter((path) => state.quests[path].done).length;
}

export function questStatus(state: QuestState, path: QuestPath): QuestStatus {
    const entry = state.quests[path];
    if (entry.done) return "done";
    if (state.tracked === path) return "tracked";
    return entry.accepted ? "accepted" : "available";
}

/** The quest whose target is marked on the map: the tracked one, not done (its celebration waiting). */
export function markedQuestPath(state: QuestState): QuestPath | null {
    if (!state.tracked || state.quests[state.tracked].done) return null;
    return state.tracked;
}

/** Accepted and not done nor tracked: the count on the Quests row when nothing is tracked. */
export function acceptedUntrackedCount(state: QuestState): number {
    return QUEST_PATHS.filter((path) => questStatus(state, path) === "accepted").length;
}

/** The surface the dock rests on when nothing else is open. */
export function restingSurface(state: QuestState): QuestSurface {
    return state.tracked ? "pill" : "none";
}

/**
 * Whether the arrival invitation may be shown now. Presence, suppression, deep links and timing are the caller's.
 */
export function canOfferInvitation(state: QuestState): boolean {
    return (
        !state.declined &&
        state.invitationSeen < MAX_INVITATION_SHOWS &&
        !anyAccepted(state) &&
        state.surface === "none"
    );
}

export function cloneOrigin(origin: QuestOrigin): QuestOrigin {
    return {
        room: origin.room,
        giver: origin.giver ? { ...origin.giver } : null,
        ...(origin.url ? { url: origin.url } : {}),
    };
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

export function reduceQuest(previous: QuestState, event: QuestEvent): QuestState {
    if (event.type === "reset") return initialQuestState();
    const state = clone(previous);
    switch (event.type) {
        case "invitation-shown":
            if (!canOfferInvitation(previous)) return previous;
            state.invitationSeen += 1;
            state.offeredBy = event.origin ? cloneOrigin(event.origin) : null;
            state.surface = "invitation";
            return state;
        case "invitation-faded":
            if (state.surface !== "invitation") return previous;
            if (anyAccepted(state)) return previous;
            state.surface = "none";
            state.news = true;
            return state;
        case "decline":
            state.declined = true;
            // An answered offer is not a faded one: it never counts against the limit, so a refresh offers again.
            state.invitationSeen = Math.max(0, state.invitationSeen - 1);
            state.surface = "none";
            return state;
        case "accept": {
            const entry = state.quests[event.path];
            if (entry.done) return previous;
            if (!entry.accepted) {
                entry.accepted = true;
                entry.acceptedAt = event.now;
                entry.origin = event.origin ? cloneOrigin(event.origin) : null;
            }
            if (event.path === "explore" && event.exploreArea) state.exploreArea = { ...event.exploreArea };
            // The newest quest goes on the map. Accepted from the panel, the panel stays open on it, with the way
            // there and what to do; accepted anywhere else, the pill shows it.
            state.tracked = event.path;
            if (state.surface !== "log") state.surface = restingSurface(state);
            state.news = false;
            return state;
        }
        case "track": {
            const entry = state.quests[event.path];
            if (!entry.accepted || entry.done || state.tracked === event.path) return previous;
            // Shown on the map from the log: the log stays open on that quest.
            state.tracked = event.path;
            state.news = false;
            return state;
        }
        case "abandon": {
            const entry = state.quests[event.path];
            if (!entry.accepted || entry.done) return previous;
            state.quests[event.path] = emptyEntry();
            if (event.path === "explore") state.exploreArea = null;
            state.pending = state.pending.filter((path) => path !== event.path);
            // The map keeps showing something while anything is in progress.
            if (state.tracked === event.path) {
                state.tracked =
                    QUEST_PATHS.find((path) => state.quests[path].accepted && !state.quests[path].done) ?? null;
            }
            if (state.surface === "pill" && !state.tracked) state.surface = "none";
            return state;
        }
        case "open-log":
            if (state.surface === "log") return previous;
            // Opening the log over a celebration ends it, as tapping it away would: the chapter's counts as played.
            if (state.surface === "celebration" && state.celebrating === null) state.chapterCelebrated = true;
            state.celebrating = null;
            state.surface = "log";
            state.news = false;
            return state;
        case "toggle-log":
            return reduceQuest(previous, { type: state.surface === "log" ? "close" : "open-log" });
        case "close":
            // Only the log closes: the invitation is answered, a celebration settles by itself.
            if (state.surface !== "log") return previous;
            state.surface = restingSurface(state);
            return state;
        case "complete": {
            const entry = state.quests[event.path];
            if (!entry.accepted || entry.done) return previous;
            entry.done = true;
            entry.paused = null;
            entry.doneAt = event.now;
            // Every finished quest earns its celebration, on the map or not.
            if (!state.pending.includes(event.path)) state.pending.push(event.path);
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
        case "celebration-settled":
            if (state.surface !== "celebration") return previous;
            // The last quest's celebration, with the whole chapter now done: the chapter's own follows once.
            if (
                state.celebrating !== null &&
                allDone(state) &&
                !state.chapterCelebrated &&
                state.pending.length === 0
            ) {
                state.celebrating = null;
                return state;
            }
            if (state.celebrating === null) state.chapterCelebrated = true;
            state.celebrating = null;
            // Then the log, with the finished quest ticked and what is left to do.
            state.surface = "log";
            return state;
    }
    return previous;
}

/**
 * Plays the next waiting completion if the dock is free. `blocked` is true while surfaces are suppressed or the
 * person is busy (a call, Do not disturb, typing): the completion stays recorded and waits. An open quest panel
 * doesn't hold it back: the celebration plays at once and hands back to the panel.
 */
export function revealPending(previous: QuestState, blocked: boolean): QuestState {
    const state = previous;
    if (blocked || state.pending.length === 0 || state.surface === "celebration") return state;
    const [celebrating, ...pending] = state.pending;
    return {
        ...state,
        celebrating,
        pending,
        surface: "celebration",
        tracked: state.tracked === celebrating ? null : state.tracked,
    };
}

/** Whether the panel has anything to show: something to start here, something accepted, or something done. */
export function questsOnOffer(state: QuestState, available: readonly QuestPath[], ready: boolean): boolean {
    return ready && (available.length > 0 || acceptedUntrackedCount(state) > 0 || anyDone(state));
}

/**
 * What the dock actually renders, given what is covering the game right now. With nothing tracked, the Quests pill
 * still rests there as long as the room offers something (`offers`): a room with nothing to do, or a map still
 * loading, shows no pill (the Quests menu row is always there).
 */
export function visibleSurface(
    state: QuestState,
    suppression: { surfaces: boolean; pill: boolean },
    offers = true
): QuestVisibleSurface {
    if (state.surface === "pill" || state.surface === "none") {
        if (suppression.pill) return "none";
        return state.tracked || offers ? "pill" : "none";
    }
    return suppression.surfaces ? "none" : state.surface;
}
