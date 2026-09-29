/**
 * Tests for where a bot goes when the bot editor switches it to idle: back onto its square.
 */
import { describe, expect, it } from 'vitest';
import { idleHomeAfterSwitch } from '../server/BotManager';

const config = { assignedSpace: { center: { x: 400, y: 500 }, radius: 100 } };

describe('idleHomeAfterSwitch', () => {
    it('sends a bot switched to idle to the center of its square', () => {
        expect(idleHomeAfterSwitch({ behaviorType: 'idle' }, config, 'social')).toEqual({ x: 400, y: 500 });
    });

    it('prefers the square carried by the update', () => {
        const updates = {
            behaviorType: 'idle' as const,
            behaviorConfig: { assignedSpace: { center: { x: 10, y: 20 }, radius: 0 } },
        };
        expect(idleHomeAfterSwitch(updates, config, 'patrol')).toEqual({ x: 10, y: 20 });
    });

    it('leaves the bot alone for other behaviors, or when the update already moves it', () => {
        expect(idleHomeAfterSwitch({ behaviorType: 'social' }, config, 'idle')).toBeUndefined();
        expect(idleHomeAfterSwitch({ behaviorConfig: { conversationRadius: 80 } }, config, 'social')).toBeUndefined();
        expect(idleHomeAfterSwitch({ behaviorType: 'idle', position: { x: 1, y: 2 } }, config, 'social')).toBeUndefined();
    });

    it('leaves an idle bot alone when a save repeats its type', () => {
        expect(idleHomeAfterSwitch({ behaviorType: 'idle' }, config, 'idle')).toBeUndefined();
    });
});
