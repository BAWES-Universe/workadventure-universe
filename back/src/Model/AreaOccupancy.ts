import type { AreaData } from "@workadventure/map-editor";
import {
    AREA_LOCK_KEY,
    AREA_USERS_INSIDE_KEY,
    canTagsLockArea,
    getActiveLockableProperty,
    getActiveMaxUsersProperty,
    isPlayerPositionInArea,
} from "@workadventure/map-editor";
import type { AreaPropertyVariableMessage } from "@workadventure/messages";
import { hasPermission, Permission } from "@workadventure/shared-utils/src/Permissions/permissions";
import { isBot } from "../Services/AreaSpaceRights";
import type { PositionInterface } from "./PositionInterface";

/** What the occupancy count needs to know about a player. */
export interface OccupantLike {
    id: number;
    uuid: string;
    tags: string[];
    getPosition(): PositionInterface;
}

/** What locking a room needs to know about the player who asks. */
export interface LockerLike extends OccupantLike {
    isLogged: boolean;
    permissions: number;
}

interface TrackedArea {
    area: AreaData;
    /** The "Max people" setting, when it is on and sets a limit */
    maxUsers?: { propertyId: string; maxUsers: number };
    /** The "Lockable room" setting, when it is on */
    lockable?: { propertyId: string; allowedTags?: string[] };
    locked: boolean;
    /** The players inside, by id */
    inside: Set<number>;
}

/**
 * The live state of the areas that people can be kept out of: how many people are inside each area with a "Max
 * people" setting (#1621), and whether each lockable room is locked (#1622). Each change is sent to the room (see
 * GameRoom), and a player who arrives gets the whole state with the room (see getVariables).
 *
 * Bots never count and never lock: a bot cannot take the last seat. Admins count like anyone else once inside: they
 * may walk into a full room, but they still take a seat.
 *
 * The state lives in memory only. The back keeps every player of a room, so the counts are rebuilt from the players'
 * positions whenever the room's areas change. A locked room opens by itself once nobody is inside.
 */
export class AreaOccupancy {
    private tracked = new Map<string, TrackedArea>();

    constructor(private readonly send: (message: AreaPropertyVariableMessage) => void) {}

    /**
     * Reads the room's areas again (at start, or after an area was created, changed or deleted) and recounts who is
     * inside the ones that can keep people out. Whatever differs from what the room was last told is sent.
     */
    public setAreas(areas: Iterable<AreaData>, users: Iterable<OccupantLike>): void {
        const previous = this.tracked;
        this.tracked = new Map();
        for (const area of areas) {
            const maxUsers = getActiveMaxUsersProperty(area);
            const lockable = getActiveLockableProperty(area);
            if (maxUsers === undefined && lockable === undefined) {
                continue;
            }
            this.tracked.set(area.id, {
                area,
                maxUsers: maxUsers && { propertyId: maxUsers.id, maxUsers: maxUsers.maxUsers },
                lockable: lockable && { propertyId: lockable.id, allowedTags: lockable.allowedTags },
                locked: false,
                inside: new Set(),
            });
        }

        for (const user of users) {
            if (isBot(user)) {
                continue;
            }
            for (const tracked of this.tracked.values()) {
                if (isPlayerPositionInArea(user.getPosition(), tracked.area)) {
                    tracked.inside.add(user.id);
                }
            }
        }

        for (const [areaId, tracked] of this.tracked) {
            const before = previous.get(areaId);
            if (tracked.maxUsers !== undefined) {
                if (
                    before?.maxUsers === undefined ||
                    before.maxUsers.propertyId !== tracked.maxUsers.propertyId ||
                    before.inside.size !== tracked.inside.size
                ) {
                    this.sendCount(areaId, tracked);
                }
            }
            if (tracked.lockable !== undefined) {
                // A room stays locked through an edit of its area, as long as someone is still inside it.
                const wasLocked =
                    before?.lockable?.propertyId === tracked.lockable.propertyId && before.locked === true;
                tracked.locked = wasLocked && tracked.inside.size > 0;
                if (before?.lockable?.propertyId !== tracked.lockable.propertyId || tracked.locked !== wasLocked) {
                    this.sendLock(areaId, tracked);
                }
            }
        }
    }

