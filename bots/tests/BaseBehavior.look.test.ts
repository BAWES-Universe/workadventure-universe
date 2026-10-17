/**
 * Tests for a bot turning to look at people who walk by: from 4 tiles away while it stands still,
 * following them until 5 tiles, without stopping or engaging.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PositionMessage_Direction } from '@workadventure/messages';

import { IdleBehavior, type IdleBehaviorConfig } from '../behaviors/IdleBehavior';
import { PatrolBehavior } from '../behaviors/PatrolBehavior';
import { SocialBehavior } from '../behaviors/SocialBehavior';

type Point = { x: number; y: number };

function createBot(
    options: { moving?: boolean; followingPath?: boolean; lastMovedAt?: number; direction?: PositionMessage_Direction } = {}
) {
    let direction = options.direction ?? PositionMessage_Direction.DOWN;
    let moving = options.moving ?? false;
    const players = new Map<number, { userId: number; position: Point }>();
    const state = {
        getPosition: () => ({ x: 0, y: 0 }),
        getDirection: () => direction,
        setDirection: vi.fn((d: PositionMessage_Direction) => {
            direction = d;
        }),
        setMoving: vi.fn((m: boolean) => {
            moving = m;
        }),
        isMoving: () => moving,
        getLastMovedAt: () => options.lastMovedAt ?? 0,
    };
    const bot = {
        movePlayer(userId: number, position: Point) {
            players.set(userId, { userId, position });
        },
        removePlayer(userId: number) {
            players.delete(userId);
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

function idleBehavior(bot: ReturnType<typeof createBot>, extra: Record<string, unknown> = {}): IdleBehavior {
    const config: IdleBehaviorConfig = { type: 'idle', responseRadius: 100, greetingMessages: [], ...extra };
    const behavior = new IdleBehavior(config);
    behavior.setBot(bot as any);
    return behavior;
}

function routeBehavior(bot: ReturnType<typeof createBot>): PatrolBehavior {
    const behavior = new PatrolBehavior({
        type: 'patrol', waypoints: [], loop: true, pauseAtWaypoints: 5, speed: 50, respondToPlayers: true,
    } as any);
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

describe('bots turn back once nobody is in sight', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('turns back the way it faced a moment after the person walks past 5 tiles', () => {
        vi.useFakeTimers();
        const bot = createBot();
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: 120, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);

        walk(behavior, bot, { x: 200, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);

        vi.advanceTimersByTime(1000);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);

        vi.advanceTimersByTime(600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
    });

    it('turns back when the person it looked at leaves the room', () => {
        vi.useFakeTimers();
        const bot = createBot();
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: -120, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.LEFT);

        bot.removePlayer(1);
        behavior.lookAtPassersBy();
        vi.advanceTimersByTime(1600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
    });

    it('does not turn back if the person comes back in sight before the delay', () => {
        vi.useFakeTimers();
        const bot = createBot();
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: 120, y: 0 });
        walk(behavior, bot, { x: 200, y: 0 });
        vi.advanceTimersByTime(1000);
        walk(behavior, bot, { x: 120, y: 0 });
        vi.advanceTimersByTime(1000);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);
    });

    it('turns back after a chat, once the person walks away', () => {
        vi.useFakeTimers();
        const bot = createBot();
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: 0, y: -60 });
        expect((behavior as any).isEngaged).toBe(true);
        expect(bot.direction()).toBe(PositionMessage_Direction.UP);

        walk(behavior, bot, { x: 0, y: -400 });
        expect((behavior as any).isEngaged).toBe(false);
        vi.advanceTimersByTime(1600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
    });

    it('keeps facing the way it walks once it has walked on', () => {
        vi.useFakeTimers();
        const options = { followingPath: false };
        const bot = createBot(options);
        const behavior = routeBehavior(bot);

        walk(behavior, bot, { x: 120, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);

        // It walks off (and its walk sets its direction), then the person leaves
        options.followingPath = true;
        bot.getState().setDirection(PositionMessage_Direction.UP);
        behavior.lookAtPassersBy();
        options.followingPath = false;
        bot.removePlayer(1);
        behavior.lookAtPassersBy();
        vi.advanceTimersByTime(1600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.UP);
    });

    it('turns back the way it was walking after it stopped to face someone', () => {
        vi.useFakeTimers();
        const bot = createBot({ moving: true, lastMovedAt: Date.now(), direction: PositionMessage_Direction.LEFT });
        const behavior = routeBehavior(bot);

        // It just took a step left when someone walks up above it
        walk(behavior, bot, { x: 0, y: -60 });
        expect(bot.direction()).toBe(PositionMessage_Direction.UP);

        vi.advanceTimersByTime(600);
        walk(behavior, bot, { x: 60, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);

        walk(behavior, bot, { x: 400, y: 0 });
        vi.advanceTimersByTime(1600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.LEFT);
    });

    it('turns back when the person it was chatting with leaves the room', () => {
        vi.useFakeTimers();
        const bot = createBot();
        const behavior = idleBehavior(bot);

        walk(behavior, bot, { x: 60, y: 0 });
        expect((behavior as any).isEngaged).toBe(true);
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);

        bot.removePlayer(1);
        behavior.onPlayerLeft(1);
        expect((behavior as any).isEngaged).toBe(false);
        behavior.lookAtPassersBy();
        vi.advanceTimersByTime(1600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
    });
});

describe('bots with a default facing direction', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('turns back to its facing after someone walks by, though it started facing down', () => {
        vi.useFakeTimers();
        const bot = createBot();
        const behavior = idleBehavior(bot, { moves: 'stay', facing: 'left' });

        walk(behavior, bot, { x: 120, y: 0 });
        expect(bot.direction()).toBe(PositionMessage_Direction.RIGHT);

        walk(behavior, bot, { x: 400, y: 0 });
        vi.advanceTimersByTime(1600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.LEFT);
    });

    it('turns to its facing after standing nobody in sight for a moment when it faces another way', () => {
        vi.useFakeTimers();
        const bot = createBot({ direction: PositionMessage_Direction.UP });
        const behavior = idleBehavior(bot, { moves: 'stay', facing: 'down' });

        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.UP);
        vi.advanceTimersByTime(1600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
        expect(bot.stopAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('does not turn while it is engaged with someone', () => {
        vi.useFakeTimers();
        const bot = createBot();
        const behavior = idleBehavior(bot, { moves: 'stay', facing: 'left' });

        walk(behavior, bot, { x: 0, y: -60 });
        expect((behavior as any).isEngaged).toBe(true);
        vi.advanceTimersByTime(3000);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.UP);
    });

    it('faces down when no facing is saved, as the editor shows', () => {
        vi.useFakeTimers();
        const bot = createBot({ direction: PositionMessage_Direction.UP });
        const behavior = idleBehavior(bot, { moves: 'stay' });

        walk(behavior, bot, { x: 120, y: 0 });
        walk(behavior, bot, { x: 400, y: 0 });
        vi.advanceTimersByTime(1600);
        behavior.lookAtPassersBy();
        expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
    });

    it('ignores a facing on a bot that wanders or walks a route', () => {
        vi.useFakeTimers();
        const wander = new SocialBehavior({ type: 'social', moves: 'wander', facing: 'left' } as any);
        const route = new PatrolBehavior({
            type: 'patrol', moves: 'route', facing: 'left', waypoints: [], loop: true, pauseAtWaypoints: 0, speed: 50, respondToPlayers: true,
        } as any);
        for (const behavior of [wander, route]) {
            const bot = createBot();
            behavior.setBot(bot as any);
            expect(behavior.getConfiguredFacing()).toBeNull();
            vi.advanceTimersByTime(3000);
            behavior.lookAtPassersBy();
            behavior.lookAtPassersBy();
            vi.advanceTimersByTime(1600);
            behavior.lookAtPassersBy();
            expect(bot.direction()).toBe(PositionMessage_Direction.DOWN);
            expect(bot.stopAndUpdate).not.toHaveBeenCalled();
        }
    });

    it('uses the facing of a stay bot that goes to people (social behaviour)', () => {
        const behavior = new SocialBehavior({ type: 'social', moves: 'stay', goesToPeople: true, facing: 'right' } as any);
        expect(behavior.getConfiguredFacing()).toBe(PositionMessage_Direction.RIGHT);
    });
});
