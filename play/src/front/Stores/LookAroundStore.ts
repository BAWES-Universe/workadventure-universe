import { writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";

/** How many pixels the Look around sheet covers at the bottom of the screen (a phone), so the map overlay can keep the "You" tab clear of it. */
export const lookAroundBottomCoverStore = writable<number>(0);

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
