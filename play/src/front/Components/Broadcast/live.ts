import { get } from "svelte/store";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import type { BroadcastReach } from "../../Stores/BroadcastStore";
import { broadcastReachInfoStore } from "../../Stores/BroadcastStore";
import {
    currentLiveStreamingSpaceStore,
    liveBroadcastStore,
    megaphoneSpacesStore,
    requestedMegaphoneStore,
} from "../../Stores/MegaphoneStore";
import { streamingMegaphoneStore } from "../../Stores/MediaStore";
import { reachName } from "./reach";

/** Goes live on the space of that reach: everyone listening on it gets this player's camera, mic or screen. */
export function startLiveBroadcast(reach: BroadcastReach): boolean {
    const space = get(megaphoneSpacesStore).get(reach);
    if (!space) {
        console.warn(`Broadcast: no space joined for the ${reach} reach`);
        return false;
    }
    analyticsClient.startMegaphone();
    currentLiveStreamingSpaceStore.set(space);
    requestedMegaphoneStore.set(true);
    space.startStreaming();
    liveBroadcastStore.set({
        scope: reach,
        reachLabel: reachName(reach, get(broadcastReachInfoStore)),
        startedAt: Date.now(),
    });
    return true;
}

/** Ends the live broadcast: the tile and the Live pill go, the bar's buttons lose their ring. */
export function endLiveBroadcast(): void {
    const live = get(liveBroadcastStore);
    if (live) {
        analyticsClient.stopMegaphone();
        get(megaphoneSpacesStore).get(live.scope)?.stopStreaming();
    }
    liveBroadcastStore.set(undefined);
    currentLiveStreamingSpaceStore.set(undefined);
    requestedMegaphoneStore.set(false);
    streamingMegaphoneStore.set(false);
}
