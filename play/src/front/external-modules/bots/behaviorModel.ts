/**
 * The bot page's behaviour model, the same as the bot server's (bots/behaviors/behaviorModel.ts): instead of a type,
 * a bot has two answers.
 *
 * - moves: 'stay' (on its spot), 'wander' (inside its circle) or 'route' (along its stops).
 * - goesToPeople: whether it walks over to people it notices.
 *
 * Bots saved before this model only have the old type, which maps to one answer pair: idle = stay, patrol = route,
 * social = wander and goes to people. Saved answers win over the old type. The old type is still written next to the
 * answers, as the one that describes them best, because Orbit lists it and older bot servers read it.
 */
import type { BotData } from "./types";

export type BotMoves = "stay" | "wander" | "route";
export type LegacyBehaviorType = "idle" | "patrol" | "social";

export interface BotModel {
    moves: BotMoves;
    goesToPeople: boolean;
}

/** How far a bot notices people when nothing is saved, in pixels (the bot server's default). */
export const DEFAULT_NOTICE_RANGE = 100;
/** The Near and Far ends of the "Notices people" slider, in pixels: one tile to ten tiles. */
export const NOTICE_RANGE_MIN = 32;
export const NOTICE_RANGE_MAX = 320;
/** How long before a bot walks over to the same person again, when nothing is saved (5 min). */
export const DEFAULT_PEOPLE_COOLDOWN_MS = 300000;
/** How long a bot waits for a tool to answer when it has no Patience saved (the bot server's default). */
export const DEFAULT_TOOL_TIMEOUT_SECONDS = 90;
/** The radius a bot gets when it starts wandering without a circle of its own. */
export const DEFAULT_WANDER_RADIUS = 150;

const LEGACY_MODEL: Record<LegacyBehaviorType, BotModel> = {
    idle: { moves: "stay", goesToPeople: false },
    patrol: { moves: "route", goesToPeople: false },
    social: { moves: "wander", goesToPeople: true },
};

function isMoves(value: unknown): value is BotMoves {
    return value === "stay" || value === "wander" || value === "route";
}

function legacyTypeOf(bot: Pick<BotData, "behaviorType" | "behaviorConfig">): LegacyBehaviorType {
    const type = bot.behaviorConfig?.behaviorType ?? bot.behaviorType;
    return type === "patrol" || type === "social" ? type : "idle";
}

/** The bot's answers: the saved ones, or what its old type meant. */
export function botModel(bot: Pick<BotData, "behaviorType" | "behaviorConfig"> | undefined | null): BotModel {
    if (!bot) return LEGACY_MODEL.idle;
    const legacy = LEGACY_MODEL[legacyTypeOf(bot)];
    const cfg = bot.behaviorConfig ?? {};
    return {
        moves: isMoves(cfg.moves) ? cfg.moves : legacy.moves,
        goesToPeople: typeof cfg.goesToPeople === "boolean" ? cfg.goesToPeople : legacy.goesToPeople,
    };
}

/** The old type that describes a model best. */
export function legacyTypeFor(model: BotModel): LegacyBehaviorType {
    if (model.moves === "route") return "patrol";
    if (model.moves === "wander") return "social";
    return "idle";
}

/** Whether the bot walks a route (shows and edits stops). */
export function walksRoute(bot: Pick<BotData, "behaviorType" | "behaviorConfig"> | undefined | null): boolean {
    return botModel(bot).moves === "route";
}

/**
 * The bot with new answers. Its other settings are kept (a route stays saved while the bot wanders, so switching
 * back brings it back); a bot that starts wandering without a circle gets one, and one that starts going to people
 * gets the default notice range.
 */
export function withModel(bot: BotData, change: Partial<BotModel>): BotData {
    const model = { ...botModel(bot), ...change };
    const behaviorType = legacyTypeFor(model);
    const cfg = { ...bot.behaviorConfig };
    const assignedSpace = cfg.assignedSpace ?? { center: { x: 0, y: 0 }, radius: 0 };
    let radius = assignedSpace.radius;
    if (model.moves === "wander" && !(radius > 0)) {
        radius = DEFAULT_WANDER_RADIUS;
    }
    const conversationRadius =
        model.goesToPeople && typeof cfg.conversationRadius !== "number"
            ? DEFAULT_NOTICE_RANGE
            : cfg.conversationRadius;
    return {
        ...bot,
        behaviorType,
        behaviorConfig: {
            ...cfg,
            behaviorType,
            moves: model.moves,
            goesToPeople: model.goesToPeople,
            assignedSpace: { ...assignedSpace, radius },
            ...(conversationRadius !== undefined ? { conversationRadius } : {}),
        },
    };
}

/** The bot's stops, whichever key they were saved under. */
export function routeStops(bot: Pick<BotData, "behaviorConfig"> | undefined | null): Array<{ x: number; y: number }> {
    const cfg = bot?.behaviorConfig;
    const raw = Array.isArray(cfg?.patrolWaypoints) ? cfg?.patrolWaypoints : cfg?.waypoints;
    return Array.isArray(raw)
        ? raw.filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number")
        : [];
}

/** How far the bot notices people, in pixels. */
export function noticeRange(bot: Pick<BotData, "behaviorConfig"> | undefined | null): number {
    const value = bot?.behaviorConfig?.conversationRadius;
    return typeof value === "number" && value > 0 ? value : DEFAULT_NOTICE_RANGE;
}
