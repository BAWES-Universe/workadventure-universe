import { derived } from "svelte/store";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { localUserStore } from "../Connection/LocalUserStore";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { bubbleMatesStore } from "../Stores/CurrentPlayerGroupStore";
import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
import { mapEditorToolbarInUseStore, mapExplorationModeStore } from "../Stores/MapEditorStore";
import { liveBroadcastStore } from "../Stores/MegaphoneStore";
import { menuVisiblilityStore, openedMenuStore } from "../Stores/MenuStore";
import { modalVisibilityStore, roomListVisibilityStore } from "../Stores/ModalStore";
import { broadcastInboxStore, broadcastPanelOpenStore } from "../Stores/BroadcastStore";
import { isInRemoteConversation } from "../Stores/StreamableCollectionStore";
import { InstallApp } from "./InstallApp";
import { currentInstallEnvironment } from "./InstallPlatform";

/** In a conversation or a call with someone, or live. */
const talkingStore = derived(
    [isInRemoteConversation, bubbleMatesStore, liveBroadcastStore],
    ([inConversation, mates, live]) => inConversation || mates.length > 0 || live !== undefined
);

/**
 * Nothing else has the player's attention: no conversation or call, no chat, no broadcast (its card, a message that
 * arrived, or being live), no map editor, no open menu or window. The install card shows only then.
 */
const quietStore = derived(
    [
        talkingStore,
        chatVisibilityStore,
        broadcastPanelOpenStore,
        broadcastInboxStore,
        mapEditorToolbarInUseStore,
        mapExplorationModeStore,
        openedMenuStore,
        menuVisiblilityStore,
        modalVisibilityStore,
        roomListVisibilityStore,
    ],
    ([talking, chat, broadcastPanel, broadcastInbox, editing, exploring, menu, settings, modal, roomList]) =>
        !talking &&
        !chat &&
        !broadcastPanel &&
        broadcastInbox.length === 0 &&
        !editing &&
        !exploring &&
        menu === undefined &&
        !settings &&
        !modal &&
        !roomList
);

export const installApp = new InstallApp({
    env: currentInstallEnvironment(),
    quiet: quietStore,
    storage: {
        readCardRecord: () => localUserStore.readInstallCard(),
        writeCardRecord: (record) => localUserStore.writeInstallCard(record),
        clearCardRecord: () => localUserStore.clearInstallCard(),
        isInstallReported: () => localUserStore.isInstallReported(),
        markInstallReported: () => localUserStore.markInstallReported(),
        clearInstallReported: () => localUserStore.clearInstallReported(),
    },
    analytics: {
        cardShown: () => analyticsClient.installCardShown(),
        cardDismissed: () => analyticsClient.installCardDismissed(),
        installed: (source) => analyticsClient.appInstalled(source),
    },
});

/**
 * Starts listening, once, as early as possible: the browser's install event comes a single time and nobody is
 * listening for it later.
 */
export function startInstallApp(): void {
    // The test link, "?installCard=show". Read here, before the game starts: the game changes the address later, when
    // it moves to a room.
    if (new URLSearchParams(window.location.search).get("installCard") === "show") installApp.showForTestLink();
    // Never stopped: it listens as long as the game is open.
    // Only Chrome and Edge can say which of our apps are installed.
    const lookup = (navigator as Navigator & { getInstalledRelatedApps?: () => Promise<readonly unknown[]> })
        .getInstalledRelatedApps;
    installApp.start(window, lookup ? () => lookup.call(navigator) : undefined);

    // "In a room": the game scene is loaded. A conversation that ends is the first good moment.
    // Both subscriptions live as long as the game does.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    gameSceneIsLoadedStore.subscribe((loaded) => {
        if (loaded) installApp.noteInRoom();
    });
    let wasTalking = false;
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    talkingStore.subscribe((talking) => {
        if (wasTalking && !talking) installApp.noteConversationEnded();
        wasTalking = talking;
    });
}