    /** A player arrived in the room, or moved. */
    public userMoved(user: OccupantLike): void {
        if (isBot(user)) {
            return;
        }
        for (const [areaId, tracked] of this.tracked) {
            const wasInside = tracked.inside.has(user.id);
            const isInside = isPlayerPositionInArea(user.getPosition(), tracked.area);
            if (wasInside === isInside) {
                continue;
            }
            if (isInside) {
                tracked.inside.add(user.id);
            } else {
                tracked.inside.delete(user.id);
            }
            this.peopleChanged(areaId, tracked);
        }
    }

    /** A player left the room. */
    public userLeft(user: OccupantLike): void {
        for (const [areaId, tracked] of this.tracked) {
            if (tracked.inside.delete(user.id)) {
                this.peopleChanged(areaId, tracked);
            }
        }
    }

    /**
     * Locks or unlocks a lockable room for a player who asks (#1622). Locking takes someone signed in and inside the
     * room, with one of the tags the room names (or any, when it names none). Unlocking takes the same, or the Owner
     * or an Admin from anywhere. The Owner and Admins skip the tag check. Bots never lock or unlock.
     *
     * @returns whether the room changed
     */
    public setLocked(user: LockerLike, areaId: string, propertyId: string, locked: boolean): boolean {
        const tracked = this.tracked.get(areaId);
        if (tracked?.lockable === undefined || tracked.lockable.propertyId !== propertyId || isBot(user)) {
            return false;
        }
        if (tracked.locked === locked) {
            return false;
        }
        const manages = hasPermission(user.permissions, Permission.KICK_FROM_ROOM);
        const inside = tracked.inside.has(user.id);
        const insideWithRight = inside && (manages || (user.isLogged && canTagsLockArea(tracked.lockable, user.tags)));
        const allowed = locked ? insideWithRight : insideWithRight || manages;
        if (!allowed) {
            return false;
        }
        tracked.locked = locked;
        this.sendLock(areaId, tracked);
        return true;
    }

    /** The whole state, for a player who arrives in the room. */
    public getVariables(): AreaPropertyVariableMessage[] {
        const messages: AreaPropertyVariableMessage[] = [];
        for (const [areaId, tracked] of this.tracked) {
            if (tracked.maxUsers !== undefined) {
                messages.push(this.toCountMessage(areaId, tracked));
            }
            if (tracked.lockable !== undefined) {
                messages.push(this.toLockMessage(areaId, tracked));
            }
        }
        return messages;
    }

    /**
     * Whether a room that is full or locked has one of these positions inside and the other outside, so the two
     * players cannot meet in a bubble across its edge (see GameRoom).
     */
    public separatesClosedArea(position1: PositionInterface, position2: PositionInterface): boolean {
        for (const tracked of this.tracked.values()) {
            const full = tracked.maxUsers !== undefined && tracked.inside.size >= tracked.maxUsers.maxUsers;
            if (!full && !tracked.locked) {
                continue;
            }
            if (isPlayerPositionInArea(position1, tracked.area) !== isPlayerPositionInArea(position2, tracked.area)) {
                return true;
            }
        }
        return false;
    }

    private peopleChanged(areaId: string, tracked: TrackedArea): void {
        if (tracked.maxUsers !== undefined) {
            this.sendCount(areaId, tracked);
        }
        // The last person walked out: the room opens again.
        if (tracked.locked && tracked.inside.size === 0) {
            tracked.locked = false;
            this.sendLock(areaId, tracked);
        }
    }

    private sendCount(areaId: string, tracked: TrackedArea): void {
        this.send(this.toCountMessage(areaId, tracked));
    }

    private sendLock(areaId: string, tracked: TrackedArea): void {
        this.send(this.toLockMessage(areaId, tracked));
    }

    private toCountMessage(areaId: string, tracked: TrackedArea): AreaPropertyVariableMessage {
        return {
            areaId,
            propertyId: tracked.maxUsers?.propertyId ?? "",
            key: AREA_USERS_INSIDE_KEY,
            value: tracked.inside.size.toString(),
        };
    }

    private toLockMessage(areaId: string, tracked: TrackedArea): AreaPropertyVariableMessage {
        return {
            areaId,
            propertyId: tracked.lockable?.propertyId ?? "",
            key: AREA_LOCK_KEY,
            value: tracked.locked ? "true" : "false",
        };
    }
}
