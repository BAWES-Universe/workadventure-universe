/**
 * BotState - Manages bot's internal state (position, direction, movement)
 */

import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import { PositionMessage_Direction } from '@workadventure/messages';

export class BotState {
    private position: PositionInterface;
    private direction: PositionMessage_Direction = PositionMessage_Direction.DOWN;
    private moving: boolean = false;

    constructor(initialPosition: PositionInterface) {
        this.position = { ...initialPosition };
    }

    getPosition(): PositionInterface {
        return { ...this.position };
    }

    setPosition(position: PositionInterface): void {
        this.position = { ...position };
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

