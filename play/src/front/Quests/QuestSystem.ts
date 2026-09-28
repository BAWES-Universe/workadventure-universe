import type { Readable } from "svelte/store";
import { derived } from "svelte/store";
import { whenGameScene } from "../Phaser/Game/WhenGameScene";
import { gameSceneStore } from "../Stores/GameSceneStore";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { armQuestScene } from "./QuestDetectors";
import type { QuestVisibleSurface } from "./QuestModel";
import { questsOnOffer, visibleSurface } from "./QuestModel";
import {
    dispatchQuest,
    questAvailablePathsStore,
    questDevice,
    questStateStore,
    questWorldStore,
    revealPendingQuest,
} from "./QuestStore";
import { questPillSuppressed, questQuiet, questSuppressionStore, questSurfaceSuppressed } from "./QuestUiStores";

/** A completion plays once the dock has been free this long. */
export const PAYOFF_SETTLE_MS = 500;
/** A tracked pill hidden this long leaves a dot on the Quests row. */
export const SUPPRESSED_NEWS_MS = 60_000;

/** What the dock renders now. The resting Quests pill only where the room offers something (see visibleSurface). */
export const questVisibleSurfaceStore: Readable<QuestVisibleSurface> = derived(
    [questStateStore, questSuppressionStore, questAvailablePathsStore, questWorldStore],
    ([$state, $suppression, $available, $world]) =>
        visibleSurface($state, $suppression, questsOnOffer($state, $available, $world.ready))
);

let users = 0;
let stop: (() => void) | undefined;

/**
 * Starts the detectors (re-armed on every map, torn down while there is none), the celebration timing and the news dot.
 * Reference-counted: the dock calls it on mount and the returned function on destroy.
 */
export function startQuestSystem(): () => void {
    users += 1;
    if (users === 1) stop = start();
    let released = false;
    return () => {
        if (released) return;
        released = true;
        users -= 1;
        if (users === 0) {
            stop?.();
            stop = undefined;
        }
    };
}

function start(): () => void {
    const cleanups: Array<() => void> = [];

    // Detectors: armed per map through whenGameScene, disarmed when the map goes (reconnect, room change).
    let disarm: (() => void) | undefined;
    cleanups.push(
        gameSceneStore.subscribe((scene) => {
            if (scene === undefined) {
                disarm?.();
                disarm = undefined;
                return;
            }
            if (disarm) return;
            disarm = whenGameScene((loaded) => {
                // Runs inside a store update: a throw here would stop the whole interface updating.
                try {
                    return armQuestScene(loaded);
                } catch (error) {
                    console.error("Quests: could not watch this map", error);
                    return undefined;
                }
            });
        })
    );
    cleanups.push(() => {
        disarm?.();
        disarm = undefined;
    });

    // Celebration: plays once the dock has been free (not suppressed, not quiet) for a moment.
    let freeSince: number | undefined;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    const blockedStore = derived(
        [questSurfaceSuppressed, questQuiet],
        ([$suppressed, $quiet]) => $suppressed || $quiet
    );
    cleanups.push(
        derived([questStateStore, blockedStore], (values) => values).subscribe(([$state, $blocked]) => {
            if (revealTimer) clearTimeout(revealTimer);
            revealTimer = undefined;
            if ($blocked) {
                freeSince = undefined;
                if ($state.pending.length > 0) revealPendingQuest(true);
                return;
            }
            const now = Date.now();
            freeSince ??= now;
            if ($state.pending.length === 0) return;
            const wait = Math.max(0, PAYOFF_SETTLE_MS - (now - freeSince));
            revealTimer = setTimeout(() => {
                revealTimer = undefined;
                revealPendingQuest(false);
            }, wait);
        })
    );
    cleanups.push(() => {
        if (revealTimer) clearTimeout(revealTimer);
    });

    // News: the tracked pill stayed hidden for a minute.
    let newsTimer: ReturnType<typeof setTimeout> | undefined;
    cleanups.push(
        derived([questStateStore, questPillSuppressed], (values) => values).subscribe(([$state, $pillSuppressed]) => {
            const waiting = $state.tracked !== null && $pillSuppressed && !$state.news;
            if (!waiting) {
                if (newsTimer) clearTimeout(newsTimer);
                newsTimer = undefined;
                return;
            }
            newsTimer ??= setTimeout(() => {
                newsTimer = undefined;
                dispatchQuest({ type: "news" });
                analyticsClient.questTracker({ action: "suppressed", device: questDevice() });
            }, SUPPRESSED_NEWS_MS);
        })
    );
    cleanups.push(() => {
        if (newsTimer) clearTimeout(newsTimer);
    });

    return () => {
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    };
}
