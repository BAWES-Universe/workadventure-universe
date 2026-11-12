/**
 * HomedBrickBehavior (game #2005): a Brick that lives in a room, standing at the spot its owner picked.
 *
 * It stays where it is and answers whoever talks to it. It does not greet anyone: a greeting would be paid for out of its
 * owner's key for people who never asked for it, and a Brick at home answers people, it does not welcome them.
 */
import { IdleBehavior } from './IdleBehavior';
import type { SpaceUser } from '@workadventure/messages';

export class HomedBrickBehavior extends IdleBehavior {
    /** A Brick at home greets nobody: whoever speaks to it is answered. */
    protected onMemoryReady(_spaceName: string, _user: SpaceUser & { id: number }): void {
        // Nothing: no greeting, and so nothing for its owner's key to pay for
    }
}
