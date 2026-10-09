/**
 * The bot behaviour model: two answers instead of a type.
 *
 * - moves: where the bot moves. 'stay' (stands on its spot), 'wander' (walks around inside its circle)
 *   or 'route' (walks its stops).
 * - goesToPeople: whether the bot walks over to people it notices and starts a conversation.
 *
 * Bots saved before this model only carry the old type (idle, patrol, social). It maps to one answer pair,
 * so they keep behaving as before: idle = stay, patrol = route, social = wander + goes to people.
 * New fields in behaviorConfig, when present, win over the old type.
 *
 * Pure functions only, so the mapping and the config defaults can be unit tested.
 */

export type BehaviorMoves = 'stay' | 'wander' | 'route';
export type LegacyBehaviorType = 'idle' | 'patrol' | 'social';

export interface BehaviorModel {
    moves: BehaviorMoves;
    goesToPeople: boolean;
}

/** How far a bot notices people when nothing is saved: the value the bot editor shows for an unset bot. */
export const DEFAULT_NOTICE_RANGE = 100;
/** Default cooldown before a bot walks over to the same person again. */
export const DEFAULT_PEOPLE_COOLDOWN_MS = 300000;

type Point = { x: number; y: number };
type AssignedSpace = { center: Point; radius: number };

const LEGACY_MODEL: Record<LegacyBehaviorType, BehaviorModel> = {
    idle: { moves: 'stay', goesToPeople: false },
    patrol: { moves: 'route', goesToPeople: false },
    social: { moves: 'wander', goesToPeople: true },
};

function isMoves(value: unknown): value is BehaviorMoves {
    return value === 'stay' || value === 'wander' || value === 'route';
}

/**
 * The model for a saved bot: the new fields when they are set, else what the old type meant.
 */
export function resolveBehaviorModel(type: string | undefined, cfg: Record<string, unknown> | undefined): BehaviorModel {
    const legacy = LEGACY_MODEL[(type as LegacyBehaviorType) ?? 'idle'] ?? LEGACY_MODEL.idle;
    return {
        moves: isMoves(cfg?.moves) ? cfg.moves : legacy.moves,
        goesToPeople: typeof cfg?.goesToPeople === 'boolean' ? cfg.goesToPeople : legacy.goesToPeople,
    };
}

/**
 * The old type that describes a model best. Orbit still stores and shows this label.
 */
export function legacyTypeFor(model: BehaviorModel): LegacyBehaviorType {
    if (model.moves === 'route') return 'patrol';
    if (model.moves === 'wander') return 'social';
    return 'idle';
}

/**
 * Which behaviour class runs a model. Bots that go to people all run the social behaviour, which knows
 * how to walk over, greet and come back, and moves in any of the three ways. Bots that don't go to
 * people keep the class they have always used, so they behave exactly as before.
 */
export function behaviorClassFor(model: BehaviorModel): LegacyBehaviorType {
    if (model.goesToPeople) return 'social';
    return legacyTypeFor(model);
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A route's stops, from either saved key (patrolWaypoints, or the older waypoints). */
export function waypointsOf(cfg: Record<string, unknown>): Point[] {
    const raw = Array.isArray(cfg.patrolWaypoints) ? cfg.patrolWaypoints : Array.isArray(cfg.waypoints) ? cfg.waypoints : [];
    return raw.filter(
        (p): p is Point => !!p && typeof (p as Point).x === 'number' && typeof (p as Point).y === 'number'
    );
}

/**
 * Turn a saved behaviorConfig into the config the behaviour class expects, with every default filled in.
 * Used both when a bot spawns and when the editor changes a running bot, so the two can't drift apart.
 *
 * @param type the saved (old) behaviour type
 * @param cfg the saved behaviorConfig, merged with any live changes
 * @param botAssignedSpace the bot's top-level assigned space, used when behaviorConfig has none
 */
export function buildBehaviorConfig(
    type: string | undefined,
    cfg: Record<string, unknown> | undefined,
    botAssignedSpace?: AssignedSpace
): { kind: LegacyBehaviorType; model: BehaviorModel; config: Record<string, unknown> } {
    const source = cfg ?? {};
    const model = resolveBehaviorModel(type, source);
    const kind = behaviorClassFor(model);
    const assignedSpace = (source.assignedSpace as AssignedSpace | undefined) ?? botAssignedSpace;
    const config: Record<string, unknown> = {
        ...source,
        type: kind,
        moves: model.moves,
        goesToPeople: model.goesToPeople,
    };
    if (assignedSpace) config.assignedSpace = assignedSpace;

    if (kind === 'patrol' || model.moves === 'route') {
        config.waypoints = waypointsOf(source);
        config.loop = typeof source.loop === 'boolean' ? source.loop : true;
        config.pauseAtWaypoints = numberOr(source.pauseAtWaypoints, 0);
        config.speed = numberOr(source.speed, 50);
    }

    if (kind === 'patrol') {
        // Patrol bots answer people who walk up to them unless explicitly told not to. This default
        // used to be false on live edits, which silenced a patrol bot after any change in the editor.
        config.respondToPlayers = typeof source.respondToPlayers === 'boolean' ? source.respondToPlayers : true;
    }

    if (kind === 'social') {
        config.conversationRadius = numberOr(source.conversationRadius, DEFAULT_NOTICE_RANGE);
        config.minTimeBetweenConversations = numberOr(source.minTimeBetweenConversations, DEFAULT_PEOPLE_COOLDOWN_MS);
        config.maxConversationDuration = numberOr(source.maxConversationDuration, 300000);
        config.conversationHistorySize = numberOr(source.conversationHistorySize, 50);
        config.respectPlayerStatus = typeof source.respectPlayerStatus === 'boolean' ? source.respectPlayerStatus : true;
        config.maxConcurrentConversations = numberOr(source.maxConcurrentConversations, 1);
        config.wanderRadius = assignedSpace ? assignedSpace.radius || 200 : 200;
        config.wanderCenter = assignedSpace?.center ?? { x: 0, y: 0 };
        config.wanderSpeed = numberOr(source.wanderSpeed, 50);
        config.approachDistance = numberOr(source.approachDistance, 50);
    }

    return { kind, model, config };
}
