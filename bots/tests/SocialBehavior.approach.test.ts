/**
 * Tests for how a social bot picks people to talk to, walks over, gives up, and greets them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SocialBehavior, type SocialBehaviorConfig } from '../behaviors/SocialBehavior';
import { APPROACH_TIMEOUT_MS, AvailabilityStatus } from '../behaviors/socialRules';

const BOT_USER_ID = 99;
const SPACE = 'proximity#1';

interface FakePlayer {
    userId: number;
    name: string;
    position: { x: number; y: number };
    availabilityStatus: number;
}

function createConfig(overrides: Partial<SocialBehaviorConfig> = {}): SocialBehaviorConfig {
    return {
        type: 'social',
        assignedSpace: { center: { x: 0, y: 0 }, radius: 200 },
        conversationRadius: 150,
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

function createBot(players: FakePlayer[], options: { aiProviderRef?: string } = {}) {
    const byId = new Map(players.map((player) => [player.userId, player]));
    let followingPath = false;
    const bubbles: number[][] = [];
    return {
        byId,
        bubbles,
        setFollowingPath(value: boolean) {
            followingPath = value;
        },
        getBotId: vi.fn(() => 'bot-1'),
        getUserId: vi.fn(() => BOT_USER_ID),
        getFullConfig: vi.fn(() => ({ aiProviderRef: options.aiProviderRef, chatInstructions: 'Be nice.' })),
        getState: vi.fn(() => ({
            getPosition: () => ({ x: 0, y: 0 }),
            getDirection: () => 0,
            setDirection: vi.fn(),
            setMoving: vi.fn(),
            isMoving: () => false,
        })),
        stopAndUpdate: vi.fn(),
        getPlayerInfo: vi.fn((id: number) => byId.get(id)),
        getNearbyPlayers: vi.fn(() => Array.from(byId.values())),
        getBubbleUserIds: vi.fn((id: number) => bubbles.find((userIds) => userIds.includes(id))),
        getIsFollowingPath: vi.fn(() => followingPath),
        hasPathfinding: vi.fn(() => true),
        moveToWithPathfinding: vi.fn(async () => {
            followingPath = true;
            return true;
        }),
        updatePathFollowing: vi.fn(),
        cancelPathfinding: vi.fn(() => {
            followingPath = false;
        }),
        stop: vi.fn(),
        moveTo: vi.fn(),
        sendPosition: vi.fn(),
        sendStreamMessage: vi.fn(),
        startTyping: vi.fn(),
        stopTyping: vi.fn(),
    };
}

function player(userId: number, availabilityStatus: number = AvailabilityStatus.ONLINE, x = 100): FakePlayer {
    return { userId, name: `Player ${userId}`, position: { x, y: 0 }, availabilityStatus };
}

function target(behavior: SocialBehavior): number | null {
    return (behavior as any).targetPlayerId;
}

function lookForPeople(behavior: SocialBehavior): void {
    (behavior as any).checkForConversations((behavior as any).config);
}

describe('SocialBehavior approach', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('walks up to online players and players whose status is unknown', () => {
        for (const status of [AvailabilityStatus.ONLINE, AvailabilityStatus.UNCHANGED]) {
            const behavior = new SocialBehavior(createConfig());
            behavior.setBot(createBot([player(1, status)]) as any);
            lookForPeople(behavior);
            expect(target(behavior), `status ${status}`).toBe(1);
        }
    });

    it('leaves away, busy, do-not-disturb and no-meeting players alone', () => {
        for (const status of [
            AvailabilityStatus.AWAY,
            AvailabilityStatus.BUSY,
            AvailabilityStatus.DO_NOT_DISTURB,
            AvailabilityStatus.DENY_PROXIMITY_MEETING,
        ]) {
            const behavior = new SocialBehavior(createConfig());
            behavior.setBot(createBot([player(1, status)]) as any);
            lookForPeople(behavior);
            expect(target(behavior), `status ${status}`).toBeNull();
        }
    });

    it('does not walk into a conversation the player is having with someone else', () => {
        const bot = createBot([player(1), player(2)]);
        bot.bubbles.push([1, 3]);
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        lookForPeople(behavior);
        expect(target(behavior)).toBe(2);
    });

    it('gives up after the approach time limit and puts the player on cooldown', () => {
        const bot = createBot([player(1)]);
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        lookForPeople(behavior);
        expect(target(behavior)).toBe(1);
        bot.setFollowingPath(true);

        vi.setSystemTime(1_000_000 + APPROACH_TIMEOUT_MS + 1);
        behavior.update(16);

        expect(target(behavior)).toBeNull();
        expect(bot.cancelPathfinding).toHaveBeenCalled();
        lookForPeople(behavior);
        expect(target(behavior)).toBeNull();
    });

    it('stops chasing a player who walks far away from its area', () => {
        const bot = createBot([player(1)]);
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        lookForPeople(behavior);
        expect(target(behavior)).toBe(1);
        bot.setFollowingPath(true);

        bot.byId.get(1)!.position = { x: 1000, y: 0 };
        behavior.update(16);

        expect(target(behavior)).toBeNull();
    });

    it('stops approaching when the player turns on do not disturb', () => {
        const bot = createBot([player(1)]);
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        lookForPeople(behavior);
        expect(target(behavior)).toBe(1);
        bot.setFollowingPath(true);

        bot.byId.get(1)!.availabilityStatus = AvailabilityStatus.DO_NOT_DISTURB;
        behavior.update(16);

        expect(target(behavior)).toBeNull();
    });

    it('retries a declined path, then gives up on a player it cannot reach', async () => {
        const bot = createBot([player(1)]);
        bot.moveToWithPathfinding.mockResolvedValue(false);
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        lookForPeople(behavior);
        expect(target(behavior)).toBe(1);

        // A declined path can be temporary (cooldown after a path ended), so the bot keeps its target
        await (behavior as any).approachPlayer(1, (behavior as any).config);
        expect(target(behavior)).toBe(1);

        // ...but waits before asking again
        await (behavior as any).approachPlayer(1, (behavior as any).config);
        expect(bot.moveToWithPathfinding).toHaveBeenCalledTimes(1);

        // and gives up once the approach time limit passes
        vi.setSystemTime(1_000_000 + APPROACH_TIMEOUT_MS + 1);
        behavior.update(16);
        expect(target(behavior)).toBeNull();
    });

    it('notices people while walking a wander path', () => {
        const bot = createBot([player(1)]);
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        bot.setFollowingPath(true);

        behavior.update(16);

        expect(target(behavior)).toBe(1);
        expect(bot.cancelPathfinding).toHaveBeenCalled();
    });
});

describe('SocialBehavior greetings', () => {
    function createAi() {
        return {
            generateBotResponseStream: vi.fn(async function* (..._args: unknown[]) {
                yield { content: 'Hi!', done: true };
            }),
        };
    }

    it('opens a conversation it started with a reason for coming over', async () => {
        const bot = createBot([player(1)], { aiProviderRef: 'provider-1' });
        const ai = createAi();
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        behavior.setServices(ai as any, {} as any);
        lookForPeople(behavior);

        behavior.onSpaceJoined(SPACE);
        await behavior.onSpaceUserJoined(SPACE, { id: 1, name: 'Player 1', spaceUserId: 'room_1' } as any);
        // onMemoryReady only runs for users with a uuid, so trigger the deferred greeting directly
        (behavior as any).onMemoryReady(SPACE, { id: 1 });
        await vi.waitFor(() => expect(ai.generateBotResponseStream).toHaveBeenCalled());

        const prompt = ai.generateBotResponseStream.mock.calls[0][2] as string;
        expect(prompt).toContain('walked over to start a conversation');
        expect(prompt).toContain('fits your character');
        expect(prompt).not.toContain('just approached you');
    });

    it('greets a player it walked up to even when they have no uuid', async () => {
        const bot = createBot([player(1)], { aiProviderRef: 'provider-1' });
        const ai = createAi();
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        behavior.setServices(ai as any, {} as any);
        lookForPeople(behavior);

        behavior.onSpaceJoined(SPACE);
        // No uuid, so BaseBehavior never calls onMemoryReady
        await behavior.onSpaceUserJoined(SPACE, { id: 1, name: 'Player 1', spaceUserId: 'room_1' } as any);
        await vi.waitFor(() => expect(ai.generateBotResponseStream).toHaveBeenCalledTimes(1));

        expect(ai.generateBotResponseStream.mock.calls[0][2]).toContain('walked over to start a conversation');
    });

    it('greets a player it walked up to only once when they have a uuid', async () => {
        const bot = createBot([player(1)], { aiProviderRef: 'provider-1' });
        const ai = createAi();
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        behavior.setServices(ai as any, {} as any);
        lookForPeople(behavior);

        behavior.onSpaceJoined(SPACE);
        await behavior.onSpaceUserJoined(SPACE, { id: 1, name: 'Player 1', spaceUserId: 'room_1', uuid: 'u-1' } as any);
        await vi.waitFor(() => expect(ai.generateBotResponseStream).toHaveBeenCalled());

        expect(ai.generateBotResponseStream).toHaveBeenCalledTimes(1);
    });

    it('greets a player who walked up with the regular prompt', async () => {
        const bot = createBot([player(1)], { aiProviderRef: 'provider-1' });
        const ai = createAi();
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        behavior.setServices(ai as any, {} as any);

        behavior.onSpaceJoined(SPACE);
        await behavior.onSpaceUserJoined(SPACE, { id: 1, name: 'Player 1', spaceUserId: 'room_1' } as any);
        await vi.waitFor(() => expect(ai.generateBotResponseStream).toHaveBeenCalled());

        expect(ai.generateBotResponseStream.mock.calls[0][2]).toContain('just approached you');
    });

    it('only greets players who are in the bubble, not bystanders nearby', () => {
        const bot = createBot([player(1), player(2)], { aiProviderRef: 'provider-1' });
        const ai = createAi();
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        behavior.setServices(ai as any, {} as any);

        behavior.onSpaceJoined(SPACE);

        expect(ai.generateBotResponseStream).not.toHaveBeenCalled();
        expect((behavior as any).activeConversations.size).toBe(0);
    });

    it('stays silent when the bot has no AI provider', async () => {
        const bot = createBot([player(1)]);
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);

        behavior.onSpaceJoined(SPACE);
        await behavior.onSpaceUserJoined(SPACE, { id: 1, name: 'Player 1', spaceUserId: 'room_1' } as any);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(bot.sendStreamMessage).not.toHaveBeenCalled();
    });

    it('does not greet again when a player messages after the conversation was reset', async () => {
        const bot = createBot([player(1)], { aiProviderRef: 'provider-1' });
        const ai = createAi();
        const behavior = new SocialBehavior(createConfig());
        behavior.setBot(bot as any);
        behavior.setServices(ai as any, {} as any);
        (behavior as any).currentSpaceName = SPACE;

        // No active conversation (e.g. dropped by the duration cap) and no uuid, so no reply is generated either
        await behavior.onChatMessage(SPACE, 'still there?', 1);

        expect((behavior as any).activeConversations.has(1)).toBe(true);
        expect(ai.generateBotResponseStream).not.toHaveBeenCalled();
    });
});
