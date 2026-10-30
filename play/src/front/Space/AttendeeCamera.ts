import type { Readable, Unsubscriber } from "svelte/store";
import { derived } from "svelte/store";
import type { LocalStreamStoreValue } from "../Stores/MediaStore";
import { stageSeesOurCameraStore } from "../Stores/MediaStore";
import type { SpaceInterface } from "./SpaceInterface";

/** Our camera is on: the local stream holds a live camera track. */
export function cameraOnStore(localStreamStore: Readable<LocalStreamStoreValue>): Readable<boolean> {
    return derived(
        localStreamStore,
        ($localStream) =>
            $localStream.type === "success" &&
            ($localStream.stream?.getVideoTracks().some((track) => track.readyState === "live") ?? false)
    );
}

/**
 * In the Audience of a Stage that sees the audience's cameras (#1623): our camera is shown to the speakers whenever
 * it is on. Nobody's camera is turned on for them. `onShown` runs each time it starts being shown (walking in with the
 * camera on, or turning it on later), so that we are told. Stopping (the returned function) stops showing it.
 * Meanwhile the camera does not go to sleep while we stand still: the speakers may be watching it.
 */
export function showCameraToSpeakers(
    space: SpaceInterface,
    cameraOn: Readable<boolean>,
    onShown: () => void
): Unsubscriber {
    let shown = false;
    stageSeesOurCameraStore.set(true);
    const unsubscribe = cameraOn.subscribe((on) => {
        space.showCameraToStreamers(on);
        if (on && !shown) {
            onShown();
        }
        shown = on;
    });
    return () => {
        unsubscribe();
        space.showCameraToStreamers(false);
        stageSeesOurCameraStore.set(false);
    };
}
