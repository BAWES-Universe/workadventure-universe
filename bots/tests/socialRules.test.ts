import { describe, expect, it } from 'vitest';
import {
    APPROACH_TIMEOUT_MS,
    AvailabilityStatus,
    buildBotInitiatedGreetingPrompt,
    isAvailableForApproach,
    isInOtherBubble,
    pickFallbackGreeting,
    shouldAbandonApproach,
} from '../behaviors/socialRules';

describe('isAvailableForApproach', () => {
    it('approaches online players and players whose status is not known yet', () => {
        expect(isAvailableForApproach(AvailabilityStatus.ONLINE)).toBe(true);
        expect(isAvailableForApproach(AvailabilityStatus.UNCHANGED)).toBe(true);
        expect(isAvailableForApproach(undefined)).toBe(true);
    });

    it('leaves away, busy, do-not-disturb, no-meeting and in-meeting players alone', () => {
        for (const status of [
            AvailabilityStatus.SILENT,
            AvailabilityStatus.AWAY,
            AvailabilityStatus.JITSI,
            AvailabilityStatus.BBB,
            AvailabilityStatus.DENY_PROXIMITY_MEETING,
            AvailabilityStatus.SPEAKER,
            AvailabilityStatus.BUSY,
            AvailabilityStatus.DO_NOT_DISTURB,
            AvailabilityStatus.BACK_IN_A_MOMENT,
            AvailabilityStatus.LIVEKIT,
            AvailabilityStatus.LISTENER,
        ]) {
            expect(isAvailableForApproach(status), `status ${status}`).toBe(false);
        }
    });
});

describe('isInOtherBubble', () => {
    it('is true only when the player is in a bubble the bot is not part of', () => {
        expect(isInOtherBubble(undefined, 5, 99)).toBe(false);
        expect(isInOtherBubble([1, 2], 5, 99)).toBe(false);
        expect(isInOtherBubble([5, 6], 5, 99)).toBe(true);
        expect(isInOtherBubble([5, 99], 5, 99)).toBe(false);
        expect(isInOtherBubble(undefined, 5, null)).toBe(false);
        expect(isInOtherBubble([5, 6], 5, null)).toBe(true);
    });
});

describe('shouldAbandonApproach', () => {
    const area = { center: { x: 0, y: 0 }, radius: 100 };

    it('keeps going within the time limit and near the area', () => {
        expect(
            shouldAbandonApproach({ now: 1000, approachStartedAt: 0, targetPosition: { x: 150, y: 0 }, area, leashMargin: 100 })
        ).toBe(false);
    });

    it('gives up after the time limit', () => {
        expect(
            shouldAbandonApproach({
                now: APPROACH_TIMEOUT_MS + 1,
                approachStartedAt: 0,
                targetPosition: { x: 0, y: 0 },
                area,
                leashMargin: 100,
            })
        ).toBe(true);
    });

    it('gives up when the target has left the area plus the leash margin', () => {
        expect(
            shouldAbandonApproach({ now: 1000, approachStartedAt: 0, targetPosition: { x: 201, y: 0 }, area, leashMargin: 100 })
        ).toBe(true);
    });

    it('has no leash without an area', () => {
        expect(
            shouldAbandonApproach({ now: 1000, approachStartedAt: 0, targetPosition: { x: 5000, y: 0 }, leashMargin: 100 })
        ).toBe(false);
    });
});

describe('buildBotInitiatedGreetingPrompt', () => {
    it('says the bot walked over and includes the topics', () => {
        const prompt = buildBotInitiatedGreetingPrompt('Sam', false, ['space travel', ' ', 'music']);
        expect(prompt).toContain('noticed Sam nearby and walked over');
        expect(prompt).toContain('space travel, music');
        expect(prompt).not.toContain('approached you');
    });

    it('mentions shared history for returning players', () => {
        expect(buildBotInitiatedGreetingPrompt('Sam', true, [])).toContain('met them before');
        expect(buildBotInitiatedGreetingPrompt(undefined, false, [])).toContain('noticed someone nearby');
    });
});

describe('pickFallbackGreeting', () => {
    it('prefers configured greetings', () => {
        expect(pickFallbackGreeting(['Hey there!', 'Yo!'], ['music'], () => 0.99)).toBe('Yo!');
    });

    it('falls back to a topic opener, then a plain hello', () => {
        expect(pickFallbackGreeting([], ['music'], () => 0)).toBe("Hi! I'd love to chat about music. What do you think?");
        expect(pickFallbackGreeting(undefined, [])).toBe('Hello! How are you doing today?');
    });
});
