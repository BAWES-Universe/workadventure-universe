import { writable } from "svelte/store";

export function createSilentStore() {
    const { subscribe, set } = writable<boolean>(false);

    let area = false;
    let others = false;
    // Silence found at the spawn point before the map listeners have run. The first position update replaces it.
    let spawn = false;

    const updateSilent = () => {
        set(area || others || spawn);
    };

    return {
        subscribe,

        setAreaSilent(silent: boolean) {
            area = silent;
            updateSilent();
        },

        setOthersSilent(silent: boolean) {
            others = silent;
            updateSilent();
        },

        /**
         * Marks the player as silent from the moment they appear in a silent zone, so the room join already carries
         * it. It is dropped once the map has evaluated the player's position.
         */
        setSpawnSilent(silent: boolean) {
            spawn = silent;
            updateSilent();
        },
    };
}
