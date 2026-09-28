import type { QuestSim } from "./QuestDevSettings";
import type { QuestHostOverride } from "./QuestHash";
import type { QuestOrigin, QuestPath, QuestState } from "./QuestModel";
import { QUEST_PATHS } from "./QuestModel";

/** Someone on this map other than the player (own other tabs excluded). */
export interface QuestPresent {
    userId: number;
    uuid: string;
    name: string;
    isBot: boolean;
}

export interface QuestArea {
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The host is a role, not a fixed character: whoever fits in this room right now. */
export type QuestHost =
    | { kind: "bot"; userId: number; uuid: string; name: string }
    | { kind: "area"; areaId: string; name: string }
    | { kind: "none" };

export interface ExploreTarget {
    area: QuestArea;
    /** The only candidate already contains the player: the objective is met on acceptance. */
    alreadyInside: boolean;
}

/** What this room offers, re-read whenever people come and go. */
export interface QuestWorld {
    /** A map is loaded and its detectors are armed. */
    ready: boolean;
    roomName: string | undefined;
    host: QuestHost;
    /** People and bots on this map, the player's own tabs excluded. */
    present: QuestPresent[];
    exploreTarget: ExploreTarget | undefined;
    /** Same gate as the Build button (mapEditorMenuVisibleStore). */
    canBuild: boolean;
}

export const EMPTY_QUEST_WORLD: QuestWorld = {
    ready: false,
    roomName: undefined,
    host: { kind: "none" },
    present: [],
    exploreTarget: undefined,
    canBuild: false,
};

function contains(area: QuestArea, point: { x: number; y: number }): boolean {
    return point.x >= area.x && point.x <= area.x + area.width && point.y >= area.y && point.y <= area.y + area.height;
}

function distanceToCentre(area: QuestArea, point: { x: number; y: number }): number {
    return Math.hypot(area.x + area.width / 2 - point.x, area.y + area.height / 2 - point.y);
}

/** Areas a newcomer can find by name: named, and not closed to them. */
export function namedOpenAreas(areas: Iterable<QuestArea>, closedIds: ReadonlySet<string>): QuestArea[] {
    const result: QuestArea[] = [];
    for (const area of areas) {
        if (closedIds.has(area.id)) continue;
        if (!area.name || !area.name.trim()) continue;
        if (area.width <= 0 || area.height <= 0) continue;
        result.push(area);
    }
    return result;
}

/**
 * The area to find: the one the owner published if it is here, else the nearest one the player is not already in.
 * When every candidate contains the player, the nearest of those, marked as already met.
 */
export function pickExploreTarget(
    candidates: readonly QuestArea[],
    player: { x: number; y: number } | undefined,
    preferredName?: string
): ExploreTarget | undefined {
    if (candidates.length === 0) return undefined;
    const inside = (area: QuestArea) => (player ? contains(area, player) : false);
    if (preferredName) {
        const wanted = preferredName.trim().toLocaleLowerCase();
        const preferred = candidates.find((area) => area.name.trim().toLocaleLowerCase() === wanted);
        if (preferred) return { area: preferred, alreadyInside: inside(preferred) };
    }
    const byDistance = [...candidates].sort((a, b) =>
        player ? distanceToCentre(a, player) - distanceToCentre(b, player) : a.name.localeCompare(b.name)
    );
    const outside = byDistance.find((area) => !inside(area));
    if (outside) return { area: outside, alreadyInside: false };
    return { area: byDistance[0], alreadyInside: true };
}

/**
 * Who greets newcomers: the owner's choice from Orbit's Visit link (the hash) when it is here, else the first bot on
 * the map, else the first named area with the `area` simulation, else nobody. Bots are never picked by name.
 */
export function resolveQuestHost(
    sim: QuestSim,
    present: readonly QuestPresent[],
    areas: readonly QuestArea[],
    override?: QuestHostOverride
): QuestHost {
    if (sim === "empty") return { kind: "none" };
    const bots = present.filter((person) => person.isBot);
    const asBot = (bot: QuestPresent): QuestHost => ({
        kind: "bot",
        userId: bot.userId,
        uuid: bot.uuid,
        name: bot.name,
    });
    const asArea = (area: QuestArea): QuestHost => ({ kind: "area", areaId: area.id, name: area.name });

    if (override?.kind === "none") return { kind: "none" };
    if (override?.kind === "bot") {
        const bot = bots.find((candidate) => candidate.uuid === override.uuid);
        if (bot) return asBot(bot);
    }
    if (override?.kind === "area") {
        const wanted = override.name.toLocaleLowerCase();
        const area = areas.find((candidate) => candidate.name.trim().toLocaleLowerCase() === wanted);
        if (area) return asArea(area);
    }

    if (bots[0]) return asBot(bots[0]);
    if (sim === "area") {
        const area = areas.find((candidate) => candidate.name.trim() !== "");
        if (area) return asArea(area);
    }
    return { kind: "none" };
}

/** Whether a path can be completed in this room right now. For now every bot counts as conversational. */
export function isPathCompletable(world: QuestWorld, path: QuestPath): boolean {
    switch (path) {
        case "meet":
            return world.present.length > 0;
        case "explore":
            return world.exploreTarget !== undefined;
        case "build":
            return world.canBuild;
    }
}

/** Paths that can be offered now: completable here, not accepted, not done. */
export function availablePaths(state: QuestState, world: QuestWorld, sim: QuestSim): QuestPath[] {
    if (sim === "empty" || !world.ready) return [];
    return QUEST_PATHS.filter((path) => {
        const entry = state.quests[path];
        return !entry.accepted && !entry.done && isPathCompletable(world, path);
    });
}

/** Builds the world as the `empty` simulation sees it: nobody, no areas. */
export function simulatedWorld(world: QuestWorld, sim: QuestSim): QuestWorld {
    if (sim !== "empty") return world;
    return { ...world, host: { kind: "none" }, present: [], exploreTarget: undefined, canBuild: false };
}

/** Who offers quests here and where: what an accepted quest keeps as its origin. */
export function questOrigin(world: QuestWorld): QuestOrigin {
    return { room: world.roomName ?? "", giver: world.host.kind === "none" ? null : world.host.name };
}
