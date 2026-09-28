import type { TranslationFunctions } from "../../i18n/i18n-types";
import type { MeetProgress } from "./MeetExchange";
import type { Point } from "./QuestGeometry";
import { compassDirection, stepsBetween } from "./QuestGeometry";
import type { QuestOrigin, QuestPath, QuestState } from "./QuestModel";
import { QUEST_MINUTES, QUEST_PATHS, questStatus } from "./QuestModel";
import type { QuestWorld } from "./QuestWorld";
import { questOrigin } from "./QuestWorld";

/**
 * The words for one quest, from the `quest` namespace. Every sentence is a whole translated string with its names
 * as parameters: nothing is assembled from pieces, so each language keeps its own word order.
 */
type T = TranslationFunctions;

/** The area Explore asks for: the one fixed at acceptance, else the one this room would offer now. */
export function exploreAreaName(state: QuestState, world: QuestWorld): string {
    return state.exploreArea?.name ?? world.exploreTarget?.area.name ?? "";
}

export function questTitle(t: T, path: QuestPath): string {
    return t.quest.paths[path].title();
}

export function questDescription(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    if (path === "explore") return t.quest.paths.explore.description({ area: exploreAreaName(state, world) });
    return t.quest.paths[path].description();
}

/** The short objective on the pill and the card title ("Find the Courtyard"). */
export function questObjective(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    if (path === "explore") return t.quest.paths.explore.objective({ area: exploreAreaName(state, world) });
    return t.quest.paths[path].objective();
}

/** The card's one plain sentence. */
export function questBody(
    t: T,
    path: QuestPath,
    state: QuestState,
    world: QuestWorld,
    meetProgress: MeetProgress
): string {
    // Done, its payoff waiting for a quiet moment: the card already says how it ended.
    if (state.quests[path].done) return questPayoffLine(t, path, state, world);
    switch (path) {
        case "meet":
            if (state.quests.meet.paused) return t.quest.card.nobodyHere();
            return meetProgress === "sent" ? t.quest.paths.meet.waiting() : t.quest.paths.meet.body();
        case "explore":
            return t.quest.paths.explore.body({ area: exploreAreaName(state, world) });
        case "build":
            return t.quest.paths.build.body();
    }
}

/**
 * The one line when a quest is done. The giver frozen at acceptance speaks through the eyebrow, never through a
 * "Name:" prefix; a bot says it in person, the room says it neutrally.
 */
export function questPayoffLine(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    switch (path) {
        case "meet":
            return entryOrigin(state, path, world).giver?.kind === "bot"
                ? t.quest.paths.meet.payoff()
                : t.quest.paths.meet.payoffNeutral();
        case "explore":
            return t.quest.paths.explore.payoff({ area: exploreAreaName(state, world) });
        case "build":
            return t.quest.paths.build.payoff();
    }
}

/** The acknowledgement on a Done entry in the log. */
export function questLastTime(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    if (path === "explore") return t.quest.paths.explore.lastTime({ area: exploreAreaName(state, world) });
    return t.quest.paths[path].lastTime();
}

export function stampName(t: T, path: QuestPath): string {
    return t.quest.stamps[path]();
}

/** Who is speaking on the invitation: the live host's name, else the room's name, else "Welcome". */
export function questEyebrow(t: T, world: QuestWorld): string {
    if (world.host.kind !== "none") return world.host.name;
    return world.roomName || t.quest.welcome();
}

/** Who is speaking for one quest: the giver frozen when it was accepted, else its room, else "Welcome". */
export function questEyebrowFor(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    const origin = entryOrigin(state, path, world);
    return origin.giver?.name || origin.room || t.quest.welcome();
}

/** One path as a row of the options card. */
export interface QuestOptionRow {
    path: QuestPath;
    title: string;
    description: string;
    minutes: number;
}

/** One entry of the log, in words. */
export interface QuestLogEntry {
    path: QuestPath;
    status: "tracked" | "accepted" | "available" | "done";
    title: string;
    description: string;
    minutes: number;
    /** "From Guide · Lobby", or "Here · Lobby". */
    origin: string;
    /** "First Hello badge". */
    reward: string;
    /** "Needs: edit rights in this room", when there is a requirement. */
    requirement?: string;
    /** "Nobody's here right now" while paused. */
    note?: string;
    /** The host's acknowledgement on a Done entry. */
    lastTime?: string;
}

export function optionRows(t: T, paths: readonly QuestPath[], state: QuestState, world: QuestWorld): QuestOptionRow[] {
    return paths.map((path) => ({
        path,
        title: questTitle(t, path),
        description: questDescription(t, path, state, world),
        minutes: QUEST_MINUTES[path],
    }));
}

/**
 * Where an entry came from: frozen where it was accepted, else (available here, or saved before origins) who is
 * offering it now.
 */
export function entryOrigin(state: QuestState, path: QuestPath, world: QuestWorld): QuestOrigin {
    return state.quests[path].origin ?? questOrigin(world);
}

/** The log's entries: everything accepted or done, and what this room offers now. */
export function logEntries(
    t: T,
    state: QuestState,
    world: QuestWorld,
    available: readonly QuestPath[]
): QuestLogEntry[] {
    const entries: QuestLogEntry[] = [];
    for (const path of QUEST_PATHS) {
        const status = questStatus(state, path);
        if (status === "available" && !available.includes(path)) continue;
        const { room, giver } = entryOrigin(state, path, world);
        const origin = giver ? t.quest.log.fromHost({ host: giver.name, room }) : t.quest.log.here({ room });
        entries.push({
            path,
            status,
            title: questTitle(t, path),
            description: questDescription(t, path, state, world),
            minutes: QUEST_MINUTES[path],
            origin,
            reward: t.quest.stamps.badge({ stamp: stampName(t, path) }),
            requirement: path === "build" && status !== "done" ? t.quest.paths.build.needs() : undefined,
            note: status !== "done" && state.quests[path].paused ? t.quest.card.nobodyHere() : undefined,
            lastTime: status === "done" ? questLastTime(t, path, state, world) : undefined,
        });
    }
    return entries;
}

/**
 * Where the target is, in words, for people who can't see the marker: "The Courtyard is north-east of you, about 6
 * steps". Announced when the card opens.
 */
export function whereDescription(
    t: T,
    target: { name: string; position: Point } | undefined,
    player: Point | undefined,
    path: QuestPath,
    /** Explore's fixed area, named when it is not on this map. */
    exploreArea = ""
): string {
    if (!target || !player) {
        if (path === "build") return t.quest.paths.build.noPosition();
        if (path === "explore") return t.quest.paths.explore.notOnThisMap({ area: exploreArea });
        return t.quest.card.nobodyHere();
    }
    const direction = compassDirection(player, target.position);
    return t.quest.card.direction({
        target: target.name,
        direction: t.quest.directions[direction](),
        steps: stepsBetween(player, target.position),
    });
}
