import { get } from "svelte/store";
import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import { localUserStore } from "../../Connection/LocalUserStore";
import { mapEditorActivated, userIsConnected } from "../../Stores/MenuStore";
import { mapEditorVisibilityStore } from "../../Stores/MapEditorStore";
import { modalIframeStore, modalVisibilityStore } from "../../Stores/ModalStore";
import type { ModalEvent } from "../../Api/Events/ModalEvent";

let botModalOpen = false;
let unsubscribeUserConnected: (() => void) | null = null;
let unsubscribeMapEditor: (() => void) | null = null;
let unsubscribeMapEditorVisibility: (() => void) | null = null;
let unsubscribeModal: (() => void) | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _extensionOptions: ExtensionModuleOptions | null = null; // Stored for potential future use
let toolButtonElement: HTMLElement | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _sidebarContainer: HTMLElement | null = null; // Stored for potential future use
let buttonClickHandler: ((e: Event) => void) | null = null;

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

// Function to open the bot editor modal
function openBotEditorModal(options: ExtensionModuleOptions) {
    if (botModalOpen) return;

    const accessToken = getAccessTokenFromJwt(options.userAccessToken);
    if (!accessToken) {
        console.warn("No access token available for bot editor");
        return;
    }

    // For now, we'll use a modal. Later we can create a custom sidebar
    // TODO: Create BotEditorModal component that opens as sidebar or modal
    const botEditorUrl = `${options.adminUrl || ""}/bots/editor?accessToken=${encodeURIComponent(
        accessToken
    )}&playUri=${encodeURIComponent(options.roomId)}`;

    const modalEvent: ModalEvent = {
        title: "Bot Editor",
        src: botEditorUrl,
        allow: "fullscreen",
        allowApi: true,
        position: "right",
        allowFullScreen: true,
    };

    modalIframeStore.set(modalEvent);
    modalVisibilityStore.set(true);
    botModalOpen = true;
}

// Function to close the bot editor modal
function closeBotEditorModal() {
    modalVisibilityStore.set(false);
    modalIframeStore.set(null);
    botModalOpen = false;
}

// Function to inject bot editor tool button into map editor sidebar
function injectBotEditorTool(sidebar: HTMLElement, options: ExtensionModuleOptions) {
    // Find the tools container - try multiple selectors
    let toolsContainer = sidebar.querySelector(".flex.flex-col.gap-2");
    if (!toolsContainer) {
        // Try alternative selector
        toolsContainer = sidebar.querySelector(".p-2.bg-contrast\\/80.rounded-2xl.flex.flex-col.gap-2");
    }
    if (!toolsContainer) {
        // Try finding by class pattern
        toolsContainer = Array.from(sidebar.querySelectorAll("div")).find(
            (el) => el.classList.contains("flex") && el.classList.contains("flex-col") && el.classList.contains("gap-2")
        ) as HTMLElement | null;
    }

    if (!toolsContainer) {
        console.warn("Bot editor: Could not find map editor tools container", sidebar);
        return;
    }

    // Check if button already exists
    if (sidebar.querySelector("#bot-editor-tool-btn")) {
        return;
    }

    // Create tool button element
    const toolButton = document.createElement("div");
    toolButton.id = "bot-editor-tool-btn";
    toolButton.className = "tool-button relative";
    toolButton.innerHTML = `
        <button
            class="peer p-3 aspect-square w-12 rounded hover:bg-white/10"
            id="BotEditor"
            type="button"
            title="Bot Editor"
        >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="font-size: 22px; width: 22px; height: 22px;">
                <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1H5C3.89 1 3 1.89 3 3V21C3 22.11 3.89 23 5 23H11V21H5V3H13V9H21ZM14 10V12H22V10H14ZM14 14V16H22V14H14ZM14 18V20H22V18H14Z" fill="currentColor"/>
            </svg>
        </button>
        <div class="bg-contrast/90 backdrop-blur-xl text-white tooltip absolute text-nowrap p-2 invisible opacity-0 transition-all peer-hover:visible peer-hover:opacity-100 rounded top-1/2 -translate-y-1/2 right-[130%]">
            Bot Editor
        </div>
    `;

    // Add click handler
    const button = toolButton.querySelector("button");
    if (button) {
        buttonClickHandler = (e: Event) => {
            e.preventDefault();
            openBotEditorModal(options);
        };
        button.addEventListener("click", buttonClickHandler);
    }

    // Insert before the close button (or at the end if close button not found)
    const closeButton = sidebar.querySelector(".close-window");
    if (closeButton && closeButton.parentElement) {
        // Insert in the tools container, after other tools
        toolsContainer.appendChild(toolButton);
    } else {
        toolsContainer.appendChild(toolButton);
    }

    toolButtonElement = toolButton;
}

