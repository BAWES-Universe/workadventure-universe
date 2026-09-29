import type {
    QuestEngineAction,
    QuestEngineClient,
    QuestEngineQuest,
    QuestEngineStatus,
} from "../../Quests/QuestEngine";
import { parseEngineQuests, questPathOfEngineId } from "../../Quests/QuestEngine";
import type { QuestPath } from "../../Quests/QuestModel";

/** Makes a request to Orbit as the signed-in player (their Orbit session); throws when Orbit refuses. */
export type OrbitRequest = (endpoint: string, init?: RequestInit) => Promise<Response>;

/**
 * Orbit's quest engine routes for the signed-in player (workadventure-universe-admin #202, PR #231):
 * - GET    /api/me/quests[?roomId=]            the log, the tracked quest and its revision
 * - POST   /api/me/quests/accept               { key, roomId? }
 * - PUT    /api/me/quests/tracked              { progressId | null, revision }, 409 when another tab moved first
 * - POST   /api/me/quests/{progressId}/stop
 * - POST   /api/me/quests/observations         { eventId, action, subject?, roomId?, occurredAt? }
 */
export const QUEST_ENGINE_PATH = "/api/me/quests";

/** The actions the engine's Welcome chapter objectives wait for (WELCOME_ACTIONS in Orbit). */
export const WELCOME_OBSERVED_ACTIONS: Readonly<Record<QuestPath, string>> = {
    meet: "hello-exchanged",
    explore: "area-entered",
    build: "entity-placed",
};

/** Orbit's room ids are short; a longer id is not one of them and is left out. */
const MAX_ROOM_ID_LENGTH = 64;

/** One progress row of GET /api/me/quests, the fields the game reads. */
interface EngineProgressRow {
    id: string;
    key: string;
    status: string;
    acceptedAt: string | null;
    completedAt: string | null;
}

/** The engine's status in the game's three words. A stopped, expired or retired quest is not in progress here. */
export function engineStatusOf(status: string): QuestEngineStatus {
    if (status === "COMPLETED") return "done";
    if (status === "ACCEPTED" || status === "PAUSED") return "in-progress";
    return "not-started";
}

function epochOrNull(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
}

function isRow(value: unknown): value is EngineProgressRow {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.key === "string" && typeof row.status === "string";
}

export interface EngineLog {
    quests: QuestEngineQuest[];
    /** Progress row per Welcome quest, for the routes that take one. */
    progressIds: Map<QuestPath, string>;
    tracked: { progressId: string | null; revision: number };
}

/** Reads GET /api/me/quests: the newest row per Welcome quest wins (rows come newest first). */
export function parseEngineLog(body: unknown): EngineLog | null {
    if (typeof body !== "object" || body === null) return null;
    const raw = body as { quests?: unknown; tracked?: unknown };
    if (!Array.isArray(raw.quests)) return null;
    const trackedRaw = (typeof raw.tracked === "object" && raw.tracked !== null ? raw.tracked : {}) as Record<
        string,
        unknown
    >;
    const trackedId = typeof trackedRaw.progressId === "string" ? trackedRaw.progressId : null;
    const revision =
        typeof trackedRaw.revision === "number" && Number.isInteger(trackedRaw.revision) ? trackedRaw.revision : 0;
    const progressIds = new Map<QuestPath, string>();
    const rows: unknown[] = [];
    for (const row of raw.quests) {
        if (!isRow(row)) continue;
        const path = questPathOfEngineId(row.key);
        if (!path || progressIds.has(path)) continue;
        progressIds.set(path, row.id);
        rows.push({
            id: row.key,
            status: engineStatusOf(row.status),
            tracked: row.id === trackedId,
            acceptedAt: epochOrNull(row.acceptedAt),
            doneAt: epochOrNull(row.completedAt),
        });
    }
    return { quests: parseEngineQuests(rows) ?? [], progressIds, tracked: { progressId: trackedId, revision } };
}

function newEventId(): string {
    const random =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `game:${random}`;
}

/**
 * The quest engine over Orbit's HTTP API. Keeps the last log it read, for the progress ids and the tracked revision
 * the engine's routes take; reads it again when it lacks one or another tab moved first. Every observation carries
 * its own event id, so the engine applies it once.
 */
export function createQuestEngineHttpClient(request: OrbitRequest, roomId: () => string | null): QuestEngineClient {
    let log: EngineLog | null = null;

    function room(): string | undefined {
        const id = roomId();
        return id && id.length <= MAX_ROOM_ID_LENGTH ? id : undefined;
    }

    async function readLog(): Promise<EngineLog | null> {
        const id = room();
        const query = id ? `?roomId=${encodeURIComponent(id)}` : "";
        const response = await request(`${QUEST_ENGINE_PATH}${query}`, { method: "GET" });
        log = parseEngineLog(await response.json());
        return log;
    }

    async function progressIdOf(path: QuestPath): Promise<string | null> {
        return log?.progressIds.get(path) ?? (await readLog())?.progressIds.get(path) ?? null;
    }

    async function putTracked(path: QuestPath): Promise<void> {
        const progressId = await progressIdOf(path);
        if (!progressId) return;
        const revision = log?.tracked.revision ?? 0;
        const response = await request(`${QUEST_ENGINE_PATH}/tracked`, {
            method: "PUT",
            body: JSON.stringify({ progressId, revision }),
        });
        const next = (await response.json()) as { revision?: unknown };
        if (log && typeof next.revision === "number") log.tracked = { progressId, revision: next.revision };
    }

    async function track(path: QuestPath): Promise<void> {
        try {
            await putTracked(path);
        } catch {
            // Most likely another tab or device moved first (409): read where things stand and try once more.
            await readLog();
            await putTracked(path);
        }
    }

    async function send(action: QuestEngineAction): Promise<void> {
        const path = questPathOfEngineId(action.questId);
        if (!path) return;
        switch (action.action) {
            case "accept": {
                await request(`${QUEST_ENGINE_PATH}/accept`, {
                    method: "POST",
                    body: JSON.stringify({ key: action.questId, roomId: room() }),
                });
                // The new row's id is only known from the log.
                log = null;
                return;
            }
            case "track":
                return track(path);
            case "stop": {
                const progressId = await progressIdOf(path);
                if (!progressId) return;
                await request(`${QUEST_ENGINE_PATH}/${encodeURIComponent(progressId)}/stop`, { method: "POST" });
                return;
            }
            case "observe": {
                await request(`${QUEST_ENGINE_PATH}/observations`, {
                    method: "POST",
                    body: JSON.stringify({
                        eventId: newEventId(),
                        action: WELCOME_OBSERVED_ACTIONS[path],
                        roomId: room(),
                        occurredAt: new Date(action.observedAt).toISOString(),
                    }),
                });
                return;
            }
        }
    }

    // One report at a time, in the order the player acted: an accept lands before the track that follows it.
    let queue: Promise<unknown> = Promise.resolve();

    return {
        async list() {
            try {
                return (await readLog())?.quests ?? null;
            } catch (error) {
                console.warn("Quests: the engine's list is not available", error);
                return null;
            }
        },
        send(action: QuestEngineAction) {
            const result = queue.then(
                () => send(action).then(() => true),
                () => send(action).then(() => true)
            );
            queue = result.catch(() => undefined);
            return result.catch((error) => {
                console.warn(`Quests: the engine did not take "${action.action}"`, error);
                return false;
            });
        },
    };
}
