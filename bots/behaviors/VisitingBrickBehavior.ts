/**
 * VisitingBrickBehavior (game #2005): a Brick that walks beside the person who brought it along.
 *
 * It stands where it is until its person moves off, then walks to a spot beside them again. It has no space of its own,
 * no roaming and no greeting: a Brick that visits does not welcome people, it answers them when they talk to it. When its
 * person has left the room (or is no longer seen) it tells its manager, which takes it off the map: the visit itself is
 * Orbit's and goes on or ends there.
 */
import { IdleBehavior, type IdleBehaviorConfig } from './IdleBehavior';
import type { SpaceUser } from '@workadventure/messages';

export interface VisitingBrickConfig extends IdleBehaviorConfig {
    /** The person it walks beside, by their game uuid. */
    ownerUuid: string;
    /** Their person is gone from the room: take this Brick off the map. */
    onOwnerGone: () => void;
    /**
     * This Brick's own client sees its person. Said every `VISIT_SEEN_EVERY_MS` at most: it is how Orbit knows the visit is
     * alive, so it ends only after the person is gone for the time Limits gives, and not while they are still here.
     */
    onOwnerSeen?: () => void;
}

/** How far from its person it rests: a little over one tile. */
export const VISIT_REST_DISTANCE = 56;
/** It walks to them again once they are further than this (about three tiles). */
export const VISIT_WALK_AFTER = 110;
/** While someone is talking to it, it follows only when its person is really leaving (about six tiles). */
export const VISIT_WALK_AFTER_WHEN_BUSY = 200;
/**
 * How long its person may go unseen in the room before it leaves too. This is only a short debounce for the moments a
 * person is between rooms or the connection blinks, not a limit: how long a visit lasts after the person has left is
 * Orbit's (Limits, "Bricks", visit survive time).
 */
export const VISIT_GONE_AFTER_MS = 20_000;
/** Unseen this long, it first asks to see the whole room: its usual view ends a few thousand pixels away. */
export const VISIT_LOOK_ACROSS_AFTER_MS = 4_000;
const LOOK_EVERY_MS = 700;
/** After a walk that could not start (no way to the spot), it waits this long before it tries again, from another side. */
export const VISIT_RETRY_AFTER_MS = 3_000;
/** How often Orbit is told the person is still seen (its shortest visit time is minutes). */
export const VISIT_SEEN_EVERY_MS = 30_000;

/** Where it should stand: beside the person, on the side it already is, never on top of them. */
export function spotBeside(person: { x: number; y: number }, from: { x: number; y: number }, rest = VISIT_REST_DISTANCE): { x: number; y: number } {
    const dx = from.x - person.x;
    const dy = from.y - person.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return { x: person.x + rest, y: person.y };
    return { x: Math.round(person.x + (dx / length) * rest), y: Math.round(person.y + (dy / length) * rest) };
}

/**
 * The spots to try, in turn, when one cannot be reached (a wall, a closed-off corner): the side it is on, then each side
 * of its person, and the side it is on again last. Always the same distance from them.
 */
export function spotsAround(person: { x: number; y: number }, from: { x: number; y: number }, rest = VISIT_REST_DISTANCE): { x: number; y: number }[] {
    const first = spotBeside(person, from, rest);
    const dx = first.x - person.x;
    const dy = first.y - person.y;
    return [
        first,
        { x: Math.round(person.x - dy), y: Math.round(person.y + dx) },
        { x: Math.round(person.x + dy), y: Math.round(person.y - dx) },
        { x: Math.round(person.x - dx), y: Math.round(person.y - dy) },
    ];
}

export class VisitingBrickBehavior extends IdleBehavior {
    private readonly ownerUuid: string;
    private readonly onOwnerGone: () => void;
    private readonly onOwnerSeen?: () => void;
    private ownerSeenAt = Date.now();
    private toldSeenAt = 0;
    private lookedAt = 0;
    private told = false;
    private walking = false;
    /** A path was started and has not ended yet: when it ends the Brick must stand still, or it keeps showing as walking. */
    private pathStarted = false;
    private lookedAcross = false;
    private failedSpots = 0;
    private retryAt = 0;

    constructor(config: VisitingBrickConfig) {
        super(config);
        this.ownerUuid = config.ownerUuid;
        this.onOwnerGone = config.onOwnerGone;
        this.onOwnerSeen = config.onOwnerSeen;
    }

    /** A visiting Brick greets nobody: whoever speaks to it is answered. */
    protected onMemoryReady(_spaceName: string, _user: SpaceUser & { id: number }): void {
        // Nothing: no greeting, and so nothing for its owner's key to pay for
    }

    update(deltaTime: number): void {
        super.update(deltaTime);
        this.follow();
    }

    private follow(): void {
        const bot = this.bot;
        if (!bot || this.told) return;
        const now = Date.now();
        if (now - this.lookedAt < LOOK_EVERY_MS) return;
        this.lookedAt = now;

        // A path ends without the Brick stopping (that is left to the behavior): so it says it stands still, once
        if (this.pathStarted && !bot.getIsFollowingPath()) {
            this.pathStarted = false;
            this.walking = false;
            bot.stopAndUpdate();
        }

        const person = bot.getPlayerPositionByUuid(this.ownerUuid);
        if (!person) {
            // Out of its view is not out of the room: on a large map its person may be further than it can see
            if (!this.lookedAcross && now - this.ownerSeenAt >= VISIT_LOOK_ACROSS_AFTER_MS) {
                this.lookedAcross = true;
                bot.lookAcrossTheRoom();
            }
            if (now - this.ownerSeenAt >= VISIT_GONE_AFTER_MS) {
                this.told = true;
                this.onOwnerGone();
            }
            return;
        }
        this.ownerSeenAt = now;
        this.lookedAcross = false;
        if (this.onOwnerSeen && now - this.toldSeenAt >= VISIT_SEEN_EVERY_MS) {
            this.toldSeenAt = now;
            this.onOwnerSeen();
        }

        const here = bot.getState().getPosition();
        const distance = Math.hypot(person.x - here.x, person.y - here.y);
        // While someone is talking to it, it stays unless its person is really leaving
        const limit = this.engagedWithUsers.size > 0 ? VISIT_WALK_AFTER_WHEN_BUSY : VISIT_WALK_AFTER;
        if (distance <= limit) {
            this.failedSpots = 0;
            // A walk that is still going carries on to its spot: it stops when its path ends
            if (!this.pathStarted) this.walking = false;
            return;
        }
        // It is already on its way: the path is worked out again only when the person is well past where it was heading
        if (this.walking && bot.getIsFollowingPath()) return;
        // A spot it could not reach is not asked for again at once: a search for a way costs the whole map
        if (now < this.retryAt) return;
        const spots = spotsAround(person, here);
        const spot = spots[this.failedSpots % spots.length];
        this.walking = true;
        bot.moveToWithPathfinding(spot.x, spot.y)
            .then((started) => {
                if (started) {
                    this.pathStarted = true;
                    this.failedSpots = 0;
                    return;
                }
                this.giveUpOnSpot();
            })
            .catch(() => {
                this.giveUpOnSpot();
            });
    }

    private giveUpOnSpot(): void {
        this.walking = false;
        this.failedSpots += 1;
        this.retryAt = Date.now() + VISIT_RETRY_AFTER_MS;
    }
}
