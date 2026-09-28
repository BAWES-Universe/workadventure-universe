import { derived, get } from "svelte/store";
import LL from "../../i18n/i18n-svelte";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { gameManager } from "../Phaser/Game/GameManager";
import { canOfferInvitation } from "./QuestModel";
import {
    fadeQuestInvitation,
    questAnnouncementStore,
    questArrivalStore,
    questAvailablePathsStore,
    questStateStore,
    questWorldStore,
    showQuestInvitation,
} from "./QuestStore";
import { questSurfaceSuppressed } from "./QuestUiStores";
import { isPathCompletable } from "./QuestWorld";

/** The invitation appears this long after the first moment nothing covers the game. */
export const INVITATION_DELAY_MS = 1_500;
/** Walking around this long without answering fades the invitation (not a decline). */
export const INVITATION_FADE_AFTER_MOVING_MS = 45_000;
const MOVEMENT_SAMPLE_MS = 1_000;

/**
 * Times the arrival invitation: once per arrival, 1.5 s after the first free moment once the map, the host and any
 * `#moveTo` walk are settled. While it is up, 45 s of walking without a tap fades it, as does leaving the map.
 * Timers only act while a map is current. Returns the function that stops everything.
 */
export function startQuestArrival(): () => void {
    let offeredThisArrival = false;
    let unavailableReported = false;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let movementTimer: ReturnType<typeof setInterval> | undefined;
    let movedMs = 0;
    let lastPosition: { x: number; y: number } | undefined;

    const clearShow = () => {
        if (showTimer) clearTimeout(showTimer);
        showTimer = undefined;
    };
    const stopWatchingMovement = () => {
        if (movementTimer) clearInterval(movementTimer);
        movementTimer = undefined;
        movedMs = 0;
        lastPosition = undefined;
    };

    const inputs = derived(
        [questArrivalStore, questStateStore, questAvailablePathsStore, questSurfaceSuppressed, questWorldStore],
        (values) => values
    );

    const stop = inputs.subscribe(([$arrival, $state, $paths, $suppressed, $world]) => {
        if ($arrival === "waiting") {
            // Leaving the map with the invitation up: it fades, it is not a decline.
            if ($state.surface === "invitation") fadeQuestInvitation();
            offeredThisArrival = false;
            unavailableReported = false;
            clearShow();
        }

        const offerable = $arrival === "ready" && !offeredThisArrival && $world.ready && canOfferInvitation($state);
        // The invitation waits for something that can be done right now (Meet alone in the room can only wait).
        const doable = $paths.filter((path) => isPathCompletable($world, path));
        if (offerable && doable.length === 0 && !unavailableReported) {
            unavailableReported = true;
            analyticsClient.questGiverUnavailable({ reason: "no-eligible-target" });
        }
        if (!offerable || doable.length === 0 || $suppressed) {
            clearShow();
        } else {
            showTimer ??= setTimeout(() => {
                showTimer = undefined;
                if (!gameManager.tryGetCurrentGameScene()) return;
                // Count the arrival as offered only once the invitation is really up, so a refused show can retry.
                if (!showQuestInvitation()) return;
                offeredThisArrival = true;
                questAnnouncementStore.push(get(LL).quest.invitation.line());
            }, INVITATION_DELAY_MS);
        }

        // Read the surface fresh: fading the invitation above can re-run this subscriber synchronously, and the
        // stale `$state` would then restart the movement timer that the nested run just stopped.
        if (get(questStateStore).surface !== "invitation") {
            stopWatchingMovement();
        } else {
            movementTimer ??= setInterval(() => {
                const player = gameManager.tryGetCurrentGameScene()?.CurrentPlayer;
                if (!player) return;
                const position = { x: player.x, y: player.y };
                if (lastPosition && (lastPosition.x !== position.x || lastPosition.y !== position.y)) {
                    movedMs += MOVEMENT_SAMPLE_MS;
                }
                lastPosition = position;
                if (movedMs >= INVITATION_FADE_AFTER_MOVING_MS) {
                    stopWatchingMovement();
                    fadeQuestInvitation();
                }
            }, MOVEMENT_SAMPLE_MS);
        }
    });

    return () => {
        stop();
        clearShow();
        stopWatchingMovement();
    };
}
