import type { Readable } from "svelte/store";
import { derived } from "svelte/store";
import type { LocalStreamStoreValue } from "../Stores/MediaStore";

/**
 * What we send to the others in a space: everything while we stream, our camera alone while we show it to the people
 * streaming (an attendee of a Stage that sees the audience's cameras, #1623), and nothing otherwise. The camera alone
 * never carries our microphone, so the speakers see the attendee without hearing them.
 */
export function streamToSend(
    localStreamStore: Readable<LocalStreamStoreValue>,
    space: { isStreamingStore: Readable<boolean>; showsCameraToStreamersStore: Readable<boolean> }
): Readable<LocalStreamStoreValue | undefined> {
    // The same camera keeps the same stream, so that what we send is not replaced each time something else changes.
    let lastCameraTrack: MediaStreamTrack | undefined;
    let lastCameraOnly: MediaStream | undefined;
    return derived(
        [localStreamStore, space.isStreamingStore, space.showsCameraToStreamersStore],
        ([$localStream, $isStreaming, $showsCamera]): LocalStreamStoreValue | undefined => {
            if ($isStreaming) {
                return $localStream;
            }
            if (!$showsCamera || $localStream.type !== "success" || !$localStream.stream) {
                return undefined;
            }
            const cameraTrack = $localStream.stream.getVideoTracks()[0];
            if (!cameraTrack) {
                return undefined;
            }
            if (cameraTrack !== lastCameraTrack || !lastCameraOnly) {
                lastCameraTrack = cameraTrack;
                lastCameraOnly = new MediaStream([cameraTrack]);
            }
            return { type: "success", stream: lastCameraOnly };
        }
    );
}
