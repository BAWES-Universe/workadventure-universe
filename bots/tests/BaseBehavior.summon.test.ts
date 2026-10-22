/**
 * Tests for BaseBehavior.startSummon — who may call a bot over, and the typed refusal the API turns into a line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseBehavior } from '../behaviors/BaseBehavior';
import type { BehaviorConfig } from '../behaviors/BaseBehavior';
import { BotBusyError } from '../utils/summonErrors';

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

    seed(options: { engagedUserIds?: number[]; known?: Record<string, number>; returning?: boolean }): void {
        this.bot = {
            getState: () => ({ getPosition: () => ({ x: 10, y: 10 }) }),
            getIsFollowingPath: () => false,
            cancelPathfinding: vi.fn(),
        } as never;
        for (const userId of options.engagedUserIds ?? []) {
            this.engagedWithUsers.set(userId, { spaceName: 's' });
        }
        for (const [uuid, userId] of Object.entries(options.known ?? {})) {
            this.userIdToUuid.set(userId, uuid);
        }
        this.isReturning = options.returning ?? false;
    }
    summonedPlayer(): string | null {
        return this.summonedPlayerUuid;
    }
}

const target = { x: 100, y: 100 };

describe('BaseBehavior.startSummon', () => {
    let behavior: TestableBehavior;

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        behavior = new TestableBehavior();
    });

    it('calls a free bot over, as today', () => {
        behavior.seed({});
        expect(() => behavior.startSummon('guest-uuid', target)).not.toThrow();
        expect(behavior.summonedPlayer()).toBe('guest-uuid');
    });

    it('calls a bot over that is walking back to its spot, as today', () => {
        behavior.seed({ engagedUserIds: [5], returning: true });
        expect(() => behavior.startSummon('guest-uuid', target)).not.toThrow();
    });

    it('refuses with a busy error when the bot is with someone else', () => {
        behavior.seed({ engagedUserIds: [5], known: { 'guest-uuid': 9, other: 5 } });
        let error: unknown;
        try {
            behavior.startSummon('guest-uuid', target);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(BotBusyError);
        expect((error as BotBusyError).withYou).toBe(false);
        expect(behavior.summonedPlayer()).toBeNull();
    });

    it('refuses with a busy error when the bot is with several people, you among them', () => {
        behavior.seed({ engagedUserIds: [5, 9], known: { 'guest-uuid': 9 } });
        expect(() => behavior.startSummon('guest-uuid', target)).toThrow(BotBusyError);
        try {
            behavior.startSummon('guest-uuid', target);
        } catch (e) {
            expect((e as BotBusyError).withYou).toBe(false);
        }
    });

    it('says the bot is already with you when you are the only one it is with', () => {
        behavior.seed({ engagedUserIds: [9], known: { 'guest-uuid': 9 } });
        let error: unknown;
        try {
            behavior.startSummon('guest-uuid', target);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(BotBusyError);
        expect((error as BotBusyError).withYou).toBe(true);
    });

    it('does not say "with you" for a player the bot has not seen join', () => {
        behavior.seed({ engagedUserIds: [9] });
        try {
            behavior.startSummon('unknown-uuid', target);
        } catch (e) {
            expect((e as BotBusyError).withYou).toBe(false);
        }
    });
});
