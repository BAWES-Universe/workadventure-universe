import { derived } from "svelte/store";
import { followStateStore } from "./FollowStore";
import { listensOnlyStore, isSpeakerStore, silentStore } from "./MediaStore";
import { screenSharingAvailableStore } from "./ScreenSharingStore";
import { videoStreamElementsStore } from "./PeerStore";
export const bottomActionBarVisibilityStore = derived(
    [
        videoStreamElementsStore,
        followStateStore,
        silentStore,
        screenSharingAvailableStore,
        isSpeakerStore,
        listensOnlyStore,
    ],
    ([
        $videoStreamElementsStore,
        $followStateStore,
        $silentStore,
        $screenSharingAvailableStore,
        $isSpeakerStore,
        $listensOnlyStore,
    ]) => {
        return (
            ($videoStreamElementsStore.length > 0 &&
                !$listensOnlyStore &&
                (!$silentStore || $followStateStore != "off" || $screenSharingAvailableStore)) ||
            $isSpeakerStore
        );
    }
);
