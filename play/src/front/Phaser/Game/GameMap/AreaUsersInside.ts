import type { AreaPropertyVariableMessage } from "@workadventure/messages";
import { AREA_USERS_INSIDE_KEY } from "@workadventure/map-editor";
import type { Observable, Subscription } from "rxjs";
import { Subject } from "rxjs";

/**
 * How many people are inside each area with a "Max people" setting (#1621), as the server counts them (AreaOccupancy
 * in the back). Filled with the counts that came with the room, then kept up to date by the room's messages.
 */
export class AreaUsersInside {
    private readonly counts = new Map<string, { propertyId: string; count: number }>();
    private readonly changesSubject = new Subject<string>();
    private readonly subscription: Subscription;

    /** The id of each area whose count changed. */
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

    public destroy(): void {
        this.subscription.unsubscribe();
        this.changesSubject.complete();
    }

    private apply(message: AreaPropertyVariableMessage, notify: boolean): void {
        if (message.key !== AREA_USERS_INSIDE_KEY) {
            return;
        }
        const count = Number(message.value);
        if (!Number.isFinite(count)) {
            return;
        }
        this.counts.set(message.areaId, { propertyId: message.propertyId, count });
        if (notify) {
            this.changesSubject.next(message.areaId);
        }
    }
}
