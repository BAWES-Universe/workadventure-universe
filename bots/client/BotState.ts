/**
 * BotState - Manages bot's internal state (position, direction, movement)
 */

import type { PositionInterface } from '../types/Position';
import { PositionMessage_Direction } from '@workadventure/messages';

export class BotState {
    private position: PositionInterface;
    private direction: PositionMessage_Direction = PositionMessage_Direction.DOWN;
    private moving: boolean = false;
    private lastMovedAt = 0;

    constructor(initialPosition: PositionInterface) {
        this.position = { ...initialPosition };
    }

    getPosition(): PositionInterface {
        return { ...this.position };
    }

    setPosition(position: PositionInterface): void {
        if (position.x !== this.position.x || position.y !== this.position.y) {
            this.lastMovedAt = Date.now();
        }
        this.position = { ...position };
    }

    /** When the position last changed (ms since epoch), 0 if never. Unlike isMoving(), this goes stale once the bot stands still. */
    getLastMovedAt(): number {
        return this.lastMovedAt;
    }

    getDirection(): PositionMessage_Direction {
        return this.direction;
    }

    setDirection(direction: PositionMessage_Direction): void {
        this.direction = direction;
    }

    isMoving(): boolean {
        return this.moving;
    }

    setMoving(moving: boolean): void {
        this.moving = moving;
    }
}

