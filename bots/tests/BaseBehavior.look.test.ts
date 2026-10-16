/**
 * Tests for a bot turning to look at people who walk by: from 4 tiles away while it stands still,
 * following them until 5 tiles, without stopping or engaging.
 */
import { describe, expect, it, vi } from 'vitest';
import { PositionMessage_Direction } from '@workadventure/messages';

import { IdleBehavior, type IdleBehaviorConfig } from '../behaviors/IdleBehavior';
import { PatrolBehavior } from '../behaviors/PatrolBehavior';

type Point = { x: number; y: number };

function createBot(options: { moving?: boolean; followingPath?: boolean; lastMovedAt?: number } = {}) {
    let direction = PositionMessage_Direction.DOWN;
    const players = new Map<number, { userId: number; position: Point }>();
    const state = {
        getPosition: () => ({ x: 0, y: 0 }),
        getDirection: () => direction,
        setDirection: vi.fn((d: PositionMessage_Direction) => {
            direction = d;
        }),
        setMoving: vi.fn(),
        isMoving: () => options.moving ?? false,
        getLastMovedAt: () => options.lastMovedAt ?? 0,
    };
    const bot = {
        movePlayer(userId: number, position: Point) {
            players.set(userId, { userId, position });
        },
        direction: () => direction,
        isOtherBot: vi.fn(() => false),
        getState: vi.fn(() => state),
        getPlayerInfo: vi.fn((id: number) => players.get(id)),
        getNearbyPlayers: vi.fn((radius: number) =>
            Array.from(players.values()).filter((p) => Math.hypot(p.position.x, p.position.y) <= radius)
        ),
        getIsFollowingPath: vi.fn(() => options.followingPath ?? false),
        cancelPathfinding: vi.fn(),
        stop: vi.fn(),
        stopAndUpdate: vi.fn(),
        sendPosition: vi.fn(),
    };
    return bot;
}

function idleBehavior(bot: ReturnType<typeof createBot>): IdleBehavior {
    const config: IdleBehaviorConfig = { type: 'idle', responseRadius: 100, greetingMessages: [] };
    const behavior = new IdleBehavior(config);
    behavior.setBot(bot as any);
    return behavior;
}

function walk(behavior: { onPlayerMoved(id: number, p: Point): void }, bot: ReturnType<typeof createBot>, p: Point) {
    bot.movePlayer(1, p);
    behavior.onPlayerMoved(1, p);
}

describe('bots look at people walking by', () => {
    it('turns to look at someone 4 tiles away, without engaging', () => {
        const bot = createBot();
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: 160, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);

        walk(behavior, bot, { x: 128, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);
        expect((behavior as any).isEngaged).toBe(false);
    });

    it('follows them with its eyes until they are 5 tiles away', () => {
        const bot = createBot();
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: 120, y: 40 });
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);

        // Walking past, now above the bot and 4.5 tiles away
        walk(behavior, bot, { x: 20, y: -144 });
        expect(bot.direction()).toBe(PositionMessage_Direction.UP);

        walk(behavior, bot, { x: -170, y: -10 });
        expect(bot.direction()).toBe(PositionMessage_Direction.UP);
        expect((behavior as any).lookingAtPlayerId).toBeNull();
    });

    it('does not turn to look while it is walking', () => {
        const bot = createBot({ moving: true, followingPath: true });
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: 110, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
        expect(bot.stopAndUpdate).not.toHaveBeenCalled();
    });

    it('looks while paused at a stop, though the moving flag is still set from walking there', () => {
        const bot = createBot({ moving: true, lastMovedAt: Date.now() - 2000 });
        const behavior = new PatrolBehavior({ type: 'patrol', waypoints: [], loop: true, pauseAtWaypoints: 5, speed: 50, respondToPlayers: true } as any);
        behavior.setBot(bot as any);

        walk(behavior, bot, { x: 0, y: 120 });
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
        walk(behavior, bot, { x: -120, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.LEFT);
    });

    it('does not turn to look right after a step without a path (walking straight to a spot)', () => {
        const bot = createBot({ moving: true, lastMovedAt: Date.now() - 100 });
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: 110, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
    });

    it('lets a route bot keep walking when someone passes 4 tiles away', () => {
        const bot = createBot({ moving: true, followingPath: true });
        const behavior = new PatrolBehavior({ type: 'patrol', waypoints: [], loop: true, pauseAtWaypoints: 0, speed: 50, respondToPlayers: true } as any);
        behavior.setBot(bot as any);

        walk(behavior, bot, { x: 120, y: 0 });
        expect(bot.cancelPathfinding).not.toHaveBeenCalled();
        expect(bot.stop).not.toHaveBeenCalled();
    });
});
