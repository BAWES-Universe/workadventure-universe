import type { AreaPropertyVariableMessage } from "@workadventure/messages";
import { AREA_LOCK_KEY, AREA_USERS_INSIDE_KEY } from "@workadventure/map-editor";
import type { Observable, Subscription } from "rxjs";
import { Subject } from "rxjs";

/**
 * The live state of the rooms people can be kept out of, as the server keeps it (AreaOccupancy in the back): how many
 * people are inside each area with a "Max people" setting (#1621), and whether each lockable room is locked (#1622).
 * Filled with the state that came with the room, then kept up to date by the room's messages.
 */
export class AreaLiveState {
    private readonly counts = new Map<string, { propertyId: string; count: number }>();
    private readonly locks = new Map<string, { propertyId: string; locked: boolean }>();
    private readonly changesSubject = new Subject<string>();
    private readonly subscription: Subscription;

    /** The id of each area whose state changed. */
    public readonly changes: Observable<string> = this.changesSubject.asObservable();

    constructor(initial: AreaPropertyVariableMessage[], updates: Observable<AreaPropertyVariableMessage>) {
        for (const message of initial) {
            this.apply(message, false);
        }
        this.subscription = updates.subscribe((message) => this.apply(message, true));
    }

    /** How many people are inside the area, as counted for this "Max people" setting. 0 when nothing is known yet. */
    public getCount(areaId: string, propertyId: string): number {
        const entry = this.counts.get(areaId);
        return entry !== undefined && entry.propertyId === propertyId ? entry.count : 0;
    }

    /** Whether the room is locked by this "Lockable room" setting. */
    public isLocked(areaId: string, propertyId: string): boolean {
        const entry = this.locks.get(areaId);
        return entry !== undefined && entry.propertyId === propertyId && entry.locked;
    }

    public destroy(): void {
        this.subscription.unsubscribe();
        this.changesSubject.complete();
    }

    private apply(message: AreaPropertyVariableMessage, notify: boolean): void {
        if (message.key === AREA_USERS_INSIDE_KEY) {
            const count = Number(message.value);
            if (!Number.isFinite(count)) {
                return;
            }
            this.counts.set(message.areaId, { propertyId: message.propertyId, count });
        } else if (message.key === AREA_LOCK_KEY) {
            this.locks.set(message.areaId, { propertyId: message.propertyId, locked: message.value === "true" });
        } else {
            return;
        }
        if (notify) {
            this.changesSubject.next(message.areaId);
        }
    }
}
