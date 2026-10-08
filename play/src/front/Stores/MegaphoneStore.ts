import type { Readable } from "svelte/store";
import { derived, writable } from "svelte/store";
import type { MegaphoneChannel } from "@workadventure/messages";
import { slugify } from "@workadventure/shared-utils/src/Jitsi/slugify";
import type { SpaceInterface } from "../Space/SpaceInterface";
import { isSpeakerStore, requestedCameraState, requestedMicrophoneState } from "./MediaStore";
import { requestedScreenSharingState } from "./ScreenSharingStore";

export const currentLiveStreamingSpaceStore = writable<SpaceInterface | undefined>();
/** True when this player may go live on at least one reach of this room. */
export const megaphoneCanBeUsedStore = writable<boolean>(false);

export const requestedMegaphoneStore = writable<boolean>(false);

/**
 * Every broadcast channel this room listens to (this room, this world, everywhere in the universe) and whether this
 * player may go live on each. Sent by the server on join and again whenever the room's broadcast settings change.
 */
export const megaphoneChannelsStore = writable<MegaphoneChannel[]>([]);

/** The spaces joined for those channels, by scope ("ROOM", "WORLD", "UNIVERSE"). */
export const megaphoneSpacesStore = writable<Map<string, SpaceInterface>>(new Map());

/**
 * The server took this player out of a space (a kick): if it was a broadcast channel's space, forget it, so a live
 * broadcast on that channel ends and the channel is joined again on the next sync.
 */
export function forgetMegaphoneSpace(spaceName: string): void {
    const name = slugify(spaceName);
    megaphoneSpacesStore.update((spaces) => {
        const next = new Map(spaces);
        for (const [scope, space] of spaces) {
            if (space.getName() === name) next.delete(scope);
        }
        return next;
    });
}

export interface LiveBroadcast {
    /** "ROOM", "WORLD" or "UNIVERSE". */
    scope: string;
    /** The name of what the reach covers: the room's, the world's or the universe's name. */
    reachLabel: string;
    startedAt: number;
}

/** The live broadcast this player is sending right now (the Live pill, the ring on their own tile). */
export const liveBroadcastStore = writable<LiveBroadcast | undefined>(undefined);

/**
 * This store is true if the user is livestreaming, i.e. if the user is a speaker or (if the user has requested the megaphone and is enabling its camera or microphone or screen)
 */
export const liveStreamingEnabledStore: Readable<boolean> = derived(
    [
        isSpeakerStore,
        requestedMegaphoneStore,
        requestedCameraState,
        requestedMicrophoneState,
        requestedScreenSharingState,
    ],
    (
        [
            $isSpeakerStore,
            $requestedMegaphoneStore,
            $requestedCameraState,
            $requestedMicrophoneState,
            $requestedScreenSharingState,
        ],
        set
    ) => {
        set(
            $isSpeakerStore ||
                ($requestedMegaphoneStore &&
                    ($requestedCameraState || $requestedMicrophoneState || $requestedScreenSharingState))
        );
        if (
            $requestedMegaphoneStore &&
            !$requestedCameraState &&
            !$requestedMicrophoneState &&
            !$requestedScreenSharingState
        ) {
            requestedMegaphoneStore.set(false);
        }
    }
);
