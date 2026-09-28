import type { QuestAreaRef, QuestEntry, QuestOrigin, QuestPath, QuestState } from "./QuestModel";
import {
    emptyEntry,
    initialQuestState,
    isQuestPath,
    MAX_INVITATION_SHOWS,
    QUEST_PATHS,
    restingSurface,
} from "./QuestModel";

// Same naming as Orbit's preference keys, so the engine can move them server-side later.
export const QUEST_STATE_KEY = "quests.state";
export const QUEST_INVITATION_SEEN_KEY = "quests.invitationSeen";
export const QUEST_INVITATION_DECLINED_KEY = "quests.invitationDeclined";

/** The part of the state that outlives the page. Surfaces and payoffs in flight do not. */
export interface StoredQuestProgress {
    version: 1;
    quests: Record<QuestPath, QuestEntry>;
    tracked: QuestPath | null;
    hidden: boolean;
    exploreArea: QuestAreaRef | null;
    pending: QuestPath[];
    news: boolean;
    signInOfferSkipped: boolean;
}

const MAX_AREA_FIELD_LENGTH = 128;

function parseAreaRef(raw: unknown): QuestAreaRef | null {
    if (!isRecord(raw)) return null;
    const { id, name } = raw;
    if (typeof id !== "string" || typeof name !== "string") return null;
    if (!id || !name.trim() || id.length > MAX_AREA_FIELD_LENGTH || name.length > MAX_AREA_FIELD_LENGTH) return null;
    return { id, name };
}

const MAX_ORIGIN_FIELD_LENGTH = 128;

function parseOrigin(raw: unknown): QuestOrigin | null {
    if (!isRecord(raw)) return null;
    const { room, giver } = raw;
    if (typeof room !== "string" || room.length > MAX_ORIGIN_FIELD_LENGTH) return null;
    const validGiver = typeof giver === "string" && giver.trim() !== "" && giver.length <= MAX_ORIGIN_FIELD_LENGTH;
    return { room, giver: validGiver ? giver : null };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseEntry(raw: unknown): QuestEntry {
    if (!isRecord(raw)) return emptyEntry();
    const done = raw.done === true;
    const accepted = raw.accepted === true || done;
    if (!accepted) return emptyEntry();
    return {
        accepted,
        done,
        paused: !done && raw.paused === "no-eligible-target" ? "no-eligible-target" : null,
        acceptedAt: finiteOrNull(raw.acceptedAt),
        doneAt: done ? finiteOrNull(raw.doneAt) : null,
        viaShowMe: raw.viaShowMe === true,
        origin: parseOrigin(raw.origin),
    };
}

/**
 * Reads what a previous visit left in this browser. Anything malformed, from another version or edited by hand
 * falls back to a fresh start rather than a broken dock.
 */
export function parseStoredProgress(raw: string | null): StoredQuestProgress | null {
    if (!raw) return null;
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isRecord(data) || data.version !== 1) return null;
    const questsRaw = isRecord(data.quests) ? data.quests : {};
    const quests = {} as Record<QuestPath, QuestEntry>;
    for (const path of QUEST_PATHS) quests[path] = parseEntry(questsRaw[path]);
    const tracked =
        isQuestPath(data.tracked) && quests[data.tracked].accepted && !quests[data.tracked].done ? data.tracked : null;
    // A waiting payoff only survives for the quest still tracked when it finished (see revealPending).
    const pending = Array.isArray(data.pending)
        ? [...new Set(data.pending.filter((path): path is QuestPath => isQuestPath(path) && quests[path].done))]
        : [];
    return {
        version: 1,
        quests,
        tracked,
        hidden: data.hidden === true,
        exploreArea: quests.explore.accepted ? parseAreaRef(data.exploreArea) : null,
        pending,
        news: data.news === true,
        signInOfferSkipped: data.signInOfferSkipped === true,
    };
}

export function serializeProgress(state: QuestState): string {
    // A waiting payoff belongs to the quest still tracked; once another quest is tracked it was superseded.
    const kept = state.pending.filter((path) => path === state.tracked);
    const pending = state.payoff ? [state.payoff, ...kept] : kept;
    // A payoff on screen had already released the tracked slot; keep it tracked so it can play again after a reload.
    const tracked = state.payoff ?? state.tracked;
    const stored: StoredQuestProgress = {
        version: 1,
        quests: state.quests,
        tracked,
        hidden: state.hidden,
        exploreArea: state.exploreArea,
        pending,
        news: state.news,
        signInOfferSkipped: state.signInOfferSkipped,
    };
    return JSON.stringify(stored);
}

export function parseInvitationSeen(raw: string | null): number {
    const value = raw === null ? NaN : Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.min(value, MAX_INVITATION_SHOWS);
}

/**
 * Builds the starting state from storage. A tracked quest comes back as its pill (a waiting payoff still plays from
 * there); otherwise the dock starts empty and arrival decides what to show.
 */
export function restoreQuestState(storage: StorageLike | undefined): QuestState {
    const state = initialQuestState();
    if (!storage) return state;
    try {
        const progress = parseStoredProgress(storage.getItem(QUEST_STATE_KEY));
        if (progress) {
            state.quests = progress.quests;
            state.hidden = progress.hidden;
            state.exploreArea = progress.exploreArea;
            state.news = progress.news;
            state.signInOfferSkipped = progress.signInOfferSkipped;
            // A done quest that was still waiting for its payoff comes back tracked, so it can still play.
            // If another quest is tracked, a saved payoff was superseded and must not take its place.
            const waiting = progress.tracked === null ? progress.pending[0] : undefined;
            state.tracked = waiting ?? progress.tracked;
            state.pending = waiting ? [waiting] : [];
            state.surface = restingSurface(state);
        }
        state.invitationSeen = parseInvitationSeen(storage.getItem(QUEST_INVITATION_SEEN_KEY));
        state.declined = storage.getItem(QUEST_INVITATION_DECLINED_KEY) === "true";
    } catch (error) {
        console.warn("Quests: could not read saved progress", error);
    }
    return state;
}

export function saveQuestState(storage: StorageLike | undefined, state: QuestState): void {
    if (!storage) return;
    try {
        storage.setItem(QUEST_STATE_KEY, serializeProgress(state));
        storage.setItem(QUEST_INVITATION_SEEN_KEY, String(state.invitationSeen));
        if (state.declined) storage.setItem(QUEST_INVITATION_DECLINED_KEY, "true");
        else storage.removeItem(QUEST_INVITATION_DECLINED_KEY);
    } catch (error) {
        // Private mode or a full quota: progress stays for this page only.
        console.warn("Quests: could not save progress", error);
    }
}

export function clearQuestStorage(storage: StorageLike | undefined): void {
    if (!storage) return;
    try {
        storage.removeItem(QUEST_STATE_KEY);
        storage.removeItem(QUEST_INVITATION_SEEN_KEY);
        storage.removeItem(QUEST_INVITATION_DECLINED_KEY);
    } catch (error) {
        console.warn("Quests: could not clear saved progress", error);
    }
}
