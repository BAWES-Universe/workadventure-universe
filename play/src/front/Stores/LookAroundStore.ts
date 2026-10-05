import { writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";

/** The Places panel (areas and objects of the room) is open on the right while looking around. */
export const lookAroundPlacesOpenStore = writable<boolean>(false);

/** Zoom level before "Look around the map" opened: the "You are here" box shows what that zoom normally shows. */
export const lookAroundNormalZoomStore = writable<number | undefined>(undefined);

/** Becomes true after the first real drag while looking around; the drag hint goes once it is true. */
function createLookAroundDraggedStore() {
    const { subscribe, set } = writable<boolean>(localUserStore.getLookAroundHintSeen());
    return {
        subscribe,
        set: (value: boolean) => {
            if (value) localUserStore.setLookAroundHintSeen(true);
            set(value);
        },
    };
}
export const lookAroundDraggedStore = createLookAroundDraggedStore();
