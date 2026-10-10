import { describe, it, expect } from 'vitest';
import type { PositionInterface, ViewportInterface } from '../types/Position';

describe('Position and Viewport Types', () => {
    it('satisfies PositionInterface contract', () => {
        const pos: PositionInterface = { x: 10, y: 20 };
        expect(pos.x).toBe(10);
        expect(pos.y).toBe(20);
    });

    it('satisfies ViewportInterface contract', () => {
        const vp: ViewportInterface = { left: 0, top: 0, right: 800, bottom: 600 };
        expect(vp.right - vp.left).toBe(800);
        expect(vp.bottom - vp.top).toBe(600);
    });
});
