/**
 * Tests for when a summon ends: the bot goes back once the person it came for has left or walked far away, and no
 * one else standing near it can keep it there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseBehavior } from '../behaviors/BaseBehavior';
import type { BehaviorConfig } from '../behaviors/BaseBehavior';

type Point = { x: number; y: number };

class TestableBehavior extends BaseBehavior {
    constructor() {
        super({} as BehaviorConfig);
    }
    update(_deltaTime: number): void {}
    onChatMessage(): Promise<void> {
        return Promise.resolve();
    }
    getConversationMemory(_playerId: number): any {
        return null;
    }
    generateAIResponseStream(): Promise<void> {
        return Promise.resolve();
    }

    attach(bot: unknown): void {
        this.bot = bot as never;
        // Its own spot is far from where it was called to, so ending the summon sends it walking back
        this.spawnPosition = { x: 0, y: 0 };
    }
    engage(userId: number): void {
        this.engagedWithUsers.set(userId, { spaceName: 's' });
        this.isEngaged = true;
    }
    know(userId: number, uuid: string): void {
        this.userIdToUuid.set(userId, uuid);
    }
    tick(): boolean {
        return this.endSummonIfPersonAway();
    }
    summoned(): boolean {
        return this.isSummoned;
    }
    returning(): boolean {
        return this.isReturning;
    }
}

const botAt: Point = { x: 1000, y: 1000 };

/** A room where `people` stand (by uuid), the summoner being 'me'. Other bots and people near the bot count as players too. */
function room(people: Record<string, Point & { isBot?: boolean }>, options: { walking?: boolean } = {}) {
    return {
        getState: () => ({ getPosition: () => botAt, isMoving: () => false, getLastMovedAt: () => 0 }),
        getIsFollowingPath: () => options.walking ?? false,
        cancelPathfinding: vi.fn(),
        isOtherBot: (userId: number) => userId >= 1000,
        moveToWithPathfinding: vi.fn().mockResolvedValue(true),
        getPlayerPositionByUuid: (uuid: string) => {
            const person = people[uuid];
            return person && !person.isBot ? { x: person.x, y: person.y } : undefined;
        },
        // What the old "whoever is close" lookup read
        getAllPlayers: () =>
            Object.entries(people).map(([uuid, person], index) => ({ userId: index, uuid, position: { x: person.x, y: person.y } })),
    };
}

describe('a summon ends when its person has gone', () => {
    let behavior: TestableBehavior;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        behavior = new TestableBehavior();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function summonAndSettle(people: Parameters<typeof room>[0], options: Parameters<typeof room>[1] = {}) {
        behavior.attach(room(people, options));
        behavior.startSummon('me', { x: 1010, y: 1000 });
        vi.advanceTimersByTime(10_000);
    }

    it('lets the bot go when the person walks far away', () => {
        summonAndSettle({ me: { x: 1500, y: 1000 } });
        behavior.onPlayerMoved(7, { x: 1500, y: 1000 });
        expect(behavior.summoned()).toBe(false);
        expect(behavior.returning()).toBe(true);
    });

    it('is not kept by another person or a bot standing near it', () => {
        summonAndSettle({
            me: { x: 1500, y: 1000 },
            someoneElse: { x: 1050, y: 1000 },
            otherBot: { x: 1020, y: 1020, isBot: true },
        });
        behavior.onPlayerMoved(7, { x: 1500, y: 1000 });
        expect(behavior.summoned()).toBe(false);
    });

    it('is not kept by a person standing near it when it is checked on a tick', () => {
        summonAndSettle({ me: { x: 1500, y: 1000 }, someoneElse: { x: 1050, y: 1000 } });
        expect(behavior.tick()).toBe(true);
        expect(behavior.summoned()).toBe(false);
    });

    it('stays while the person is within reach', () => {
        summonAndSettle({ me: { x: 1150, y: 1000 } });
        behavior.onPlayerMoved(7, { x: 1150, y: 1000 });
        expect(behavior.summoned()).toBe(true);
    });

    it('stays while it is still walking to them, and just after it set off', () => {
        behavior.attach(room({ me: { x: 1800, y: 1000 } }));
        behavior.startSummon('me', { x: 1800, y: 1000 });
        expect(behavior.tick()).toBe(false);

        behavior.attach(room({ me: { x: 1800, y: 1000 } }, { walking: true }));
        vi.advanceTimersByTime(60_000);
        expect(behavior.tick()).toBe(false);
        expect(behavior.summoned()).toBe(true);
    });

    it('stays while it talks with someone else, and goes when it only had the person who left', () => {
        summonAndSettle({ me: { x: 1500, y: 1000 }, friend: { x: 1030, y: 1000 } });
        behavior.know(7, 'me');
        behavior.know(8, 'friend');
        behavior.engage(8);
        expect(behavior.tick()).toBe(false);

        const alone = new TestableBehavior();
        alone.attach(room({ me: { x: 1500, y: 1000 } }));
        alone.startSummon('me', { x: 1010, y: 1000 });
        vi.advanceTimersByTime(10_000);
        alone.know(7, 'me');
        alone.engage(7);
        expect(alone.tick()).toBe(true);
    });

    it('lets the bot go when the person leaves the room without one more move', () => {
        const people: Record<string, Point> = { me: { x: 1060, y: 1000 }, someoneElse: { x: 1050, y: 1000 } };
        summonAndSettle(people);
        behavior.know(7, 'me');
        delete people.me;
        behavior.onPlayerLeft(7);
        expect(behavior.summoned()).toBe(false);
        expect(behavior.returning()).toBe(true);
    });

    it('does nothing for a bot that was not summoned', () => {
        behavior.attach(room({ me: { x: 1500, y: 1000 } }));
        expect(behavior.tick()).toBe(false);
        expect(behavior.returning()).toBe(false);
    });
});
