import type { Readable, Unsubscriber } from "svelte/store";
import { derived, writable } from "svelte/store";
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
 * The Stages whose speakers see the audience's cameras (#1623), by the names the Audience joins them with, as the
 * server last sent them. The server follows the same list, so a camera is only shown where the server lets it be.
 */
export const attendeeCameraAreaSpacesStore = writable<ReadonlySet<string>>(new Set());

/** The Stage joined under this name sees the audience's cameras, as the server last said. */
export function stageSeesCamerasStore(spaceName: string): Readable<boolean> {
    return derived(attendeeCameraAreaSpacesStore, ($spaces) => $spaces.has(spaceName));
}

/**
 * In the Audience of a Stage (#1623): while the Stage sees the audience's cameras, our camera is shown to the speakers
 * whenever it is on. Nobody's camera is turned on for them. The Stage can turn the setting off and on again while we
 * stay: the camera stops being shown, then is shown again. `onShown` runs each time it starts being shown (walking in
 * with the camera on, turning it on later, the Stage turning the setting back on), so that we are told. Stopping (the
 * returned function) stops showing it. Meanwhile the camera does not go to sleep while we stand still: the speakers
 * may be watching it.
 */
export function showCameraToSpeakers(
    space: SpaceInterface,
    cameraOn: Readable<boolean>,
    stageSeesCameras: Readable<boolean>,
    onShown: () => void
): Unsubscriber {
    stopShowingCameraToSpeakers();
    let shown = false;
    let stopped = false;
    const unsubscribe = derived([cameraOn, stageSeesCameras], ([$cameraOn, $stageSeesCameras]) => ({
        seen: $stageSeesCameras,
        show: $cameraOn && $stageSeesCameras,
    })).subscribe(({ seen, show }) => {
        stageSeesOurCameraStore.set(seen);
        space.showCameraToStreamers(show);
        if (show && !shown) {
            onShown();
        }
        shown = show;
    });
    const stop = () => {
        if (stopped) {
            return;
        }
        stopped = true;
        if (stopShowing === stop) {
            stopShowing = undefined;
        }
        unsubscribe();
        space.showCameraToStreamers(false);
        stageSeesOurCameraStore.set(false);
    };
    stopShowing = stop;
    return stop;
}

let stopShowing: (() => void) | undefined;

/** Stops showing our camera to the speakers, if it is shown: the scene closes without leaving the Audience. */
export function stopShowingCameraToSpeakers(): void {
    stopShowing?.();
}
