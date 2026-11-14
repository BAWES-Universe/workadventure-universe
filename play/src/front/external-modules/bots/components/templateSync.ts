/**
 * Parts of a template's update that the owner took and that a Brick's page has not read yet (game #2008). Orbit already
 * has them; the page shows the old text until it reads the Brick again, and saving the line or the Personality in that time
 * would put the old text back. One read at a time: a second look while one is on its way shares it, so two reads never
 * come back in the wrong order.
 */
export function templateSync<Fresh>(
    /** Reads the Brick again. Throws when Orbit cannot be reached. */
    read: () => Promise<Fresh>,
    /** Shows the parts on the page. */
    apply: (fresh: Fresh, parts: string[]) => void
) {
    let unsynced: string[] = [];
    let running: Promise<boolean> | undefined;

    async function once(): Promise<boolean> {
        const parts = unsynced;
        if (parts.length === 0) return true;
        let fresh: Fresh;
        try {
            fresh = await read();
        } catch (error) {
            console.warn("Could not read a Brick after a template update", error);
            return false;
        }
        apply(fresh, parts);
        // Parts taken while this read was on its way stay for the next one
        unsynced = unsynced.filter((part) => !parts.includes(part));
        return true;
    }

    /** Reads until nothing is left: true once the page shows everything that was taken, false when Orbit could not be reached. */
    async function sync(): Promise<boolean> {
        for (let round = 0; round < 3; round++) {
            if (unsynced.length === 0) return true;
            if (!running) {
                running = once().finally(() => {
                    running = undefined;
                });
            }
            // eslint-disable-next-line no-await-in-loop
            if (!(await running)) return false;
        }
        return unsynced.length === 0;
    }

    return {
        /** Parts taken: they are unread until `sync` says so. */
        add(parts: readonly string[]) {
            unsynced = [...new Set([...unsynced, ...parts])];
        },
        /** Another Brick's page: nothing is waiting any more. */
        clear() {
            unsynced = [];
        },
        /** Whether one of these parts is waiting to be read. */
        waitsFor(parts: readonly string[]): boolean {
            return unsynced.some((part) => parts.includes(part));
        },
        sync,
    };
}
