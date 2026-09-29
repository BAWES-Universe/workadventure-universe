import { get } from "svelte/store";
import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import { localUserStore } from "../../Connection/LocalUserStore";
import { userIsConnected, adminDashboardActivatedStore } from "../../Stores/MenuStore";
import {
    modalFullScreenStore,
    modalIframeStore,
    modalIframeWindowStore,
    modalVisibilityStore,
} from "../../Stores/ModalStore";
import { gameManager } from "../../Phaser/Game/GameManager";
import { hasCapability } from "../../Connection/Capabilities";
import { isUserNameValid, maxUserNameLength } from "../../Connection/LocalUserUtils";
import type { ModalEvent } from "../../Api/Events/ModalEvent";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { questOrbitLinkStore } from "../../Quests/QuestOrbitLink";
import { watchOrbitQuestEntries } from "../../Quests/QuestOrbitState";
import { questEngineStore } from "../../Quests/QuestEngine";
import { botApiService } from "../bots/services/BotApiService";
import { createQuestEngineHttpClient } from "./questEngineHttp";
import {
    ORBIT_AUTH_VERSION,
    buildAdminLoginUrl,
    isOrbitAuthReadyMessage,
    resolveCredentialUrl,
    type OrbitAuthTokenMessage,
} from "./iframeAuth";
import {
    OrbitBridge,
    isOrbitBridgeAckMessage,
    isOrbitBridgeReadyMessage,
    isOrbitProfileChangedMessage,
    newRoomRevision,
    type OrbitEventTopic,
    type OrbitNavigateIntent,
} from "./orbitBridge";
import { forgetOrbitAccessTokenRenewal, freshOrbitAccessToken, getAccessTokenFromJwt } from "./orbitAccessToken";
let adminModalOpen = false;
/** The bridge for this visit (a new one on every room join or reconnect). */
let bridge: OrbitBridge | null = null;
/** The control that opened Orbit, to give focus back to when Orbit closes. */
let launcher: HTMLElement | null = null;
let unsubscribeUserConnected: (() => void) | null = null;
let unsubscribeModal: (() => void) | null = null;
let unsubscribeFullScreen: (() => void) | null = null;
let unsubscribeQuests: (() => void) | null = null;
let extensionOptions: ExtensionModuleOptions | null = null;
/** The visit the quest engine client was made for: init can run twice for one visit, and must not replace it. */
let questEngineOptions: ExtensionModuleOptions | null = null;
let adminOrigin: string | null = null;
/** A name you saved in your Orbit profile, shown in the game once Orbit closes. */
let pendingPlayerName: string | null = null;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function schedulePending(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        callback();
    }, delay);
    pendingTimers.add(timer);
}

function cancelPendingTimers() {
    for (const timer of pendingTimers) {
        clearTimeout(timer);
    }
    pendingTimers.clear();
}

/**
 * Orbit's place in the browser's history.
 *
 * Opening Orbit adds one entry, so the Back button (Android's, the browser's, a swipe) walks through Orbit's own pages
 * first (they share the tab's history) and then, on this entry, closes Orbit, never leaving the room. Closing Orbit
 * any other way steps back toward the room. Iframe navigations share the browser's history, so an old marker can
 * remain after an iframe closes; every opening has its own ID and older markers are stepped over, never reopened.
 */
let historyEntryId: string | null = null;

function isOrbitHistoryState(state: unknown): boolean {
    return !!state && typeof state === "object" && (state as { orbit?: unknown }).orbit === true;
}

function isCurrentOrbitHistoryState(state: unknown): boolean {
    return (
        historyEntryId !== null &&
        isOrbitHistoryState(state) &&
        (state as { orbitVisit?: unknown }).orbitVisit === historyEntryId
    );
}

function pushHistoryEntry() {
    if (historyEntryId !== null) return;
    try {
        const nextId = crypto.randomUUID();
        history.pushState({ orbit: true, orbitVisit: nextId }, "");
        historyEntryId = nextId;
    } catch (error) {
        console.warn("Could not add Orbit to the history", error);
    }
}

