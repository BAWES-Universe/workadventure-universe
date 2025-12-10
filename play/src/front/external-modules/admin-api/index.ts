import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import { localUserStore } from "../../Connection/LocalUserStore";
import { userIsConnected } from "../../Stores/MenuStore";
import { modalIframeStore, modalVisibilityStore } from "../../Stores/ModalStore";
import type { ModalEvent } from "../../Api/Events/ModalEvent";
import AdminDashboardButton from "./AdminDashboardButton.svelte";

let adminModalOpen = false;
let unsubscribeUserConnected: (() => void) | null = null;
let unsubscribeModal: (() => void) | null = null;
let extensionOptions: ExtensionModuleOptions | null = null;

// Helper to extract OIDC access token from JWT
function getAccessTokenFromJwt(jwtToken: string): string | null {
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

    const adminDashboardUrl = `${adminUrl}/admin/login?accessToken=${encodeURIComponent(
        accessToken
    )}&playUri=${encodeURIComponent(options.roomId)}`;

    const modalEvent: ModalEvent = {
        title: "Admin Dashboard",
        src: adminDashboardUrl,
        allow: "fullscreen",
        allowApi: true,
        position: "center",
        allowFullScreen: true,
    };

    modalIframeStore.set(modalEvent);
    modalVisibilityStore.set(true);
    adminModalOpen = true;
}

// Function to close the admin modal
function closeAdminModal() {
    modalVisibilityStore.set(false);
    modalIframeStore.set(null);
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
    extensionOptions = options;

    // Inject button component into action bar
    options.externalSvelteComponent.addComponentToZone(
        "actionBarAppsMenu",
        "admin-dashboard-btn",
        AdminDashboardButton,
        {
            onOpenModal: () => openAdminModal(options),
        }
    );

    // Auto-open after a short delay
    setTimeout(() => {
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
                setTimeout(() => {
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
            setTimeout(() => {
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
        if (unsubscribeUserConnected) {
            unsubscribeUserConnected();
            unsubscribeUserConnected = null;
        }
        if (unsubscribeModal) {
            unsubscribeModal();
            unsubscribeModal = null;
        }
        // Remove button component
        if (extensionOptions) {
            extensionOptions.externalSvelteComponent.removeComponentFromZone(
                "actionBarAppsMenu",
                "admin-dashboard-btn"
            );
            extensionOptions = null;
        }
        closeAdminModal();
    },
};

export default adminExtensionModule;
