import { get } from "svelte/store";
import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import { localUserStore } from "../../Connection/LocalUserStore";
import { axiosToPusher } from "../../Connection/AxiosUtils";
import { userIsConnected, adminDashboardActivatedStore } from "../../Stores/MenuStore";
import { modalIframeStore, modalIframeWindowStore, modalVisibilityStore } from "../../Stores/ModalStore";
import type { ModalEvent } from "../../Api/Events/ModalEvent";
import {
    ORBIT_AUTH_VERSION,
    buildAdminLoginUrl,
    isOrbitAuthReadyMessage,
    resolveCredentialUrl,
    type OrbitAuthTokenMessage,
} from "./iframeAuth";
let adminModalOpen = false;
let unsubscribeUserConnected: (() => void) | null = null;
let unsubscribeModal: (() => void) | null = null;
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

/** When the OIDC access token inside the game's token runs out, in ms since the epoch; null when it doesn't say. */
function accessTokenExpiry(accessToken: string): number | null {
    try {
        const base64 = accessToken.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
        if (!base64) return null;
        const payload = JSON.parse(atob(base64)) as { exp?: unknown };
        return typeof payload.exp === "number" ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

/** Don't hand out a token about to run out: Orbit's sign-in would fail a moment later. */
const ACCESS_TOKEN_MARGIN_MS = 60_000;

/**
 * The OIDC access token to sign Orbit in with. The one inside the game's token lasts an hour or so; the game's
 * own token lasts weeks and carries a refresh token, so when the access token has run out (or Orbit says it was
 * refused), the pusher's /me renews it, as the game does for its own calls.
 */
async function freshAccessToken(force: boolean): Promise<string | null> {
    const options = extensionOptions;
    if (!options) return null;
    const current = getAccessTokenFromJwt(options.userAccessToken);
    if (!current) return null;
    const expiry = accessTokenExpiry(current);
    const stale = expiry !== null && expiry < Date.now() + ACCESS_TOKEN_MARGIN_MS;
    if (!force && !stale) return current;
    try {
        const response = await axiosToPusher.get("me", {
            params: { token: options.userAccessToken, playUri: options.roomId },
        });
        const { MeResponse } = await import("@workadventure/messages");
        const parsed = MeResponse.parse(response.data);
        if (parsed.status !== "ok" || !("authToken" in parsed) || typeof parsed.authToken !== "string") return current;
        const renewed = getAccessTokenFromJwt(parsed.authToken);
        if (!renewed) return current;
        // The rest of the game uses the renewed token from here on too (unless the room changed meanwhile).
        if (extensionOptions === options) options.userAccessToken = parsed.authToken;
        localUserStore.setAuthToken(parsed.authToken);
        return renewed;
    } catch (error) {
        console.warn("Orbit sign-in: could not renew the access token", error);
        return current;
    }
}

function handleAdminAuthMessage(event: MessageEvent<unknown>) {
    if (
        !extensionOptions ||
        !adminOrigin ||
        event.origin !== adminOrigin ||
        event.source !== get(modalIframeWindowStore) ||
        !isOrbitAuthReadyMessage(event.data)
    )
        return;
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

// Function to open the admin modal, optionally on a given Orbit page
function openAdminModal(options: ExtensionModuleOptions, redirect?: string) {
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

    modalIframeStore.set(modalEvent);
    modalVisibilityStore.set(true);
    adminModalOpen = true;
}

// Export function to open admin modal from menu item
export function openAdminModalFromMenu() {
    if (extensionOptions) {
        openAdminModal(extensionOptions);
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
    if (adminModalOpen) closeAdminModal();
    openAdminModal(extensionOptions, path);
}

// Function to close the admin modal
function closeAdminModal() {
    modalVisibilityStore.set(false);
    modalIframeStore.set(null);
    modalIframeWindowStore.set(null);
    adminModalOpen = false;
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
    window.removeEventListener("message", handleAdminAuthMessage);
    window.addEventListener("message", handleAdminAuthMessage);

    // Activate the Orbit button in the action bar (highest priority)
    adminDashboardActivatedStore.set(true);

    // Auto-open after a short delay
    schedulePending(() => {
        openAdminModal(options);
    }, 1500);
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
        extensionOptions = null;
        adminOrigin = null;
        closeAdminModal();
    },
};

export default adminExtensionModule;