function dropHistoryEntry() {
    const wasCurrent = isCurrentOrbitHistoryState(history.state);
    historyEntryId = null;
    if (wasCurrent) history.back();
}

function handlePopState(event: PopStateEvent) {
    if (adminModalOpen && !isCurrentOrbitHistoryState(event.state)) {
        // Back, on Orbit's entry: Orbit closes, and the room stays.
        historyEntryId = null;
        closeAdminModal();
    }
    if (!adminModalOpen && isOrbitHistoryState(event.state)) {
        // An entry left behind by an earlier visit (Orbit was open during a room change): step over it.
        history.back();
    }
}

/** A key or a joystick held when Orbit opens would keep walking: its release never reaches the game. */
function clearHeldMovement() {
    gameManager.tryGetCurrentGameScene()?.userInputManager?.clearHeldMovement();
}

/** The OIDC access token to sign Orbit in with, renewed first when it has run out or Orbit says it was refused. */
async function freshAccessToken(force: boolean): Promise<string | null> {
    const options = extensionOptions;
    if (!options) return null;
    return freshOrbitAccessToken(options, force, () => extensionOptions === options);
}

function handleAdminAuthMessage(event: MessageEvent<unknown>) {
    if (
        !extensionOptions ||
        !adminOrigin ||
        event.origin !== adminOrigin ||
        !event.source ||
        event.source !== get(modalIframeWindowStore)
    )
        return;
    // After signing in, Orbit's bridge says it is ready and answers requests (see orbitBridge.ts).
    if (isOrbitBridgeReadyMessage(event.data)) {
        bridge?.onReady();
        return;
    }
    if (isOrbitBridgeAckMessage(event.data)) {
        bridge?.onAck(event.data);
        return;
    }
    if (isOrbitProfileChangedMessage(event.data)) {
        // Orbit already saved it; the game only shows it, and only for this visit's frame.
        const name = event.data.name.trim();
        if (bridge && event.data.roomRevision === bridge.roomRevision && isUserNameValid(name))
            pendingPlayerName = name;
        return;
    }
    if (!isOrbitAuthReadyMessage(event.data)) return;
    const { nonce, refresh } = event.data;
    const source = event.source;
    const origin = adminOrigin;
    if (!source) return;
    void freshAccessToken(refresh === true).then((accessToken) => {
        // Orbit may have closed, or the room changed, while the token was being renewed.
        if (!accessToken || source !== get(modalIframeWindowStore)) return;
        const response: OrbitAuthTokenMessage = {
            type: "orbit-auth-token-v2",
            version: ORBIT_AUTH_VERSION,
            nonce,
            accessToken,
        };
        source.postMessage(response, origin);
    });
}

/**
 * What opened Orbit: the action-bar button, a quest, the game asking Orbit for a page, or Orbit opening
 * on its own. Only the button opens it today; Orbit never opens on its own any more, and "auto" stays so the numbers
 * show it at zero.
 */
export type OrbitOpenSource = "button" | "quest" | "link" | "auto";

// Function to open the admin modal, optionally on a given Orbit page
function openAdminModal(options: ExtensionModuleOptions, source: OrbitOpenSource, redirect?: string) {
    if (adminModalOpen && redirect === undefined) return;

    const accessToken = getAccessTokenFromJwt(options.userAccessToken);
    if (!accessToken) {
        console.warn("No access token available for admin integration");
        return;
    }

    const adminUrl = options.adminUrl;
    if (!adminUrl) {
        console.error("Admin URL not configured. Set ADMIN_URL environment variable.");
        return;
    }

    let adminDashboardUrl: string;
    try {
        adminDashboardUrl = buildAdminLoginUrl(adminUrl, options.roomId, window.location.href, redirect);
    } catch (error) {
        console.error("Refusing insecure Admin URL:", error);
        return;
    }

    const modalEvent: ModalEvent = {
        title: "Orbit",
        src: adminDashboardUrl,
        allow: "fullscreen",
        allowApi: true,
        position: "right",
        allowFullScreen: true,
    };

    if (adminModalOpen) {
        // Svelte batches synchronous visibility toggles, so closing and reopening in one turn never remounts the
        // iframe. Replace its reactive URL instead and keep its WindowProxy, launcher, view and history marker.
        bridge?.onClosed();
        modalIframeStore.set(modalEvent);
        analyticsClient.orbitOpened({ source });
        return;
    }

    launcher = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    clearHeldMovement();
    modalFullScreenStore.set(false);
    modalIframeStore.set(modalEvent);
    modalVisibilityStore.set(true);
    adminModalOpen = true;
    pushHistoryEntry();
    analyticsClient.orbitOpened({ source });
}

