import { derived, get, readable, writable } from "svelte/store";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import { appViewportHeight, titleBarHeightStore } from "../TitleBar/WindowControlsOverlay";
import { mobileLayoutStore } from "./MobileLayoutStore";
import { bringOpenHereInFront, sideWindowInFrontStore, windowBehindCardStore } from "./SideWindowInFrontStore";
import { clampOpenHereRatio, OPEN_HERE_START_RATIO } from "./OpenHereWidth";

export function createCoWebsiteStore() {
    const { subscribe, set, update } = writable<Array<CoWebsite>>([]);

    const add = (coWebsite: CoWebsite, position?: number) => {
        if (position || position === 0) {
            update((currentArray) => {
                const newArray = [...currentArray];
                if (position === 0) {
                    newArray.unshift(coWebsite);
                } else if (currentArray.length > position) {
                    newArray.splice(position, 0, coWebsite);
                } else {
                    newArray.push(coWebsite);
                }
                return newArray;
            });
        } else {
            update((currentArray) => [...currentArray, coWebsite]);
        }
        bringOpenHereInFront();
        if (get({ subscribe }).length === 1) {
            // The window opens at a third of the screen, or at the width the map asked for. (A phone's sheet has no width.)
            const coWebsiteWidthPercent = coWebsite.getWidthPercent();
            coWebsiteRatio.set(
                coWebsiteWidthPercent ? clampOpenHereRatio(coWebsiteWidthPercent / 100) : OPEN_HERE_START_RATIO
            );
        }
    };

    const removalListeners = new Set<(removes: (coWebsite: CoWebsite) => boolean) => void>();

    /**
     * Tells when something asks for items to go (a zone left, a map script, a close), whether or not they are open: what
     * was closed a moment ago and could be brought back must not come back after its owner asked for it to go.
     */
    const onRemoval = (listener: (removes: (coWebsite: CoWebsite) => boolean) => void): (() => void) => {
        removalListeners.add(listener);
        return () => removalListeners.delete(listener);
    };

    const announceRemoval = (removes: (coWebsite: CoWebsite) => boolean) => {
        removalListeners.forEach((listener) => listener(removes));
    };

    const remove = (coWebsite: CoWebsite) => {
        announceRemoval((other) => other.getId() === coWebsite.getId());
        update((currentArray) =>
            currentArray.filter((currentCoWebsite) => currentCoWebsite.getId() !== coWebsite.getId())
        );
    };

    const removeAll = () => {
        announceRemoval(() => true);
        set([]);
    };

    /**
     * Only keep the cowebsites matching the predicate.
     */
    const keepOnly = (predicate: (coWebsite: CoWebsite) => boolean) => {
        announceRemoval((coWebsite) => !predicate(coWebsite));
        update((currentArray) => currentArray.filter(predicate));
    };

    /**
     * Brings back items that were closed, each where it was among the others. Whatever was opened since stays after them.
     */
    const restore = (before: Array<CoWebsite>, closed: Array<CoWebsite>) => {
        update((currentArray) => {
            const current = new Set(currentArray);
            const closedSet = new Set(closed);
            const beforeSet = new Set(before);
            return [
                ...before.filter((coWebsite) => current.has(coWebsite) || closedSet.has(coWebsite)),
                ...currentArray.filter((coWebsite) => !beforeSet.has(coWebsite)),
            ];
        });
    };

    const findById = (id: string) => {
        return get({ subscribe }).find((coWebsite) => coWebsite.getId() === id);
    };

    const empty = () => {
        announceRemoval(() => true);
        set([]);
    };

    return {
        subscribe,
        add,
        remove,
        removeAll,
        empty,
        keepOnly,
        restore,
        findById,
        onRemoval,
    };
}

export const coWebsites = createCoWebsiteStore();

export const fullScreenCowebsite = writable(false);

/** The item picked in the window of files and links, kept here so closing everything can bring it back picked. */
export const activeCoWebsiteStore = writable<CoWebsite | undefined>(undefined);

const browserWindowSize = readable({ width: window.innerWidth, height: window.innerHeight }, (set) => {
    const handleResize = () => {
        set({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => {
        window.removeEventListener("resize", handleResize);
    };
});

/** What the game and its windows are laid out in: the browser window, less the installed app's title bar (if any). */
export const windowSize = derived([browserWindowSize, titleBarHeightStore], ([$size, $titleBarHeight]) => ({
    width: $size.width,
    height: Math.max(0, $size.height - $titleBarHeight),
    // Portrait or landscape is judged on the whole browser window, like the CSS orientation queries, not on the page under the strip.
    portrait: $size.width <= $size.height,
}));

export const coWebsiteRatio = writable(0.5);

/**
 * Files and links open in a window that floats over the game, like Orbit's, and the map keeps its size. An upright
 * phone is the exception: there the window is a sheet from the bottom, built like chat's (OpenHereSheetStore.ts); the
 * map keeps its size there too.
 */
export const openHereFloatsStore = derived(
    [mobileLayoutStore, windowSize],
    ([$mobileLayout, $windowSize]) => !($mobileLayout && $windowSize.portrait)
);

/**
 * The window of files and links is showing and is in front of Orbit, which opens in the same place: opened or tapped
 * last, and no menu or card has sent it behind.
 */
export const openHereInFrontOfOrbitStore = derived(
    [coWebsites, openHereFloatsStore, sideWindowInFrontStore, windowBehindCardStore],
    ([$coWebsites, $openHereFloats, $sideWindowInFront, $windowBehindCard]) =>
        $coWebsites.length > 0 && $openHereFloats && $sideWindowInFront === "openHere" && !$windowBehindCard
);

/** The map is never resized for files and links: the window floats over it, or rises over it as a sheet. */
export const canvasSize = derived(windowSize, ($windowSize) => ({
    width: window.innerWidth,
    height: $windowSize.height,
}));

export const coWebsitesSize = derived(
    [coWebsites, windowSize, coWebsiteRatio],
    ([$coWebsites, $windowSize, $coWebsiteRatio]) => {
        if ($coWebsites.length === 0) {
            return { width: 0, height: 0 };
        }
        if ($windowSize.portrait) {
            return {
                width: $windowSize.width,
                height: $windowSize.height * $coWebsiteRatio,
            };
        } else {
            return {
                width: $windowSize.width * $coWebsiteRatio,
                height: $windowSize.height,
            };
        }
    }
);

export class CoWebsiteManager {
    get verticalMode(): boolean {
        return window.innerWidth <= window.innerHeight;
    }

    // FIXME: can we use stores to recompute this instead?
    private calculateNewWidth() {
        if (!this.verticalMode && get(coWebsites).length > 0) {
            return Math.round(window.innerWidth * (1 - get(coWebsiteRatio)));
        } else {
            return window.innerWidth;
        }
    }

    private calculateNewHeight() {
        if (this.verticalMode && get(coWebsites).length > 0) {
            return Math.round(appViewportHeight() - (1 - get(coWebsiteRatio)));
        } else {
            return appViewportHeight();
        }
    }

    public getGameSize(): { height: number; width: number } {
        // FIXME: replace this with a subscription to the store
        return get(canvasSize);
    }

    public generateUniqueId() {
        let id = undefined;
        do {
            id = "cowebsite-iframe-" + (Math.random() + 1).toString(36).substring(7);
        } while (coWebsites.findById(id));

        return id;
    }

    public cleanup(): void {
        coWebsites.removeAll();
    }
}

export const coWebsiteManager = new CoWebsiteManager();