// Function to remove bot editor tool button
function removeBotEditorTool() {
    if (toolButtonElement) {
        // Remove event listener if it exists
        const button = toolButtonElement.querySelector("button");
        if (button && buttonClickHandler) {
            button.removeEventListener("click", buttonClickHandler);
            buttonClickHandler = null;
        }
        if (toolButtonElement.parentElement) {
            toolButtonElement.parentElement.removeChild(toolButtonElement);
        }
        toolButtonElement = null;
    }
}

// Function to set up the bot editor (called after user is connected)
function setupBotEditor(options: ExtensionModuleOptions) {
    // Check if user is authenticated
    if (!localUserStore.isLogged()) {
        console.log("Bot editor: User not authenticated");
        return;
    }

    // Store options for cleanup
    _extensionOptions = options;

    // Helper function to try injecting the bot editor tool
    const tryInjectBotTool = () => {
        const sidebar = document.querySelector(".side-bar-container") as HTMLElement;
        if (sidebar && localUserStore.isLogged()) {
            _sidebarContainer = sidebar;
            injectBotEditorTool(sidebar, options);
            return true;
        }
        return false;
    };

    // Subscribe to map editor activation
    unsubscribeMapEditor = mapEditorActivated.subscribe((activated) => {
        if (activated) {
            // Map editor is active, try to inject tool button
            // Use a retry mechanism since the sidebar might not be in DOM yet
            let retries = 0;
            const maxRetries = 20; // Increased retries
            const retryInterval = 300;

            const tryInject = () => {
                if (!tryInjectBotTool()) {
                    retries++;
                    if (retries < maxRetries) {
                        setTimeout(tryInject, retryInterval);
                    } else {
                        console.warn("Bot editor: Could not find sidebar container after", maxRetries, "retries");
                    }
                }
            };

            // Start trying immediately and also after delays
            tryInject();
            setTimeout(tryInject, 500);
            setTimeout(tryInject, 1000);
        } else {
            // Map editor is inactive, remove tool button
            removeBotEditorTool();
            _sidebarContainer = null;
        }
    });

    // Also subscribe to map editor visibility changes (sidebar might appear/disappear)
    unsubscribeMapEditorVisibility = mapEditorVisibilityStore.subscribe((visible) => {
        // When visibility changes, try to inject if map editor is activated
        if (get(mapEditorActivated) && localUserStore.isLogged()) {
            setTimeout(() => {
                if (!toolButtonElement) {
                    tryInjectBotTool();
                }
            }, 300);
        }
    });

    // Also check if map editor is already active
    if (get(mapEditorActivated) && localUserStore.isLogged()) {
        // Use retry mechanism here too
        let retries = 0;
        const maxRetries = 20;
        const retryInterval = 300;

        const tryInject = () => {
            if (!tryInjectBotTool()) {
                retries++;
                if (retries < maxRetries) {
                    setTimeout(tryInject, retryInterval);
                }
            }
        };

        // Try multiple times with different delays
        tryInject();
        setTimeout(tryInject, 500);
        setTimeout(tryInject, 1000);
    }
}

// Function to initialize the bot editor integration
function initializeBotEditor(options: ExtensionModuleOptions) {
    // Wait for user to be connected, then initialize (like admin-api module)
    unsubscribeUserConnected = userIsConnected.subscribe((connected) => {
        if (connected && localUserStore.isLogged()) {
            setTimeout(() => {
                setupBotEditor(options);
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
            setupBotEditor(options);
        }, 1000);
    }

    // Listen for modal close events
    unsubscribeModal = modalVisibilityStore.subscribe((visible) => {
        if (!visible && botModalOpen) {
            botModalOpen = false;
        }
    });
}

const botExtensionModule: ExtensionModule = {
    id: "workadventure-bots",
    calendarSynchronised: false,
    todoListSynchronized: false,

    init(roomMetadata: unknown, options: ExtensionModuleOptions) {
        console.log("Bot Extension Module initialized");

        // Initialize bot editor integration
        initializeBotEditor(options);
    },

    destroy() {
        if (unsubscribeUserConnected) {
            unsubscribeUserConnected();
            unsubscribeUserConnected = null;
        }
        if (unsubscribeMapEditor) {
            unsubscribeMapEditor();
            unsubscribeMapEditor = null;
        }
        if (unsubscribeMapEditorVisibility) {
            unsubscribeMapEditorVisibility();
            unsubscribeMapEditorVisibility = null;
        }
        if (unsubscribeModal) {
            unsubscribeModal();
            unsubscribeModal = null;
        }
        // Remove tool button
        removeBotEditorTool();
        _sidebarContainer = null;
        _extensionOptions = null;
        closeBotEditorModal();
    },
};

export default botExtensionModule;