// Export function to open admin modal from menu item
export function openAdminModalFromMenu() {
    if (extensionOptions) {
        openAdminModal(extensionOptions, "button");
    }
}

/** Whether Orbit can be opened for this player (signed in, and Orbit is set up for this room). */
export function canOpenOrbit(): boolean {
    return (
        extensionOptions !== null &&
        !!extensionOptions.adminUrl &&
        getAccessTokenFromJwt(extensionOptions.userAccessToken) !== null
    );
}

/** Opens Orbit on one of its pages (an /admin path), switching to it if Orbit is already open. */
export function openOrbitPage(path: string) {
    if (!extensionOptions) return;
    openAdminModal(extensionOptions, "link", path);
}

/**
 * Asks Orbit for one of its pages by intent (Orbit decides the page, and whether this player may see it; anything it
 * does not allow lands on its home). Opens Orbit when it is closed; the request waits until Orbit has signed in.
 * Returns false when Orbit can't be opened for this player.
 */
export function requestOrbitPage(intent: OrbitNavigateIntent, params?: Record<string, string>): boolean {
    if (!extensionOptions || !bridge || !canOpenOrbit()) return false;
    if (!adminModalOpen) openAdminModal(extensionOptions, "link");
    bridge.navigate(intent, params);
    return true;
}

/** Tells an open Orbit that something it shows changed (a hint to fetch again; it trusts nothing in it). */
export function notifyOrbitChanged(topic: OrbitEventTopic) {
    if (!adminModalOpen || !bridge) return;
    bridge.notifyChanged(topic);
}

// Function to close the admin modal
function closeAdminModal() {
    modalVisibilityStore.set(false);
    modalIframeStore.set(null);
    modalIframeWindowStore.set(null);
    modalFullScreenStore.set(false);
    adminModalOpen = false;
    bridge?.onClosed();
}

/**
 * Orbit closed (by the player, by Orbit through WA.ui.modal.closeModal, or by Back): its history entry goes, and
 * focus returns to what opened it.
 */
function onOrbitClosed() {
    bridge?.onClosed();
    dropHistoryEntry();
    const target = launcher;
    launcher = null;
    if (target?.isConnected) target.focus();
    applyPendingPlayerName();
}

/**
 * You renamed yourself in Orbit: the game takes the new name and rejoins the room, as renaming in the game does, so
 * everyone sees it. Nothing happens when the name didn't change.
 */
function applyPendingPlayerName() {
    const name = pendingPlayerName;
    pendingPlayerName = null;
    if (!name || name === gameManager.getPlayerName()) return;
    gameManager.setPlayerName(name);
    // Signed-in players get their name from the server, which Orbit already updated; others keep it locally.
    if (!hasCapability("api/save-name")) localUserStore.setName(name);
    gameManager.rejoinCurrentRoom();
}

