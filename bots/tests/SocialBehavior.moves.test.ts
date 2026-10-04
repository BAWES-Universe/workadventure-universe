/**
 * Tests for how a bot that goes to people moves between conversations: staying on its spot, walking its
 * route, wandering its circle, and walking back onto its leash after a chat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SocialBehavior, type SocialBehaviorConfig } from '../behaviors/SocialBehavior';
import { AvailabilityStatus } from '../behaviors/socialRules';

type Point = { x: number; y: number };

function createConfig(overrides: Partial<SocialBehaviorConfig> = {}): SocialBehaviorConfig {
    return {
        type: 'social',
        assignedSpace: { center: { x: 0, y: 0 }, radius: 200 },
        conversationRadius: 100,
        minTimeBetweenConversations: 300000,
        maxConversationDuration: 300000,
        conversationHistorySize: 50,
        respectPlayerStatus: true,
        maxConcurrentConversations: 1,
        wanderRadius: 200,
        wanderCenter: { x: 0, y: 0 },
        wanderSpeed: 50,
        approachDistance: 50,
        ...overrides,
    };
}

function createBot(start: Point, players: Array<{ userId: number; position: Point }> = []) {
    let position = { ...start };
    let followingPath = false;
    const byId = new Map(
        players.map((p) => [p.userId, { ...p, name: `Player ${p.userId}`, availabilityStatus: AvailabilityStatus.ONLINE }])
    );
    const bot = {
        setPosition(p: Point) {
            position = { ...p };
        },
        setFollowingPath(value: boolean) {
            followingPath = value;
        },
        getBotId: vi.fn(() => 'bot-1'),
        getUserId: vi.fn(() => 99),
        getState: vi.fn(() => ({
            getPosition: () => ({ ...position }),
            getDirection: () => 0,
            setDirection: vi.fn(),
            setMoving: vi.fn(),
            isMoving: () => false,
        })),
        getPlayerInfo: vi.fn((id: number) => byId.get(id)),
        getNearbyPlayers: vi.fn(() => Array.from(byId.values())),
        getBubbleUserIds: vi.fn(() => undefined),
        getIsFollowingPath: vi.fn(() => followingPath),
        hasPathfinding: vi.fn(() => true),
        isWalkable: vi.fn(() => true),
        moveToWithPathfinding: vi.fn(async (_x: number, _y: number) => {
            followingPath = true;
            return true;
        }),
        updatePathFollowing: vi.fn(),
        cancelPathfinding: vi.fn(() => {
            followingPath = false;
        }),
        stop: vi.fn(),
        moveTo: vi.fn(),
    };
    return bot;
}

async function move(behavior: SocialBehavior): Promise<void> {
    await (behavior as any).moveOnLeash((behavior as any).config, 16);
}

function lookForPeople(behavior: SocialBehavior): void {
    (behavior as any).checkForConversations((behavior as any).config);
}

function stillApproachable(behavior: SocialBehavior, playerId: number): boolean {
    return (behavior as any).isTargetStillApproachable(playerId, (behavior as any).config, Date.now());
}

const route = [
    { x: 0, y: 0 },
    { x: 320, y: 0 },
    { x: 320, y: 320 },
];

describe('SocialBehavior moves', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not walk over to anyone when goes to people is off', () => {
        const behavior = new SocialBehavior(createConfig({ goesToPeople: false }));
        behavior.setBot(createBot({ x: 0, y: 0 }, [{ userId: 1, position: { x: 60, y: 0 } }]) as any);
        lookForPeople(behavior);
        expect((behavior as any).targetPlayerId).toBeNull();
    });

    describe('stays put', () => {
        it('steps over to someone it notices, but gives up once they are out of range of its spot', () => {
            const bot = createBot({ x: 0, y: 0 }, [{ userId: 1, position: { x: 80, y: 0 } }]);
            const behavior = new SocialBehavior(createConfig({ moves: 'stay', assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } }));
            behavior.setBot(bot as any);
            lookForPeople(behavior);
            expect((behavior as any).targetPlayerId).toBe(1);
            expect(stillApproachable(behavior, 1)).toBe(true);

            (bot.getPlayerInfo(1) as any).position = { x: 400, y: 0 };
            expect(stillApproachable(behavior, 1)).toBe(false);
        });

        it('walks back to its spot after a chat and stands still once there', async () => {
            const bot = createBot({ x: 200, y: 0 });
            const behavior = new SocialBehavior(createConfig({ moves: 'stay', assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } }));
            behavior.setBot(bot as any);
            (behavior as any).returnToAssignedSpace();
            await vi.runAllTimersAsync();
            expect(bot.moveToWithPathfinding).toHaveBeenCalledWith(0, 0);

            bot.setFollowingPath(false);
            bot.setPosition({ x: 10, y: 0 });
            bot.moveToWithPathfinding.mockClear();
            await move(behavior);
            expect(bot.moveToWithPathfinding).not.toHaveBeenCalled();
            expect(bot.moveTo).not.toHaveBeenCalled();
        });
    });

    describe('walks a route', () => {
        it('walks stop to stop and loops', async () => {
            const bot = createBot({ x: 0, y: 0 });
            const behavior = new SocialBehavior(createConfig({ moves: 'route', waypoints: route, loop: true }));
            behavior.setBot(bot as any);

            await move(behavior); // at stop 1: next is stop 2
            await move(behavior);
            expect(bot.moveToWithPathfinding).toHaveBeenLastCalledWith(320, 0);

            for (const [arrive, next] of [
                [route[1], route[2]],
                [route[2], route[0]],
            ]) {
                bot.setFollowingPath(false);
                bot.setPosition(arrive);
                await move(behavior);
                await move(behavior);
                expect(bot.moveToWithPathfinding).toHaveBeenLastCalledWith(next.x, next.y);
            }
        });

        it('goes back and forth when the route does not loop', async () => {
            const bot = createBot({ x: 320, y: 320 });
            const behavior = new SocialBehavior(createConfig({ moves: 'route', waypoints: route, loop: false }));
            behavior.setBot(bot as any);
            (behavior as any).routeIndex = 2;
            await move(behavior); // at the last stop: turns around
            await move(behavior);
            expect(bot.moveToWithPathfinding).toHaveBeenLastCalledWith(320, 0);
        });

        it('pauses at a stop before moving on', async () => {
            const bot = createBot({ x: 0, y: 0 });
            const behavior = new SocialBehavior(createConfig({ moves: 'route', waypoints: route, pauseAtWaypoints: 5 }));
            behavior.setBot(bot as any);
            await move(behavior);
            await move(behavior);
            expect(bot.moveToWithPathfinding).not.toHaveBeenCalled();
            vi.setSystemTime(1_000_000 + 5_001);
            await move(behavior);
            expect(bot.moveToWithPathfinding).toHaveBeenLastCalledWith(320, 0);
        });

        it('rejoins at the nearest stop after being pulled off the route', async () => {
            const bot = createBot({ x: 420, y: 330 }); // off the route, closest to stop 3
            const behavior = new SocialBehavior(createConfig({ moves: 'route', waypoints: route }));
            behavior.setBot(bot as any);
            await move(behavior);
            expect(bot.moveToWithPathfinding).toHaveBeenLastCalledWith(320, 320);
        });

        it('leaves the route for someone near it, not for someone far from it', () => {
            const bot = createBot({ x: 160, y: 0 }, [{ userId: 1, position: { x: 160, y: 80 } }]);
            const behavior = new SocialBehavior(createConfig({ moves: 'route', waypoints: route }));
            behavior.setBot(bot as any);
            lookForPeople(behavior);
            expect((behavior as any).targetPlayerId).toBe(1);
            expect(stillApproachable(behavior, 1)).toBe(true);

            (bot.getPlayerInfo(1) as any).position = { x: 160, y: 400 };
            expect(stillApproachable(behavior, 1)).toBe(false);
        });

        it('stays on its spot while the route has no stops', async () => {
            const bot = createBot({ x: 100, y: 0 });
            const behavior = new SocialBehavior(createConfig({ moves: 'route', waypoints: [], assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } }));
            behavior.setBot(bot as any);
            await move(behavior);
            expect(bot.moveToWithPathfinding).toHaveBeenLastCalledWith(0, 0);
        });
    });

    describe('wanders an area', () => {
        it('carries on from where it is after a chat inside its circle', async () => {
            const bot = createBot({ x: 120, y: 0 });
            const behavior = new SocialBehavior(createConfig());
            behavior.setBot(bot as any);
            (behavior as any).returnToAssignedSpace();
            await vi.runAllTimersAsync();
            expect(bot.moveToWithPathfinding).not.toHaveBeenCalled();
            expect(bot.moveTo).not.toHaveBeenCalled();
        });

        it('walks back in to the nearest point, not the centre, when it ends up outside', async () => {
            const bot = createBot({ x: 400, y: 0 });
            const behavior = new SocialBehavior(createConfig());
            behavior.setBot(bot as any);
            (behavior as any).returnToAssignedSpace();
            await vi.runAllTimersAsync();
            const [x, y] = bot.moveToWithPathfinding.mock.calls[0];
            expect(x).toBeCloseTo(184);
            expect(y).toBeCloseTo(0);
        });
    });
});
