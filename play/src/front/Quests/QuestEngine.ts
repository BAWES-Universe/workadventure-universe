import { writable } from "svelte/store";
import type { QuestEvent, QuestPath, QuestState } from "./QuestModel";
import { emptyEntry, isQuestPath, QUEST_PATHS, restingSurface } from "./QuestModel";

/**
 * The game's end of Orbit's quest engine (workadventure-universe-admin #202): where a signed-in player's quest
 * progress is kept, so it follows them to another browser or device. The browser's own copy (QuestPersistence)
 * stays as the cache the dock starts from; the engine's word is merged over it once it answers.
 *
 * The game only reports what the player did (accept, track, stop) and what it saw them do (an observation that
 * finishes a quest). The engine decides what counts: a finished quest there is finished here, never the reverse.
 */

/** A fixed quest key, as Orbit and analytics name it: "welcome.meet". */
export type QuestEngineId = `welcome.${QuestPath}`;

export type QuestEngineStatus = "not-started" | "in-progress" | "done";

export interface QuestEngineQuest {
    id: QuestEngineId;
    status: QuestEngineStatus;
    tracked: boolean;
    /** Epoch milliseconds. */
    acceptedAt: number | null;
    doneAt: number | null;
}

export type QuestEngineAction =
    | { action: "accept"; questId: QuestEngineId }
    | { action: "track"; questId: QuestEngineId }
    | { action: "stop"; questId: QuestEngineId }
    | { action: "observe"; questId: QuestEngineId; observedAt: number };

export interface QuestEngineClient {
    /** The player's quests as the engine has them; null when Orbit could not answer (the cache stays as it is). */
    list(): Promise<QuestEngineQuest[] | null>;
    /** Reports one thing the player did. Resolves false when Orbit refused or could not be reached. */
    send(action: QuestEngineAction): Promise<boolean>;
}

/**
 * The engine for this player, when there is one: null for a guest or a game without Orbit, and then quests live in
 * this browser only, as before. Set by the Orbit module, so the quest code never depends on it.
 */
export const questEngineStore = writable<QuestEngineClient | null>(null);

export function questEngineId(path: QuestPath): QuestEngineId {
    return `welcome.${path}`;
}

export function questPathOfEngineId(id: unknown): QuestPath | null {
    if (typeof id !== "string" || !id.startsWith("welcome.")) return null;
    const path = id.slice("welcome.".length);
    return isQuestPath(path) ? path : null;
}

/** What the engine hears about a transition the dock just made; null for the dock's own business (surfaces, news). */
export function engineActionFor(event: QuestEvent): QuestEngineAction | null {
    switch (event.type) {
        case "accept":
            return { action: "accept", questId: questEngineId(event.path) };
        case "track":
            return { action: "track", questId: questEngineId(event.path) };
        case "abandon":
            return { action: "stop", questId: questEngineId(event.path) };
        case "complete":
            return { action: "observe", questId: questEngineId(event.path), observedAt: event.now };
        default:
            return null;
    }
}

const MAX_ENGINE_QUESTS = 64;

function finiteOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reads the engine's list defensively: unknown quests, statuses or shapes are left out, never trusted. */
export function parseEngineQuests(raw: unknown): QuestEngineQuest[] | null {
    const list = typeof raw === "object" && raw !== null && "quests" in raw ? (raw as { quests: unknown }).quests : raw;
    if (!Array.isArray(list)) return null;
    const quests: QuestEngineQuest[] = [];
    for (const item of list.slice(0, MAX_ENGINE_QUESTS)) {
        if (typeof item !== "object" || item === null) continue;
        const record = item as Record<string, unknown>;
        const path = questPathOfEngineId(record.id);
        const status = record.status;
        if (!path || (status !== "not-started" && status !== "in-progress" && status !== "done")) continue;
        quests.push({
            id: questEngineId(path),
            status,
            tracked: record.tracked === true && status === "in-progress",
            acceptedAt: finiteOrNull(record.acceptedAt),
            doneAt: status === "done" ? finiteOrNull(record.doneAt) : null,
        });
    }
    return quests;
}

/**
 * Lays the engine's progress over the browser's. The engine wins on what was accepted and finished; a quest it has
 * never heard of keeps the browser's progress (reported again by `unsyncedActions`). A quest finished elsewhere is
 * finished here quietly: its celebration played where it happened. Returns the same object when nothing changes.
 */
export function mergeEngineProgress(state: QuestState, engine: readonly QuestEngineQuest[]): QuestState {
    const byPath = new Map<QuestPath, QuestEngineQuest>();
    for (const quest of engine) {
        const path = questPathOfEngineId(quest.id);
        if (path) byPath.set(path, quest);
    }
    let changed = false;
    const quests = { ...state.quests };
    for (const path of QUEST_PATHS) {
        const remote = byPath.get(path);
        const local = quests[path];
        if (!remote || remote.status === "not-started") continue;
        if (remote.status === "done" && !local.done) {
            quests[path] = {
                ...local,
                accepted: true,
                done: true,
                paused: null,
                acceptedAt: local.acceptedAt ?? remote.acceptedAt,
                doneAt: remote.doneAt ?? Date.now(),
            };
            changed = true;
        } else if (remote.status === "in-progress" && !local.accepted) {
            quests[path] = { ...emptyEntry(), accepted: true, acceptedAt: remote.acceptedAt };
            changed = true;
        }
    }
    const remoteTracked = QUEST_PATHS.find((path) => byPath.get(path)?.tracked) ?? null;
    let tracked = state.tracked && !quests[state.tracked].done ? state.tracked : null;
    if (tracked === null && remoteTracked !== null && !quests[remoteTracked].done) tracked = remoteTracked;
    if (tracked !== state.tracked) changed = true;
    if (!changed) return state;
    const next: QuestState = { ...state, quests, tracked };
    // Only a resting dock moves; an invitation or a celebration on screen stays until it is answered.
    if (state.surface === restingSurface(state)) next.surface = restingSurface(next);
    return next;
}

/**
 * What the browser knows that the engine does not yet: progress made while signed out or offline, or before the
 * engine existed. Sent once after the first merge so the engine catches up; the engine ignores repeats.
 */
export function unsyncedActions(state: QuestState, engine: readonly QuestEngineQuest[]): QuestEngineAction[] {
    const actions: QuestEngineAction[] = [];
    for (const path of QUEST_PATHS) {
        const local = state.quests[path];
        const remote = engine.find((quest) => quest.id === questEngineId(path));
        const questId = questEngineId(path);
        if (!local.accepted) continue;
        if (!remote || remote.status === "not-started") actions.push({ action: "accept", questId });
        if (local.done && remote?.status !== "done") {
            actions.push({ action: "observe", questId, observedAt: local.doneAt ?? Date.now() });
        }
    }
    if (state.tracked && !engine.some((quest) => quest.tracked && quest.id === questEngineId(state.tracked!))) {
        actions.push({ action: "track", questId: questEngineId(state.tracked) });
    }
    return actions;
}
