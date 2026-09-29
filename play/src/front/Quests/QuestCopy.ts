import type { TranslationFunctions } from "../../i18n/i18n-types";
import type { MeetProgress } from "./MeetExchange";
import type { Point } from "./QuestGeometry";
import { compassDirection, stepsBetween } from "./QuestGeometry";
import type { QuestGiver, QuestOrigin, QuestPath, QuestState } from "./QuestModel";
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

/**
 * An Explore sentence with its area, or the quest's title while there is no area to name (the map still loading,
 * another map): never "Find the ".
 */
function exploreLine(t: T, state: QuestState, world: QuestWorld, line: (area: string) => string): string {
    const area = exploreAreaName(state, world);
    return area ? line(area) : t.quest.paths.explore.title();
}

export function questTitle(t: T, path: QuestPath): string {
    return t.quest.paths[path].title();
}

export function questDescription(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    if (path === "explore") {
        return exploreLine(t, state, world, (area) => t.quest.paths.explore.description({ area }));
    }
    return t.quest.paths[path].description();
}

/** The short objective on the pill and the card title ("Find the Courtyard"). */
export function questObjective(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    if (path === "explore") return exploreLine(t, state, world, (area) => t.quest.paths.explore.objective({ area }));
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
    // Done, its celebration waiting for a quiet moment: the card already says how it ended.
    if (state.quests[path].done) return questPayoffLine(t, path, state, world);
    switch (path) {
        case "meet":
            if (state.quests.meet.paused) return t.quest.card.nobodyHere();
            return meetProgress === "sent" ? t.quest.paths.meet.waiting() : t.quest.paths.meet.body();
        case "explore":
            return exploreLine(t, state, world, (area) => t.quest.paths.explore.body({ area }));
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
            return exploreLine(t, state, world, (area) => t.quest.paths.explore.payoff({ area }));
        case "build":
            return t.quest.paths.build.payoff();
    }
}

