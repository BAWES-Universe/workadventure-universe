import { writable } from "svelte/store";

/** The lockable room the player stands in (#1622), for the "Lock room" button. Undefined outside one. */
export interface LockableRoomState {
    areaId: string;
    /** The room's name, empty when it has none */
    name: string;
    locked: boolean;
    /** Whether this player may press the button now: lock it, or unlock it */
    canToggle: boolean;
}

export const lockableRoomStore = writable<LockableRoomState | undefined>(undefined);
