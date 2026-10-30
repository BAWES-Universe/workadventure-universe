import type { AreaData } from "@workadventure/map-editor";
import { AREA_USERS_INSIDE_KEY, getActiveMaxUsersProperty, isPlayerPositionInArea } from "@workadventure/map-editor";
import type { AreaPropertyVariableMessage } from "@workadventure/messages";
import { isBot } from "../Services/AreaSpaceRights";
import type { PositionInterface } from "./PositionInterface";

/** What the occupancy count needs to know about a player. */
export interface OccupantLike {
    id: number;
    uuid: string;
    tags: string[];
    getPosition(): PositionInterface;
}

interface TrackedArea {
    area: AreaData;
    propertyId: string;
    maxUsers: number;
    /** The players inside, by id */
    inside: Set<number>;
}

/**
 * Counts the people inside each area that has a "Max people" setting (#1621), so everyone in the room knows when one
 * is full before reaching it. Each change of a count is sent to the room (see GameRoom), and a player who arrives gets
 * every count with the room (see getVariables).
 *
 * Bots never count: a bot cannot take the last seat. Admins count like anyone else once
 * inside: they may walk into a full room, but they still take a seat.
 *
 * The counts live in memory only. The back keeps every player of a room, so they are rebuilt from the players'
 * positions whenever the room's areas change.
 */
export class AreaOccupancy {
    private tracked = new Map<string, TrackedArea>();

    constructor(private readonly send: (message: AreaPropertyVariableMessage) => void) {}

    /**
     * Reads the room's areas again (at start, or after an area was created, changed or deleted) and recounts who is
     * inside the ones with a "Max people" setting. A count that differs from what the room was last told is sent.
     */
    public setAreas(areas: Iterable<AreaData>, users: Iterable<OccupantLike>): void {
        const previous = this.tracked;
        this.tracked = new Map();
        for (const area of areas) {
            const property = getActiveMaxUsersProperty(area);
            if (property === undefined) {
                continue;
            }
            this.tracked.set(area.id, {
                area,
                propertyId: property.id,
                maxUsers: property.maxUsers,
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
            if (
                before === undefined ||
                before.propertyId !== tracked.propertyId ||
                before.inside.size !== tracked.inside.size
            ) {
                this.sendCount(areaId, tracked);
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
            this.sendCount(areaId, tracked);
        }
    }

    /** A player left the room. */
    public userLeft(user: OccupantLike): void {
        for (const [areaId, tracked] of this.tracked) {
            if (tracked.inside.delete(user.id)) {
                this.sendCount(areaId, tracked);
            }
        }
    }

    /** Every count, for a player who arrives in the room. */
    public getVariables(): AreaPropertyVariableMessage[] {
        return [...this.tracked].map(([areaId, tracked]) => this.toMessage(areaId, tracked));
    }

    /**
     * Whether the area is full and this position is on the other side of its edge from that one, so the two players
     * cannot meet in a bubble across it (see GameRoom).
     */
    public separatesFullArea(position1: PositionInterface, position2: PositionInterface): boolean {
        for (const tracked of this.tracked.values()) {
            if (tracked.inside.size < tracked.maxUsers) {
                continue;
            }
            if (isPlayerPositionInArea(position1, tracked.area) !== isPlayerPositionInArea(position2, tracked.area)) {
                return true;
            }
        }
        return false;
    }

    private sendCount(areaId: string, tracked: TrackedArea): void {
        this.send(this.toMessage(areaId, tracked));
    }

    private toMessage(areaId: string, tracked: TrackedArea): AreaPropertyVariableMessage {
        return {
            areaId,
            propertyId: tracked.propertyId,
            key: AREA_USERS_INSIDE_KEY,
            value: tracked.inside.size.toString(),
        };
    }
}