/** The acknowledgement on a Done entry in the panel. */
export function questLastTime(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    if (path === "explore") return exploreLine(t, state, world, (area) => t.quest.paths.explore.lastTime({ area }));
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

/**
 * Who is speaking for the offer on screen: the giver frozen when the invitation was shown (its name stays even once
 * the bot is out of range), else whoever hosts here now.
 */
export function offerEyebrow(t: T, state: QuestState, world: QuestWorld): string {
    const offer = state.offeredBy;
    if (!offer) return questEyebrow(t, world);
    return offer.giver?.name || offer.room || t.quest.welcome();
}

/** Who is speaking for one quest: the giver frozen when it was accepted, else its room, else "Welcome". */
export function questEyebrowFor(t: T, path: QuestPath, state: QuestState, world: QuestWorld): string {
    const origin = entryOrigin(state, path, world);
    return origin.giver?.name || origin.room || t.quest.welcome();
}

/** One entry of the panel, in words. */
export interface QuestLogEntry {
    path: QuestPath;
    status: "tracked" | "accepted" | "available" | "done";
    title: string;
    /** The objective ("Find the Courtyard"), or how it ended once done: the row's second line. */
    line: string;
    /** What the quest is about, as its giver puts it ("Say hi to whoever's here."). */
    description: string;
    /** The objective, always ("Find the Courtyard"). */
    objective: string;
    /** How to do it now ("Walk to the Courtyard and step inside."), or how it ended once done. */
    body: string;
    minutes: number;
    /** Who gave it: for its portrait on the row. */
    giver: QuestGiver | null;
    /** "Guide · Lobby", or "Lobby". */
    origin: string;
    /** The room it came from ("test"). */
    room: string;
    /** Accepted in another room. */
    elsewhere: boolean;
    /** Which giver's group it sits in: the same giver in the same room is one group. */
    group: string;
    /**
     * Where "Go to {room}" leads, for a quest from another room that isn't done: that room, next to its giver bot
     * when there is one (the People tab's own way of going to someone).
     */
    goToUrl?: string;
    /** The objectives met, out of the quest's: one each for the Welcome chapter. */
    objectives: { done: number; total: number };
    /** "First Hello badge". */
    reward: string;
    /** "Needs: edit rights in this room", when there is a requirement. */
    requirement?: string;
    /** "Nobody's here right now" while paused, or on Meet's Available row while nobody is here. */
    note?: string;
}

/**
 * Where an entry came from: frozen where it was accepted. An entry still on offer is from whoever made the offer on
 * screen, as long as the player is still in that room (the giver keeps its name and face out of view too), else from
 * whoever hosts here now. An accepted entry with no origin (saved before origins, or unreadable) names no giver
 * rather than whoever hosts here.
 */
export function entryOrigin(state: QuestState, path: QuestPath, world: QuestWorld): QuestOrigin {
    const entry = state.quests[path];
    if (entry.origin) return entry.origin;
    if (entry.accepted || entry.done) return { room: world.roomName ?? "", giver: null };
    if (state.offeredBy && state.offeredBy.room === (world.roomName ?? "")) return state.offeredBy;
    return questOrigin(world);
}

/** The panel's entries: everything accepted or done, and what this room offers now. */
export function logEntries(
    t: T,
    state: QuestState,
    world: QuestWorld,
    available: readonly QuestPath[],
    meetProgress: MeetProgress = "idle"
): QuestLogEntry[] {
    const entries: QuestLogEntry[] = [];
    for (const path of QUEST_PATHS) {
        const status = questStatus(state, path);
        if (status === "available" && !available.includes(path)) continue;
        const { room, giver, url } = entryOrigin(state, path, world);
        const elsewhere = room !== "" && world.roomName !== undefined && room !== world.roomName;
        const origin = giver ? t.quest.log.fromHost({ host: giver.name, room }) : t.quest.log.here({ room });
        entries.push({
            path,
            status,
            title: questTitle(t, path),
            line: status === "done" ? questPayoffLine(t, path, state, world) : questObjective(t, path, state, world),
            description: questDescription(t, path, state, world),
            objective: questObjective(t, path, state, world),
            body: questBody(t, path, state, world, meetProgress),
            minutes: QUEST_MINUTES[path],
            giver,
            origin,
            room,
            elsewhere,
            group: giverGroup(giver, room),
            ...(elsewhere && url && status !== "done" ? { goToUrl: roomLink(url, giver) } : {}),
            objectives: { done: status === "done" ? 1 : 0, total: 1 },
            reward: t.quest.stamps.badge({ stamp: stampName(t, path) }),
            requirement: path === "build" && status !== "done" ? t.quest.paths.build.needs() : undefined,
            note: showsNobodyHere(state, world, path, status) ? t.quest.card.nobodyHere() : undefined,
        });
    }
    return entries;
}

/** One group per giver and room: two rooms' Guides are two givers. */
function giverGroup(giver: QuestGiver | null, room: string): string {
    if (!giver) return `room:${room}`;
    return giver.kind === "bot" ? `bot:${giver.uuid ?? giver.name}@${room}` : `area:${giver.name}@${room}`;
}

function roomLink(url: string, giver: QuestGiver | null): string {
    return giver?.kind === "bot" && giver.uuid ? `${url}#moveToUser=${encodeURIComponent(giver.uuid)}` : url;
}

function showsNobodyHere(state: QuestState, world: QuestWorld, path: QuestPath, status: QuestLogEntry["status"]) {
    if (status === "done") return false;
    if (state.quests[path].paused) return true;
    // Meet can be started while alone: the row says it will wait.
    return path === "meet" && status === "available" && world.present.length === 0;
}

/**
 * Where the target is, in words, for people who can't see the marker: "The Courtyard is north-east of you, about 6
 * steps". Announced when the card opens. Nothing when there is nothing positional to say (Build happens in the
 * editor; the map is not there yet; nobody to walk to): the card's body already says what to do.
 */
export function whereDescription(
    t: T,
    target: { name: string; position: Point } | undefined,
    player: Point | undefined,
    path: QuestPath,
    /** Explore's fixed area, when the map is ready without it: it is in another room. */
    missingExploreArea?: string
): string | undefined {
    if (path === "build") return undefined;
    if (!target) {
        return path === "explore" && missingExploreArea
            ? t.quest.paths.explore.notOnThisMap({ area: missingExploreArea })
            : undefined;
    }
    if (!player) return undefined;
    const direction = compassDirection(player, target.position);
    return t.quest.card.direction({
        target: target.name,
        direction: t.quest.directions[direction](),
        steps: stepsBetween(player, target.position),
    });
}
