import { get, writable } from "svelte/store";
import { videoStreamElementsStore } from "./PeerStore";
import { visibilityStore } from "./VisibilityStore";
import { isLiveStreamingStore } from "./IsStreamingStore";

/**
 * A store that contains "true" if the webcam should be stopped for privacy reasons - i.e. if the user leaves the page while not in a discussion.
 */
function createPrivacyShutdownStore() {
    let privacyEnabled = false;

    const { subscribe, set } = writable(privacyEnabled);

    // It is ok to not unsubscribe to this store because it is a singleton.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    visibilityStore.subscribe((isVisible) => {
        if (!isVisible && get(videoStreamElementsStore).length === 0 && !get(isLiveStreamingStore)) {
            privacyEnabled = true;
            set(true);
        }
        if (isVisible) {
            privacyEnabled = false;
            set(false);
        }
    });

    // It is ok to not unsubscribe to this store because it is a singleton.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    videoStreamElementsStore.subscribe((peerElements) => {
        // Someone speaking live (on the megaphone, in a meeting) stays live when the last person near them leaves.
        if (peerElements.length === 0 && get(visibilityStore) === false && !get(isLiveStreamingStore)) {
            privacyEnabled = true;
            set(true);
        }
    });

    // It is ok to not unsubscribe to this store because it is a singleton.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    isLiveStreamingStore.subscribe((isLive) => {
        // Ending a live session in the background, with nobody near, goes away as leaving the game alone would.
        if (!isLive && get(videoStreamElementsStore).length === 0 && get(visibilityStore) === false) {
            privacyEnabled = true;
            set(true);
        }
    });

    // A touch, a click or a key on the page means someone is looking at it, whatever the browser last said: a phone can
    // come back from another app without saying the page is visible again, and the game then stayed away, with the
    // camera and mic held off, until the page was hidden and shown once more.
    const back = () => {
        if (!privacyEnabled) return;
        privacyEnabled = false;
        set(false);
    };
    if (typeof document !== "undefined") {
        for (const type of ["pointerdown", "touchstart", "keydown"]) {
            document.addEventListener(type, back, { capture: true, passive: true });
        }
    }

    return {
        subscribe,
    };
}

export const privacyShutdownStore = createPrivacyShutdownStore();
