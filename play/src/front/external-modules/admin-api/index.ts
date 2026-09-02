import { get } from "svelte/store";
import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import { localUserStore } from "../../Connection/LocalUserStore";
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

function handleAdminAuthMessage(event: MessageEvent<unknown>) {
    if (
        !extensionOptions ||
        !adminOrigin ||
        event.origin !== adminOrigin ||
        event.source !== get(modalIframeWindowStore) ||
        !isOrbitAuthReadyMessage(event.data)
    )
        return;
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

// Function to open the admin modal
function openAdminModal(options: ExtensionModuleOptions) {
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
        adminDashboardUrl = buildAdminLoginUrl(adminUrl, options.roomId, window.location.href);
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
