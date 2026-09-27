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
import type { ModalEvent } from "../../Api/Events/ModalEvent";
import { analyticsClient } from "../../Administration/AnalyticsClient";
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
    newRoomRevision,
    type OrbitEventTopic,
    type OrbitNavigateIntent,
} from "./orbitBridge";
let adminModalOpen = false;
/** Orbit is being reopened on another page: not a real close (no focus change, the history entry stays). */
let reopening = false;
/** The bridge for this visit (a new one on every room join or reconnect). */
let bridge: OrbitBridge | null = null;
/** The control that opened Orbit, to give focus back to when Orbit closes. */
let launcher: HTMLElement | null = null;
let unsubscribeUserConnected: (() => void) | null = null;
let unsubscribeModal: (() => void) | null = null;
let unsubscribeFullScreen: (() => void) | null = null;
let extensionOptions: ExtensionModuleOptions | null = null;
let adminOrigin: string | null = null;
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
 * any other way takes the entry out again, so the next Back does what it did before Orbit opened.
 */
const ORBIT_HISTORY_STATE = { orbit: true } as const;
let ownsHistoryEntry = false;

function isOrbitHistoryState(state: unknown): boolean {
    return !!state && typeof state === "object" && (state as { orbit?: unknown }).orbit === true;
}

function pushHistoryEntry() {
    if (ownsHistoryEntry) return;
    try {
        history.pushState(ORBIT_HISTORY_STATE, "");
        ownsHistoryEntry = true;
    } catch (error) {
        console.warn("Could not add Orbit to the history", error);
    }
}

function dropHistoryEntry() {
    if (!ownsHistoryEntry) return;
    ownsHistoryEntry = false;
    if (isOrbitHistoryState(history.state)) history.back();
}

function handlePopState(event: PopStateEvent) {
    if (adminModalOpen && !isOrbitHistoryState(event.state)) {
        // Back, on Orbit's entry: Orbit closes, and the room stays.
        ownsHistoryEntry = false;
        closeAdminModal();
        return;
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

// Helper to extract OIDC access token from JWT
function getAccessTokenFromJwt(jwtToken: string | null): string | null {
    if (!jwtToken) {
        return null;
    }
    try {
        const base64Url = jwtToken.split(".")[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split("")
                .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );
        const payload = JSON.parse(jsonPayload);
        return payload.accessToken || null;
    } catch (e) {
        console.error("Error parsing JWT:", e);
        return null;
    }
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
    if (!isOrbitAuthReadyMessage(event.data)) return;
    const accessToken = getAccessTokenFromJwt(extensionOptions.userAccessToken);
    if (!accessToken || !event.source) return;
    const response: OrbitAuthTokenMessage = {
        type: "orbit-auth-token-v2",
        version: ORBIT_AUTH_VERSION,
        nonce: event.data.nonce,
        accessToken,
    };
    event.source.postMessage(response, adminOrigin);
}

/**
 * What opened Orbit: the action-bar button, a quest's "Show me", the game asking Orbit for a page, or Orbit opening
 * on its own. Only the button opens it today; Orbit never opens on its own any more, and "auto" stays so the numbers
 * show it at zero.
 */
export type OrbitOpenSource = "button" | "quest" | "link" | "auto";

// Function to open the admin modal, optionally on a given Orbit page
function openAdminModal(options: ExtensionModuleOptions, source: OrbitOpenSource, redirect?: string) {
    if (adminModalOpen) return;

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
        title: "Admin Dashboard",
        src: adminDashboardUrl,
        allow: "fullscreen",
        allowApi: true,
        position: "right",
        allowFullScreen: true,
    };

    if (!reopening) launcher = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    if (adminModalOpen) {
        // Not a real close: focus and the history entry stay where they are.
        reopening = true;
        try {
            closeAdminModal();
            openAdminModal(extensionOptions, "link", path);
        } finally {
            reopening = false;
        }
        return;
    }
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
    if (reopening) return;
    dropHistoryEntry();
    const target = launcher;
    launcher = null;
    if (target?.isConnected) target.focus();
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
        newRoomRevision()
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
        closeAdminModal();
        // The room is changing: its history entry stays behind and is stepped over later (see handlePopState).
        ownsHistoryEntry = false;
        bridge = null;
        launcher = null;
        extensionOptions = null;
        adminOrigin = null;
    },
};

export default adminExtensionModule;