// Function to initialize the admin integration
function initializeAdminIntegration(options: ExtensionModuleOptions) {
    const accessToken = getAccessTokenFromJwt(options.userAccessToken);
    if (!accessToken) {
        console.warn("No access token available for admin integration");
        return;
    }

    const adminUrl = options.adminUrl;
    if (!adminUrl) {
        console.error("Admin URL not configured. Set ADMIN_URL environment variable.");
        return;
    }

    // Store options for cleanup
    try {
        adminOrigin = resolveCredentialUrl(adminUrl, window.location.href).origin;
    } catch (error) {
        console.error("Refusing insecure Admin URL:", error);
        return;
    }
    extensionOptions = options;
    // A new visit: a new room revision, so nothing from an earlier Orbit frame can act on this one.
    bridge?.onClosed();
    bridge = new OrbitBridge(
        {
            post: (message) => {
                const frame = get(modalIframeWindowStore);
                if (frame && adminOrigin) frame.postMessage(message, adminOrigin);
            },
            setTimeout: (callback, ms) => setTimeout(callback, ms),
            clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        },
        newRoomRevision(),
        maxUserNameLength
    );
    window.removeEventListener("message", handleAdminAuthMessage);
    window.addEventListener("message", handleAdminAuthMessage);
    window.removeEventListener("popstate", handlePopState);
    window.addEventListener("popstate", handlePopState);
    // Orbit lays itself out for the frame's size, whoever changed it.
    unsubscribeFullScreen?.();
    unsubscribeFullScreen = modalFullScreenStore.subscribe((full) => {
        bridge?.setView(full ? "full" : "compact");
    });
    // With quests on, Orbit's You page shows the same quest log as the game.
    unsubscribeQuests?.();
    unsubscribeQuests = watchOrbitQuestEntries((entries) => bridge?.setQuestState(entries));
    // The quest panel's "See it in Orbit" opens that quest's page (its badge), for a signed-in player only.
    questOrbitLinkStore.set(canOpenOrbit() ? (questId) => requestOrbitPage("quest", { questId }) : null);
    // A signed-in player's quest progress lives in Orbit's quest engine, so it follows them between browsers. It
    // signs in with the Orbit session the bots module keeps (set up on room enter for everyone).
    if (questEngineOptions !== options) {
        questEngineOptions = options;
        questEngineStore.set(
            createQuestEngineHttpClient(
                (endpoint, init) => botApiService.requestOrbit(endpoint, init),
                () => options.roomId
            )
        );
    }

    // Activate the Orbit button in the action bar (highest priority). Orbit opens only when asked: this runs on every
    // room join and reconnect, so opening here would bring Orbit back each time.
    adminDashboardActivatedStore.set(true);
}

const adminExtensionModule: ExtensionModule = {
    id: "admin-api-extension",
    calendarSynchronised: false,
    todoListSynchronized: false,

    init(roomMetadata: unknown, options: ExtensionModuleOptions) {
        console.log("Admin API Extension Module initialized");

        // Wait for user to be connected, then initialize
        unsubscribeUserConnected = userIsConnected.subscribe((connected) => {
            if (connected && localUserStore.isLogged()) {
                schedulePending(() => {
                    initializeAdminIntegration(options);
                }, 1000);
                if (unsubscribeUserConnected) {
                    unsubscribeUserConnected();
                    unsubscribeUserConnected = null;
                }
            }
        });

        // Also check if already connected
        if (localUserStore.isLogged()) {
            schedulePending(() => {
                initializeAdminIntegration(options);
            }, 1000);
        }

        // Listen for modal close events
        unsubscribeModal = modalVisibilityStore.subscribe((visible) => {
            if (!visible && adminModalOpen) {
                adminModalOpen = false;
                onOrbitClosed();
            }
        });
    },

    destroy() {
        cancelPendingTimers();
        if (unsubscribeUserConnected) {
            unsubscribeUserConnected();
            unsubscribeUserConnected = null;
        }
        if (unsubscribeModal) {
            unsubscribeModal();
            unsubscribeModal = null;
        }
        // Deactivate the Orbit button
        adminDashboardActivatedStore.set(false);
        window.removeEventListener("message", handleAdminAuthMessage);
        window.removeEventListener("popstate", handlePopState);
        unsubscribeFullScreen?.();
        unsubscribeFullScreen = null;
        unsubscribeQuests?.();
        unsubscribeQuests = null;
        questOrbitLinkStore.set(null);
        questEngineStore.set(null);
        questEngineOptions = null;
        closeAdminModal();
        // The room is changing: its history entry stays behind and is stepped over later (see handlePopState).
        historyEntryId = null;
        pendingPlayerName = null;
        bridge = null;
        launcher = null;
        extensionOptions = null;
        adminOrigin = null;
        forgetOrbitAccessTokenRenewal();
    },
};

export default adminExtensionModule;
