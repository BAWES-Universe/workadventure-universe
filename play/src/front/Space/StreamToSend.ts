import type { Readable } from "svelte/store";
import { derived } from "svelte/store";
import type { LocalStreamStoreValue } from "../Stores/MediaStore";
import { callMicGate, cameraAllowedIn, microphoneAllowedIn, type CallMicGate } from "./CallMicGate";

/**
 * What we send to the others in a space: everything while we stream, our camera alone while we show it to the people
 * streaming (an attendee of a Stage that sees the audience's cameras, #1623), and nothing otherwise. The camera alone
 * never carries our microphone, so the speakers see the attendee without hearing them.
 */
export function streamToSend(
    localStreamStore: Readable<LocalStreamStoreValue>,
    space: {
        isStreamingStore: Readable<boolean>;
        showsCameraToStreamersStore: Readable<boolean>;
        /** Only needed to be told apart from a call's space (#2004); a space without a name is never one. */
        getName?: () => string;
    },
    callGate: Readable<CallMicGate | undefined> = callMicGate
): Readable<LocalStreamStoreValue | undefined> {
    // The same camera keeps the same stream, so that what we send is not replaced each time something else changes.
    let lastCameraTrack: MediaStreamTrack | undefined;
    let lastCameraOnly: MediaStream | undefined;
    // The same tracks keep the same stream, so that what we send is not replaced each time the gate changes.
    let lastTracks: MediaStreamTrack[] = [];
    let lastGated: MediaStream | undefined;
    const gated = (stream: MediaStream, microphone: boolean, camera: boolean): LocalStreamStoreValue | undefined => {
        if (microphone && camera) return { type: "success", stream };
        const tracks = [...(camera ? stream.getVideoTracks() : []), ...(microphone ? stream.getAudioTracks() : [])];
        if (tracks.length === 0) return undefined;
        if (!lastGated || tracks.length !== lastTracks.length || tracks.some((track, i) => track !== lastTracks[i])) {
            lastTracks = tracks;
            lastGated = new MediaStream(tracks);
        }
        return { type: "success", stream: lastGated };
    };
    return derived(
        [localStreamStore, space.isStreamingStore, space.showsCameraToStreamersStore, callGate],
        ([$localStream, $isStreaming, $showsCamera, $callGate]): LocalStreamStoreValue | undefined => {
            const name = space.getName?.();
            if ($isStreaming) {
                // While a call is live, what each space may carry follows the call (never the microphone in two places)
                if (name === undefined || !$callGate || $localStream.type !== "success" || !$localStream.stream) {
                    return $localStream;
                }
                return gated(
                    $localStream.stream,
                    microphoneAllowedIn(name, $callGate),
                    cameraAllowedIn(name, $callGate)
                );
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
