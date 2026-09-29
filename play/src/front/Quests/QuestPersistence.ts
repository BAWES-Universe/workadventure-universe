import type { QuestAreaRef, QuestEntry, QuestGiver, QuestOrigin, QuestPath, QuestState } from "./QuestModel";
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

/** The part of the state that outlives the page. Surfaces and celebrations in flight do not. */
export interface StoredQuestProgress {
    version: 1;
    quests: Record<QuestPath, QuestEntry>;
    tracked: QuestPath | null;
    exploreArea: QuestAreaRef | null;
    pending: QuestPath[];
    news: boolean;
    chapterCelebrated: boolean;
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
const MAX_ROOM_URL_LENGTH = 512;
/** A Woka snapshot is a small PNG data URL; anything bigger is dropped rather than kept. */
const MAX_PORTRAIT_LENGTH = 64 * 1024;

function validName(value: unknown): value is string {
    return typeof value === "string" && value.trim() !== "" && value.length <= MAX_ORIGIN_FIELD_LENGTH;
}

function validPortrait(value: unknown): value is string {
    return typeof value === "string" && value.startsWith("data:image/") && value.length <= MAX_PORTRAIT_LENGTH;
}

function parseGiver(raw: unknown): QuestGiver | null {
    // Saves from before givers kept their kind held the name alone: the default host was the room's first bot.
    if (validName(raw)) return { kind: "bot", name: raw };
    if (!isRecord(raw) || !validName(raw.name)) return null;
    if (raw.kind === "area") return { kind: "area", name: raw.name };
    if (raw.kind !== "bot") return null;
    const giver: QuestGiver = { kind: "bot", name: raw.name };
    if (typeof raw.uuid === "string" && raw.uuid && raw.uuid.length <= MAX_ORIGIN_FIELD_LENGTH) giver.uuid = raw.uuid;
    if (validPortrait(raw.portrait)) giver.portrait = raw.portrait;
    return giver;
}

/**
 * A room's address to go back to: this game's own origin only, over http(s). Anything else (another site, a script
 * URL, too long) is dropped, and the quest simply offers no way back.
 */
function parseRoomUrl(raw: unknown): string | undefined {
    if (typeof raw !== "string" || raw.length > MAX_ROOM_URL_LENGTH) return undefined;
    try {
        const url = new URL(raw);
        if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
        if (typeof window !== "undefined" && url.origin !== window.location.origin) return undefined;
        return url.toString();
    } catch {
        return undefined;
    }
}

function parseOrigin(raw: unknown): QuestOrigin | null {
    if (!isRecord(raw)) return null;
    const { room, giver } = raw;
    if (typeof room !== "string" || room.length > MAX_ORIGIN_FIELD_LENGTH) return null;
    const url = parseRoomUrl(raw.url);
    return { room, giver: parseGiver(giver), ...(url ? { url } : {}) };
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
    // Every finished quest waiting for its celebration (see revealPending), once each.
    const pending = Array.isArray(data.pending)
        ? [...new Set(data.pending.filter((path): path is QuestPath => isQuestPath(path) && quests[path].done))]
        : [];
    return {
        version: 1,
        quests,
        tracked,
        exploreArea: quests.explore.accepted ? parseAreaRef(data.exploreArea) : null,
        pending,
        news: data.news === true,
        chapterCelebrated: data.chapterCelebrated === true,
    };
}

export function serializeProgress(state: QuestState): string {
    // A celebration on screen when the page closes plays again after a reload, first.
    const celebrating = state.surface === "celebration" ? state.celebrating : null;
    const pending = celebrating
        ? [celebrating, ...state.pending.filter((path) => path !== celebrating)]
        : state.pending;
    const tracked = state.tracked;
    const stored: StoredQuestProgress = {
        version: 1,
        quests: state.quests,
        tracked,
        exploreArea: state.exploreArea,
        pending,
        news: state.news,
        chapterCelebrated: state.chapterCelebrated,
    };
    return JSON.stringify(stored);
}

export function parseInvitationSeen(raw: string | null): number {
    const value = raw === null ? NaN : Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.min(value, MAX_INVITATION_SHOWS);
}

/**
 * Builds the starting state from storage. A tracked quest comes back as its pill (a waiting celebration still plays
 * from there); otherwise the dock starts on its resting pill and arrival decides what to show. "Not now" is never
 * stored: a refresh offers again (an unanswered, faded invitation is what `invitationSeen` limits).
 */
export function restoreQuestState(storage: StorageLike | undefined): QuestState {
    const state = initialQuestState();
    if (!storage) return state;
    try {
        const progress = parseStoredProgress(storage.getItem(QUEST_STATE_KEY));
        if (progress) {
            state.quests = progress.quests;
            state.exploreArea = progress.exploreArea;
            state.news = progress.news;
            state.chapterCelebrated = progress.chapterCelebrated;
            // Waiting celebrations come back and play once the dock is free; the quest on the map stays there.
            state.tracked = progress.tracked;
            state.pending = progress.pending;
            state.surface = restingSurface(state);
        }
        state.invitationSeen = parseInvitationSeen(storage.getItem(QUEST_INVITATION_SEEN_KEY));
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
    } catch (error) {
        // Private mode or a full quota: progress stays for this page only.
        console.warn("Quests: could not save progress", error);
    }
}

export function clearQuestStorage(storage: StorageLike | undefined): void {
    try {
        storage?.removeItem(QUEST_STATE_KEY);
        storage?.removeItem(QUEST_INVITATION_SEEN_KEY);
    } catch (error) {
        console.warn("Quests: could not clear saved progress", error);
    }
}
