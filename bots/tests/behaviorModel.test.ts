/**
 * Tests for the bot behaviour model: old types map to "where it moves" + "goes to people", new fields win,
 * and spawn and live edits get the same defaults.
 */
import { describe, expect, it } from 'vitest';

import {
    behaviorClassFor,
    buildBehaviorConfig,
    DEFAULT_NOTICE_RANGE,
    legacyTypeFor,
    resolveBehaviorModel,
} from '../behaviors/behaviorModel';

const space = { center: { x: 100, y: 200 }, radius: 160 };

describe('resolveBehaviorModel', () => {
    it('maps the three old types to one answer pair each', () => {
        expect(resolveBehaviorModel('idle', {})).toEqual({ moves: 'stay', goesToPeople: false });
        expect(resolveBehaviorModel('patrol', {})).toEqual({ moves: 'route', goesToPeople: false });
        expect(resolveBehaviorModel('social', {})).toEqual({ moves: 'wander', goesToPeople: true });
    });

    it('lets the new fields win over the old type', () => {
        expect(resolveBehaviorModel('patrol', { goesToPeople: true })).toEqual({ moves: 'route', goesToPeople: true });
        expect(resolveBehaviorModel('idle', { moves: 'wander' })).toEqual({ moves: 'wander', goesToPeople: false });
    });

    it('ignores junk in the new fields and falls back to idle for unknown types', () => {
        expect(resolveBehaviorModel('social', { moves: 'fly', goesToPeople: 'yes' })).toEqual({ moves: 'wander', goesToPeople: true });
        expect(resolveBehaviorModel(undefined, undefined)).toEqual({ moves: 'stay', goesToPeople: false });
        expect(resolveBehaviorModel('dance', {})).toEqual({ moves: 'stay', goesToPeople: false });
    });
});

describe('behaviorClassFor and legacyTypeFor', () => {
    it('keeps bots that do not go to people on their old class', () => {
        expect(behaviorClassFor({ moves: 'stay', goesToPeople: false })).toBe('idle');
        expect(behaviorClassFor({ moves: 'route', goesToPeople: false })).toBe('patrol');
        expect(behaviorClassFor({ moves: 'wander', goesToPeople: false })).toBe('social');
    });

    it('runs every bot that goes to people on the social behaviour', () => {
        for (const moves of ['stay', 'wander', 'route'] as const) {
            expect(behaviorClassFor({ moves, goesToPeople: true })).toBe('social');
        }
    });

    it('labels a model with the closest old type', () => {
        expect(legacyTypeFor({ moves: 'route', goesToPeople: true })).toBe('patrol');
        expect(legacyTypeFor({ moves: 'stay', goesToPeople: true })).toBe('idle');
        expect(legacyTypeFor({ moves: 'wander', goesToPeople: false })).toBe('social');
    });
});

describe('buildBehaviorConfig', () => {
    it('defaults patrol bots to answering people, so an edit no longer silences them', () => {
        const { kind, config } = buildBehaviorConfig('patrol', { patrolWaypoints: [{ x: 1, y: 2 }] }, space);
        expect(kind).toBe('patrol');
        expect(config.respondToPlayers).toBe(true);
        expect(config.waypoints).toEqual([{ x: 1, y: 2 }]);
        expect(config.loop).toBe(true);
        expect(config.pauseAtWaypoints).toBe(0);
        expect(config.speed).toBe(50);
    });

    it('keeps an explicit respondToPlayers false', () => {
        expect(buildBehaviorConfig('patrol', { respondToPlayers: false }, space).config.respondToPlayers).toBe(false);
    });

    it('prefers the saved patrolWaypoints over a stale waypoints copy and drops bad points', () => {
        const { config } = buildBehaviorConfig('patrol', {
            patrolWaypoints: [{ x: 5, y: 6 }, { x: 'a' }, null],
            waypoints: [{ x: 9, y: 9 }],
        });
        expect(config.waypoints).toEqual([{ x: 5, y: 6 }]);
    });

    it('uses one notice range default, the one the editor shows', () => {
        const { config } = buildBehaviorConfig('social', {}, space);
        expect(config.conversationRadius).toBe(DEFAULT_NOTICE_RANGE);
        expect(buildBehaviorConfig('social', { conversationRadius: 240 }, space).config.conversationRadius).toBe(240);
    });

    it('wanders inside the assigned space, from behaviorConfig first', () => {
        const own = { center: { x: 1, y: 1 }, radius: 64 };
        const { config } = buildBehaviorConfig('social', { assignedSpace: own }, space);
        expect(config.wanderCenter).toEqual(own.center);
        expect(config.wanderRadius).toBe(64);
        expect(config.assignedSpace).toEqual(own);
        expect(buildBehaviorConfig('social', {}, space).config.wanderCenter).toEqual(space.center);
    });

    it('builds a route bot that goes to people as a social bot with its stops', () => {
        const { kind, model, config } = buildBehaviorConfig(
            'patrol',
            { goesToPeople: true, patrolWaypoints: [{ x: 0, y: 0 }, { x: 64, y: 0 }], loop: false, pauseAtWaypoints: 5 },
            space
        );
        expect(kind).toBe('social');
        expect(model).toEqual({ moves: 'route', goesToPeople: true });
        expect(config.type).toBe('social');
        expect(config.moves).toBe('route');
        expect(config.waypoints).toEqual([{ x: 0, y: 0 }, { x: 64, y: 0 }]);
        expect(config.loop).toBe(false);
        expect(config.pauseAtWaypoints).toBe(5);
        expect(config.conversationRadius).toBe(DEFAULT_NOTICE_RANGE);
    });

    it('builds a door greeter (stays put, goes to people) as a social bot that stays', () => {
        const { kind, config } = buildBehaviorConfig('idle', { goesToPeople: true }, space);
        expect(kind).toBe('social');
        expect(config.moves).toBe('stay');
        expect(config.goesToPeople).toBe(true);
    });
});
