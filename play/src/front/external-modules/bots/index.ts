import { get } from "svelte/store";
import type { SvelteComponent } from "svelte";
import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import { localUserStore } from "../../Connection/LocalUserStore";
import { mapEditorActivated, userIsConnected } from "../../Stores/MenuStore";
import { mapEditorVisibilityStore, mapEditorSelectedToolStore } from "../../Stores/MapEditorStore";
import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
import { gameManager } from "../../Phaser/Game/GameManager";
import { wokaMenuStore, type WokaMenuData, type WokaMenuAction } from "../../Stores/WokaMenuStore";
import { botApiService } from "./services/BotApiService";
import { destroyBotEditorTool } from "./phaser/BotEditorTool";
import { IconMapPin } from "@wa-icons";

const BOT_EDITOR_TOOL_NAME = "BotEditor" as EditorToolName;
let botEditorOpen = false;
let lastRoomIdWhenEditorWasOpen: string | null = null; // Track roomId when editor was last open
let pendingRoomChangeReload = false; // Flag to indicate we need to reload after component mounts
let wasBotEditorSelectedBeforeDestroy = false; // Track if BotEditor was selected before destroy()
let unsubscribeUserConnected: (() => void) | null = null;
let unsubscribeMapEditor: (() => void) | null = null;
let unsubscribeMapEditorVisibility: (() => void) | null = null;
let unsubscribeSelectedTool: (() => void) | null = null;

let _extensionOptions: ExtensionModuleOptions | null = null;
let toolButtonElement: HTMLElement | null = null;
let sidebarContentElement: HTMLElement | null = null;
// Svelte component instance - cleanup is handled by removing DOM element
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let botEditorComponentInstance: any | null = null;
let buttonClickHandler: ((e: Event) => void) | null = null;

// Function to open the bot editor in sidebar
function openBotEditor() {
    // If bot editor is already open and sidebar is visible, don't reopen
    if (botEditorOpen && get(mapEditorVisibilityStore)) {
        return;
    }

    // If sidebar is collapsed, we need to reopen it
    const wasCollapsed = !get(mapEditorVisibilityStore);

    // Check if room changed since editor was last open
    const currentRoomId = _extensionOptions?.roomId || botApiService.getRoomId();
    const previousRoomId = lastRoomIdWhenEditorWasOpen;
    const roomChanged = previousRoomId !== null && currentRoomId !== null && previousRoomId !== currentRoomId;

    if (roomChanged) {
        console.log(
            `[Bot Extension] Bot editor opened after room change (${previousRoomId} -> ${currentRoomId}), will trigger reload`
        );
        pendingRoomChangeReload = true;
    }

    botEditorOpen = true;
    lastRoomIdWhenEditorWasOpen = currentRoomId;

    mapEditorVisibilityStore.set(true);

    // Clear the active tool in MapEditorModeManager first to ensure clean state
    // This prevents issues when switching back to the previous tool
    try {
        const scene = gameManager.getCurrentGameScene();
        if (scene) {
            const mapEditorModeManager = scene.getMapEditorModeManager();
            // Clear the active tool so switching to any tool (including the previous one) works
            mapEditorModeManager.equipTool(undefined);
        }
    } catch (e) {
        console.warn("Could not clear map editor tool:", e);
    }

    // Set the selected tool to our custom BotEditor tool name
    // We use a type assertion since BotEditor isn't in the enum, but the store accepts it at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapEditorSelectedToolStore.set(BOT_EDITOR_TOOL_NAME as any);

    // Try to inject the component into the sidebar
    // If it was collapsed, the component might have been removed, so we need to re-inject
    // Always try to inject - injectBotEditorComponent will check if it's already there
    if (wasCollapsed) {
        // Use a small delay to ensure the sidebar is visible before injecting
        setTimeout(() => {
            injectBotEditorComponent();
        }, 150);
    } else {
        injectBotEditorComponent();
    }
}

// Function to close the bot editor
function closeBotEditor() {
    if (!botEditorOpen) return;

    botEditorOpen = false;
    removeBotEditorComponent();

    // Only switch to EntityEditor if BotEditor is still selected (user didn't select another tool)
    const currentTool = get(mapEditorSelectedToolStore);
    if (currentTool === BOT_EDITOR_TOOL_NAME) {
        mapEditorSelectedToolStore.set(EditorToolName.EntityEditor);
    }
}

// Function to inject BotEditor component into the sidebar content area
function injectBotEditorComponent() {
    // Check if container already exists in DOM and component is actually mounted
    const existingContainer = document.querySelector("#bot-editor-container");
    if (existingContainer && botEditorComponentInstance) {
        // Both container and instance exist - already injected
        return;
    }

    // If container exists but instance is null, clean it up first (orphaned container)
    if (existingContainer && !botEditorComponentInstance) {
        if (existingContainer.parentElement) {
            existingContainer.parentElement.removeChild(existingContainer);
        }
    }

    // If instance exists but container doesn't, clear the instance (component was destroyed)
    if (botEditorComponentInstance && !existingContainer) {
        botEditorComponentInstance = null;
    }

    // Check if BotEditor tool is selected
    if (get(mapEditorSelectedToolStore) !== BOT_EDITOR_TOOL_NAME) {
        return;
    }

    // Find the sidebar content area - it's the div with class "sidebar" inside #map-editor-right
    const mapEditorRight = document.querySelector("#map-editor-right");
    if (!mapEditorRight) {
        // Retry after a short delay
        setTimeout(injectBotEditorComponent, 100);
        return;
    }

    const sidebar = mapEditorRight.querySelector(".sidebar");
    if (!sidebar || !(sidebar instanceof HTMLElement)) {
        setTimeout(injectBotEditorComponent, 100);
        return;
    }

    sidebarContentElement = sidebar;

    // Ensure header buttons have proper z-index to be clickable
    // They're already absolutely positioned, so just ensure z-index is high enough
    const headerButtons = sidebar.querySelector(".flex.flex-row.justify-end");
    if (headerButtons instanceof HTMLElement) {
        // Don't override position (they're already absolutely positioned)
        // Just ensure z-index is high enough to be above bot editor content
        const currentZIndex = window.getComputedStyle(headerButtons).zIndex;
        if (!currentZIndex || currentZIndex === "auto") {
            headerButtons.style.zIndex = "10"; // Ensure header buttons are above bot editor content
        }
    }

    // Hide existing conditional content (EntityEditor, AreaEditor, etc.)
    const conditionalContent = sidebar.querySelectorAll(":scope > *:not(.flex.flex-row.justify-end)");
    conditionalContent.forEach((el) => {
        if (el instanceof HTMLElement && el.id !== "bot-editor-container") {
            el.style.display = "none";
        }
    });

    // Create container for bot editor
    const botEditorContainer = document.createElement("div");
    botEditorContainer.id = "bot-editor-container";
    botEditorContainer.className = "bot-editor-wrapper";
    // Ensure it doesn't block pointer events to header buttons
    // Header buttons are absolutely positioned, so we ensure proper z-index
    botEditorContainer.style.pointerEvents = "auto";
    botEditorContainer.style.position = "relative";
    botEditorContainer.style.zIndex = "0"; // Lower than header buttons
    botEditorContainer.style.height = "100%";
    botEditorContainer.style.display = "flex";
    botEditorContainer.style.flexDirection = "column";
    botEditorContainer.style.minHeight = "0";

    // Insert after header buttons (headerButtons was already found above)
    if (headerButtons && headerButtons.nextSibling) {
        sidebar.insertBefore(botEditorContainer, headerButtons.nextSibling);
    } else {
        sidebar.appendChild(botEditorContainer);
    }

    // Mount Svelte component directly using dynamic import
    void import("./BotEditor.svelte")
        .then((module) => {
            const BotEditorComponent = module.default;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            botEditorComponentInstance = new (BotEditorComponent as any)({
                target: botEditorContainer,
                props: {},
            });

            // If we detected a room change when opening, trigger reload now that component is mounted
            if (pendingRoomChangeReload) {
                console.log("[Bot Extension] Component mounted, triggering reload for pending room change");
                pendingRoomChangeReload = false;
                setTimeout(() => {
                    void import("./stores/BotEditorStore").then(({ roomChangeTriggerStore }) => {
                        console.log("[Bot Extension] Triggering bot list reload after room change (component mounted)");
                        roomChangeTriggerStore.update((n) => n + 1);
                    });
                }, 100);
            }
        })
        .catch((error) => {
            console.error("Failed to load BotEditor component:", error);
        });
}

// Function to remove BotEditor component from sidebar
function removeBotEditorComponent() {
    // Deactivate Phaser tool first (this will clean up all bot previews)
    try {
        destroyBotEditorTool();
    } catch (e) {
        console.warn("Error deactivating bot editor tool:", e);
    }

    // Find and remove ALL containers from DOM (in case of duplicates)
    // Removing the DOM element will trigger Svelte's onDestroy lifecycle
    const containers = document.querySelectorAll("#bot-editor-container");
    containers.forEach((container) => {
        if (container instanceof HTMLElement && container.parentElement) {
            try {
                container.parentElement.removeChild(container);
            } catch (e) {
                console.warn("Error removing bot editor container:", e);
            }
        }
    });

    // Also check in sidebarContentElement if we have a reference
    if (sidebarContentElement) {
        const sidebarContainers = sidebarContentElement.querySelectorAll("#bot-editor-container");
        sidebarContainers.forEach((container) => {
            if (container instanceof HTMLElement && container.parentElement) {
                try {
                    container.parentElement.removeChild(container);
                } catch (e) {
                    console.warn("Error removing bot editor container from sidebar:", e);
                }
            }
        });
    }

    // Clear component instance reference after DOM removal
    // Svelte will handle cleanup via onDestroy when DOM element is removed
    botEditorComponentInstance = null;

    // Show conditional content again - ensure all content is visible
    if (sidebarContentElement) {
        const conditionalContent = sidebarContentElement.querySelectorAll(":scope > *");
        conditionalContent.forEach((el) => {
            if (el instanceof HTMLElement && el.id !== "bot-editor-container") {
                // Remove any inline styles we may have set
                el.style.removeProperty("display");
            }
        });
    }
}

// Function to inject bot editor tool button into map editor sidebar
function injectBotEditorTool(sidebar: HTMLElement, options: ExtensionModuleOptions) {
    // Find the tools container - it's the div with classes: p-2 bg-contrast/80 rounded-2xl flex flex-col gap-2 backdrop-blur-md
    // This is inside .side-bar-container > .side-bar > div (after .close-window)
    const toolsContainerElement = sidebar.querySelector(
        "div.p-2.bg-contrast\\/80.rounded-2xl.flex.flex-col.gap-2.backdrop-blur-md"
    );
    let toolsContainer: HTMLElement | null =
        toolsContainerElement instanceof HTMLElement ? toolsContainerElement : null;

    if (!toolsContainer) {
        // Try finding by walking the DOM - find the div after .close-window
        const closeWindow = sidebar.querySelector(".close-window");
        if (closeWindow && closeWindow.parentElement) {
            const siblings = Array.from(closeWindow.parentElement.children);
            const closeIndex = siblings.indexOf(closeWindow);
            if (closeIndex >= 0 && closeIndex < siblings.length - 1) {
                const nextSibling = siblings[closeIndex + 1];
                if (
                    nextSibling instanceof HTMLElement &&
                    nextSibling.classList.contains("flex") &&
                    nextSibling.classList.contains("flex-col") &&
                    nextSibling.classList.contains("gap-2")
                ) {
                    toolsContainer = nextSibling;
                }
            }
        }
    }

    if (!toolsContainer) {
        // Last resort: find any div with flex flex-col gap-2 inside sidebar
        toolsContainer = Array.from(sidebar.querySelectorAll("div")).find(
            (el) =>
                el.classList.contains("flex") &&
                el.classList.contains("flex-col") &&
                el.classList.contains("gap-2") &&
                el.classList.contains("backdrop-blur-md")
        ) as HTMLElement | null;
    }

    if (!toolsContainer) {
        console.warn("Bot editor: Could not find map editor tools container", sidebar);
        return;
    }

    // Check if button already exists in DOM - if it does, ensure subscription is set up
    // Also check if toolButtonElement reference is stale (element removed from DOM)
    const existingButton = toolsContainer.querySelector("#bot-editor-tool-btn");
    if (existingButton && existingButton.isConnected) {
        toolButtonElement = existingButton as HTMLElement;
        const button = existingButton.querySelector("button");

        // Re-attach click handler if needed
        if (button) {
            if (buttonClickHandler) {
                button.removeEventListener("click", buttonClickHandler);
            }
            buttonClickHandler = (e: Event) => {
                e.preventDefault();
                openBotEditor();
            };
            button.addEventListener("click", buttonClickHandler);
        }

        // Re-setup subscription if it doesn't exist
        if (!unsubscribeSelectedTool && button) {
            const updateButtonState = () => {
                const selectedTool = get(mapEditorSelectedToolStore);
                if (selectedTool === BOT_EDITOR_TOOL_NAME) {
                    button.classList.remove("hover:bg-white/10");
                    button.classList.add("bg-secondary");
                    button.classList.add("active");
                } else {
                    button.classList.remove("bg-secondary");
                    button.classList.remove("active");
                    button.classList.add("hover:bg-white/10");
                }
            };

            updateButtonState();
            unsubscribeSelectedTool = mapEditorSelectedToolStore.subscribe((selectedTool) => {
                updateButtonState();

                if (selectedTool === BOT_EDITOR_TOOL_NAME && !botEditorOpen) {
                    openBotEditor();
                    return;
                }

                if (selectedTool !== BOT_EDITOR_TOOL_NAME && botEditorOpen) {
                    botEditorOpen = false;
                    removeBotEditorComponent();
                }
            });
        }
        return;
    }

    // Import icon dynamically - we'll use IconUser from @wa-icons
    // For now, create a simple button structure that matches the other tools
    const toolButton = document.createElement("div");
    toolButton.id = "bot-editor-tool-btn";
    toolButton.className = "tool-button relative";

    // Create button element
    const button = document.createElement("button");
    button.className = "peer p-3 aspect-square w-12 rounded hover:bg-white/10";
    button.id = "BotEditor";
    button.type = "button";
    button.title = "Bot Editor";

    // Create robot icon SVG
    const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    iconSvg.setAttribute("viewBox", "0 0 24 24");
    iconSvg.setAttribute("fill", "none");
    iconSvg.setAttribute("stroke", "currentColor");
    iconSvg.setAttribute("stroke-width", "1.5");
    iconSvg.setAttribute("stroke-linecap", "round");
    iconSvg.setAttribute("stroke-linejoin", "round");
    iconSvg.style.fontSize = "22px";
    iconSvg.style.width = "22px";
    iconSvg.style.height = "22px";

    // Robot icon - antenna, head, eyes, body, and control panel
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    // Antenna
    const antenna = document.createElementNS("http://www.w3.org/2000/svg", "line");
    antenna.setAttribute("x1", "12");
    antenna.setAttribute("y1", "2");
    antenna.setAttribute("x2", "12");
    antenna.setAttribute("y2", "4");
    g.appendChild(antenna);

    const antennaDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    antennaDot.setAttribute("cx", "12");
    antennaDot.setAttribute("cy", "2");
    antennaDot.setAttribute("r", "1");
    antennaDot.setAttribute("fill", "currentColor");
    g.appendChild(antennaDot);

    // Head (rounded rectangle)
    const head = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    head.setAttribute("x", "6");
    head.setAttribute("y", "4");
    head.setAttribute("width", "12");
    head.setAttribute("height", "8");
    head.setAttribute("rx", "1");
    g.appendChild(head);

    // Eyes
    const eye1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    eye1.setAttribute("cx", "9");
    eye1.setAttribute("cy", "7.5");
    eye1.setAttribute("r", "1");
    eye1.setAttribute("fill", "currentColor");
    g.appendChild(eye1);

    const eye2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    eye2.setAttribute("cx", "15");
    eye2.setAttribute("cy", "7.5");
    eye2.setAttribute("r", "1");
    eye2.setAttribute("fill", "currentColor");
    g.appendChild(eye2);

    // Body
    const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    body.setAttribute("x", "7");
    body.setAttribute("y", "13");
    body.setAttribute("width", "10");
    body.setAttribute("height", "8");
    body.setAttribute("rx", "1");
    g.appendChild(body);

    // Control panel buttons
    const button1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    button1.setAttribute("cx", "9.5");
    button1.setAttribute("cy", "16.5");
    button1.setAttribute("r", "0.8");
    button1.setAttribute("fill", "currentColor");
    g.appendChild(button1);

    const button2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    button2.setAttribute("cx", "12");
    button2.setAttribute("cy", "16.5");
    button2.setAttribute("r", "0.8");
    button2.setAttribute("fill", "currentColor");
    g.appendChild(button2);

    const button3 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    button3.setAttribute("cx", "14.5");
    button3.setAttribute("cy", "16.5");
    button3.setAttribute("r", "0.8");
    button3.setAttribute("fill", "currentColor");
    g.appendChild(button3);

    iconSvg.appendChild(g);
    button.appendChild(iconSvg);

    // Create tooltip
    const tooltip = document.createElement("div");
    tooltip.className =
        "bg-contrast/90 backdrop-blur-xl text-white tooltip absolute text-nowrap p-2 invisible opacity-0 transition-all peer-hover:visible peer-hover:opacity-100 rounded top-1/2 -translate-y-1/2 right-[130%]";
    tooltip.textContent = "Bot Editor";

    toolButton.appendChild(button);
    toolButton.appendChild(tooltip);

    // Add click handler
    buttonClickHandler = (e: Event) => {
        e.preventDefault();
        openBotEditor();
    };
    button.addEventListener("click", buttonClickHandler);

    // Subscribe to mapEditorSelectedToolStore to update button appearance
    const updateButtonState = () => {
        const selectedTool = get(mapEditorSelectedToolStore);
        if (selectedTool === BOT_EDITOR_TOOL_NAME) {
            button.classList.remove("hover:bg-white/10");
            button.classList.add("bg-secondary");
            button.classList.add("active");
        } else {
            button.classList.remove("bg-secondary");
            button.classList.remove("active");
            button.classList.add("hover:bg-white/10");
        }
    };

    // Initial state
    updateButtonState();

    // Subscribe to store changes
    unsubscribeSelectedTool = mapEditorSelectedToolStore.subscribe((selectedTool) => {
        updateButtonState();

        // If BotEditor is selected, open it
        if (selectedTool === BOT_EDITOR_TOOL_NAME && !botEditorOpen) {
            openBotEditor();
            return; // Don't process closing logic if we're opening
        }

        // If another tool is selected and bot editor is open, close it
        // Do this after checking for BotEditor to avoid race conditions
        if (selectedTool !== BOT_EDITOR_TOOL_NAME && botEditorOpen) {
            // Close the bot editor UI immediately
            botEditorOpen = false;
            removeBotEditorComponent();
            // Don't modify the store - the new tool has already set it
        }
    });

    // Insert into tools container - place between EntityEditor and WAMSettingsEditor (configure my room)
    const configureMyRoomButton = toolsContainer.querySelector("button#WAMSettingsEditor");
    if (configureMyRoomButton && configureMyRoomButton.parentElement) {
        // Insert before the Configure My Room button
        configureMyRoomButton.parentElement.insertBefore(toolButton, configureMyRoomButton);
    } else {
        // Fallback: if WAMSettingsEditor button not found, append at end
        toolsContainer.appendChild(toolButton);
    }
    toolButtonElement = toolButton;
}

// Function to remove bot editor tool button
function removeBotEditorTool() {
    // Unsubscribe from store
    if (unsubscribeSelectedTool) {
        unsubscribeSelectedTool();
        unsubscribeSelectedTool = null;
    }

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

    // Initialize API service (only when bot editor is actually being set up)
    // Note: Room enter notification is handled separately in initializeBotEditor
    // for all users, not just authenticated ones
    try {
        // Derive bot-server URL from current location (same domain, different subdomain)
        // Replace 'play' with 'bot-server' in the hostname, or use current origin if no subdomain
        const botServerUrl = getBotServerUrl();
        const roomIdChanged = botApiService.initialize(
            options.userAccessToken,
            options.adminUrl,
            options.roomId,
            botServerUrl
        );

        // If room changed and bot editor is open, trigger a reload
        if (roomIdChanged && botEditorOpen) {
            // Import dynamically to avoid circular dependency
            void import("./stores/BotEditorStore").then(({ roomChangeTriggerStore }) => {
                roomChangeTriggerStore.update((n) => n + 1);
            });
        }
    } catch (e) {
        console.warn("[Bot Editor] Failed to initialize API service:", e);
    }

    // Helper function to try injecting the bot editor tool
    const tryInjectBotTool = () => {
        const sidebar = document.querySelector(".side-bar-container") as HTMLElement;
        if (sidebar && localUserStore.isLogged()) {
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
                // Always try to inject - injectBotEditorTool will handle if button already exists
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
            // Map editor is inactive, close bot editor and remove tool button
            closeBotEditor();
            removeBotEditorTool();
        }
    });

    // Also subscribe to map editor visibility changes (sidebar might appear/disappear)
    unsubscribeMapEditorVisibility = mapEditorVisibilityStore.subscribe((visible) => {
        // When visibility changes
        if (get(mapEditorActivated) && localUserStore.isLogged()) {
            if (visible) {
                // Sidebar is now visible - try to inject button if needed
                setTimeout(() => {
                    tryInjectBotTool();
                }, 300);

                // If bot editor is selected and was open, re-inject the component
                if (get(mapEditorSelectedToolStore) === BOT_EDITOR_TOOL_NAME && botEditorOpen) {
                    setTimeout(() => {
                        injectBotEditorComponent();
                    }, 200);
                }
            } else {
                // Sidebar is collapsed - don't remove component, just mark that it might need re-injection
                // The component will be re-injected when sidebar reopens
            }
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

/**
 * Get bot-server URL from current environment
 * Derives from current window location by replacing the first subdomain with 'bot-server'
 * Works for:
 * - play.workadventure.localhost -> bot-server.workadventure.localhost
 * - play.workadventu.re -> bot-server.workadventu.re
 * - localhost:8080 -> bot-server.workadventure.localhost (fallback)
 * - Any custom domain -> bot-server.{rest of domain}
 */
function getBotServerUrl(): string {
    try {
        const { protocol, hostname, port } = window.location;

        // Handle localhost (development)
        if (hostname === "localhost" || hostname === "127.0.0.1") {
            // For localhost, use the standard dev domain
            return `${protocol}//bot-server.workadventure.localhost${port ? `:${port}` : ""}`;
        }

        // Handle subdomain patterns (most common case)
        // play.workadventure.localhost -> bot-server.workadventure.localhost
        // play.workadventu.re -> bot-server.workadventu.re
        if (hostname.includes(".")) {
            const parts = hostname.split(".");
            // Replace first subdomain with 'bot-server'
            parts[0] = "bot-server";
            const newHostname = parts.join(".");
            return `${protocol}//${newHostname}${port ? `:${port}` : ""}`;
        }

        // Single word hostname (unlikely but handle gracefully)
        return `${protocol}//bot-server.${hostname}${port ? `:${port}` : ""}`;
    } catch (e) {
        console.warn("[Bot Extension] Failed to derive bot-server URL from location:", e);
        // Ultimate fallback - use standard dev domain
        return "http://bot-server.workadventure.localhost";
    }
}

// Function to notify bot-server when player enters room (for all users, authenticated or not)
function notifyRoomEnterForAllUsers(options: ExtensionModuleOptions) {
    // Initialize API service with minimal config (just for bot-server calls)
    // Even unauthenticated users need bots to spawn
    try {
        const botServerUrl = getBotServerUrl();
        console.log(`[Bot Extension] Derived bot-server URL: ${botServerUrl}`);
        botApiService.initialize(options.userAccessToken, options.adminUrl, options.roomId, botServerUrl);

        // Notify bot-server that a player entered the room (spawns bots)
        // This should happen for ALL users, not just authenticated ones
        console.log(`[Bot Extension] Notifying room enter for: ${options.roomId}`);
        botApiService
            .notifyRoomEnter(options.roomId)
            .then((result) => {
                console.log(`[Bot Extension] Room enter notified, ${result.botsSpawned} bots spawned`);
                // After bots spawn, try to register summon buttons
                // Give it a moment for bots to appear in the game scene
                setTimeout(() => {
                    registerSummonButtonsForBots();
                }, 3000);
            })
            .catch((e) => {
                console.error("[Bot Extension] Failed to notify room enter (bots may not spawn):", e);
            });
    } catch (e) {
        console.error("[Bot Extension] Failed to initialize API service for room enter:", e);
    }
}

// Store registered actions per RemotePlayer UUID so we can add them when menu opens
const registeredActionsByUuid = new Map<string, WokaMenuAction[]>();

// Subscribe to wokaMenuStore to add our actions when menu is initialized
let wokaMenuUnsubscriber: (() => void) | null = null;
let lastProcessedMenu: { userUuid: string; actionCount: number } | null = null;

// Emotions display tracking
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let emotionsComponentInstance: SvelteComponent<any> | null = null;
let emotionsContainerElement: HTMLElement | null = null;

// Cleanup emotions display - removes ALL emotion containers (in case of duplicates)
function cleanupEmotionsDisplay(): void {
    // Destroy tracked component instance
    if (emotionsComponentInstance) {
        try {
            // Svelte 4 destroy
            emotionsComponentInstance.$destroy();
        } catch {
            // Fallback if destroy not available
        }
        emotionsComponentInstance = null;
    }

    // Remove ALL emotion containers from DOM (in case of duplicates or stale elements)
    const menuElement = document.querySelector('[data-testid="actions-menu"]');
    if (menuElement) {
        const allEmotionContainers = menuElement.querySelectorAll("[data-bot-emotions]");
        allEmotionContainers.forEach((container) => {
            if (container instanceof HTMLElement) {
                // Try to destroy any Svelte component that might be mounted
                try {
                    // @ts-ignore - accessing internal Svelte instance
                    if (container._svelteComponent) {
                        container._svelteComponent.$destroy?.();
                    }
                } catch {
                    // Ignore errors
                }
                container.remove();
            }
        });
    }

    // Also remove tracked container if it exists
    if (emotionsContainerElement) {
        try {
            emotionsContainerElement.remove();
        } catch {
            // Already removed
        }
        emotionsContainerElement = null;
    }
}

// Inject emotions display into WokaMenu for bots
async function injectEmotionsIntoWokaMenu(menuData: WokaMenuData): Promise<void> {
    // Only for bots
    if (!menuData.userUuid?.startsWith("bot-")) {
        return;
    }

    const botId = menuData.userUuid.substring(4); // Remove "bot-" prefix
    const currentUserUuid = localUserStore.getLocalUser()?.uuid;

    if (!currentUserUuid) {
        return;
    }

    // Wait for DOM to render
    await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 100);
    });

    const menuElement = document.querySelector('[data-testid="actions-menu"]');
    if (!menuElement) {
        // Retry if menu not ready yet
        setTimeout(() => void injectEmotionsIntoWokaMenu(menuData), 100);
        return;
    }

    // Check if already injected for this specific bot
    const existingContainer = menuElement.querySelector(`[data-bot-emotions="${botId}"]`);
    if (existingContainer) {
        return; // Already injected for this bot
    }

    // Also check for any emotion containers (cleanup might have missed some)
    const anyEmotionContainer = menuElement.querySelector("[data-bot-emotions]");
    if (anyEmotionContainer) {
        // Clean up any stale containers before injecting
        cleanupEmotionsDisplay();
    }

    // Find insertion point - before the action buttons section
    // Structure: <div class="m-auto..."> -> first child is content, we want to inject before actions
    const contentDiv = menuElement.querySelector("div > div:first-child");
    const actionsDiv = menuElement.querySelector(".flex.items-center.bg-contrast");

    if (!contentDiv || !actionsDiv) {
        return;
    }

    // Fetch emotions from API FIRST, before mounting component
    // This prevents the visual "jump" from default values to actual values
    const botServerUrl = getBotServerUrl();
    let emotionsData = null;

    try {
        const response = await fetch(`${botServerUrl}/api/bots/${botId}/emotions/${currentUserUuid}`);
        if (response.ok) {
            const data = await response.json();
            emotionsData = data.emotions;
        }
    } catch (error) {
        console.error("[Bot Extension] Error fetching bot emotions:", error);
    }

    // Create container for emotions display
    const container = document.createElement("div");
    container.setAttribute("data-bot-emotions", botId);
    emotionsContainerElement = container;

    // Insert before actions section
    actionsDiv.parentElement?.insertBefore(container, actionsDiv);

    try {
        // Dynamically import the component (Svelte 4 style)
        const BotEmotionsDisplay = (await import("./components/BotEmotionsDisplay.svelte")).default;

        // Mount component with actual emotions (or null if fetch failed)
        // This way tweened values initialize with correct values, no animation from defaults
        const componentInstance = new BotEmotionsDisplay({
            target: container,
            props: {
                emotions: emotionsData,
                botName: menuData.wokaName || "Bot",
                loading: false, // Already fetched, not loading
            },
        });
        emotionsComponentInstance = componentInstance;
    } catch (error) {
        console.error("[Bot Extension] Error mounting emotions component:", error);
    }
}

function setupWokaMenuHook() {
    if (wokaMenuUnsubscriber) return; // Already set up

    wokaMenuUnsubscriber = wokaMenuStore.subscribe((menuData: WokaMenuData | undefined) => {
        // When menu is cleared, cleanup emotions display
        if (!menuData) {
            lastProcessedMenu = null;
            void cleanupEmotionsDisplay();
            return;
        }

        // Clean up any existing emotions display before injecting new one
        // This handles switching between bots or reopening the same bot
        cleanupEmotionsDisplay();

        // Inject emotions display for bots
        if (menuData.userUuid?.startsWith("bot-")) {
            void injectEmotionsIntoWokaMenu(menuData);
        }

        // Only process if this is a fresh menu initialization
        // Fresh menu = actions array is empty (just initialized)
        // AND we haven't already processed this exact menu state
        const currentState = { userUuid: menuData.userUuid, actionCount: menuData.actions.length };
        const isNewMenu =
            menuData.userUuid &&
            menuData.actions.length === 0 &&
            (!lastProcessedMenu ||
                lastProcessedMenu.userUuid !== currentState.userUuid ||
                lastProcessedMenu.actionCount !== 0);

        if (isNewMenu) {
            const actions = registeredActionsByUuid.get(menuData.userUuid);
            if (actions && actions.length > 0) {
                // Mark as processed immediately
                lastProcessedMenu = currentState;

                // Check if "Summon" action already exists (safety check)
                const hasSummon = menuData.actions.some((a) => a.actionName === "Summon");
                if (!hasSummon) {
                    // Use microtask to add actions after current execution completes
                    // This prevents the subscription from firing again in the same tick
                    void Promise.resolve().then(() => {
                        actions.forEach((action: WokaMenuAction) => {
                            // Double-check menu is still valid before adding
                            const currentMenu = get(wokaMenuStore);
                            if (currentMenu && currentMenu.userUuid === menuData.userUuid) {
                                wokaMenuStore.addAction(action);
                            }
                        });
                    });
                }
            }
        }
    });
}

// Function to register summon button for bots
function registerSummonButtonsForBots() {
    try {
        const scene = gameManager.getCurrentGameScene();
        if (!scene) {
            // Retry after a delay if scene isn't ready (but don't spam logs)
            setTimeout(registerSummonButtonsForBots, 3000);
            return;
        }

        // Set up the woka menu hook if not already done
        setupWokaMenuHook();

        const remotePlayersRepo = scene.getRemotePlayersRepository();
        const players = remotePlayersRepo.getPlayers();
        const mapPlayersByKey = scene.MapPlayersByKey;

        // Get current player's UUID for summon callback
        const localUser = localUserStore.getLocalUser();

        if (!localUser) {
            // Retry if player not ready (but don't spam logs)
            setTimeout(registerSummonButtonsForBots, 3000);
            return;
        }

        const currentUuid = localUser.uuid;

        let registeredCount = 0;

        // Register summon button for each player
        players.forEach((playerData, userId) => {
            const remotePlayer = mapPlayersByKey.get(userId);
            if (!remotePlayer) {
                return;
            }

            const botUuid = playerData.userUuid;
            if (!botUuid) {
                return;
            }

            // Only register summon button for bots (bots have UUID starting with "bot-")
            if (!botUuid.startsWith("bot-")) {
                return;
            }

            // Check if we already registered for this player
            if (registeredActionsByUuid.has(botUuid)) {
                return;
            }

            // Create the action
            const summonAction = {
                actionName: "Summon",
                protected: false,
                priority: 0, // Between "Talk To" (1) and "Block" (-1)
                style: "bg-white/10 hover:bg-white/30",
                actionIcon: IconMapPin,
                callback: async () => {
                    try {
                        if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                            console.log(
                                `[Bot Extension] Summon button clicked for player ${playerData.name} (${botUuid})`
                            );
                        }

                        // Get current scene at click time (not when button was registered)
                        // This ensures we get the current scene instance, not a stale one after portaling
                        const currentScene = gameManager.getCurrentGameScene();
                        if (!currentScene) {
                            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                                console.warn(`[Bot Extension] Cannot summon - scene not available`);
                            }
                            return;
                        }

                        // Get current player position at click time
                        // Use CurrentPlayer sprite coordinates - these are always up-to-date
                        const currentPlayer = currentScene.CurrentPlayer;
                        if (!currentPlayer) {
                            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                                console.warn(`[Bot Extension] Cannot summon - current player not available`);
                            }
                            return;
                        }

                        // Use the sprite's current x/y coordinates directly - these are always up-to-date
                        const currentPosition = {
                            x: currentPlayer.x,
                            y: currentPlayer.y,
                        };

                        if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                            console.log(
                                `[Bot Extension] Current player position: (${currentPosition.x}, ${currentPosition.y})`
                            );
                        }

                        // Bot userUuid is in format "bot-{botId}", but BotManager stores by botId
                        // Strip the "bot-" prefix to get the actual botId
                        const botId = botUuid.startsWith("bot-") ? botUuid.substring(4) : botUuid;
                        // Call summon API - it will validate if this is a bot
                        await botApiService.summonBot(
                            botId, // Use botId (without "bot-" prefix)
                            currentUuid,
                            currentPosition.x,
                            currentPosition.y
                        );
                        if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                            console.log(`[Bot Extension] Summon request sent successfully`);
                        }
                    } catch (error) {
                        // Silently fail if it's not a bot (API will return 404)
                        if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                            console.warn(`[Bot Extension] Summon failed for ${botUuid}:`, error);
                        }
                    }
                },
            };

            // Store the action by player UUID so we can add it when menu opens
            if (!registeredActionsByUuid.has(botUuid)) {
                registeredActionsByUuid.set(botUuid, [summonAction]);
                registeredCount++;
            }
        });

        // Only log if we actually did something
        if (registeredCount > 0) {
            console.log(
                `[Bot Extension] ✅ Stored ${registeredCount} summon button action(s) for registration when menu opens`
            );
        }
    } catch (error) {
        console.error("[Bot Extension] Error registering summon buttons:", error);
    }
}

// Function to initialize the bot editor integration
function initializeBotEditor(options: ExtensionModuleOptions) {
    console.log("[Bot Extension] Initializing bot editor, waiting for user connection...");

    // Start registering summon buttons immediately (don't wait for userIsConnected)
    // This ensures buttons are available as soon as bots spawn
    const startSummonButtonRegistration = () => {
        // Try immediately
        registerSummonButtonsForBots();
        // Then retry every 3 seconds for the first 15 seconds (to catch bots as they spawn)
        let retries = 0;
        const maxRetries = 5;
        const retryInterval = setInterval(() => {
            retries++;
            registerSummonButtonsForBots();
            if (retries >= maxRetries) {
                clearInterval(retryInterval);
                // Then switch to less frequent polling (every 10 seconds)
                setInterval(registerSummonButtonsForBots, 10000);
            }
        }, 3000);
    };

    // Start registration after a short delay
    setTimeout(startSummonButtonRegistration, 2000);

    // Wait for user to be connected, then set up bot editor UI (for authenticated users only)
    unsubscribeUserConnected = userIsConnected.subscribe((connected) => {
        console.log(`[Bot Extension] User connection status changed: ${connected}`);
        if (connected) {
            // Only set up bot editor UI for authenticated users
            if (localUserStore.isLogged()) {
                setTimeout(() => {
                    setupBotEditor(options);
                }, 1000);
            }

            // Ensure summon buttons are registered (in case they weren't already)
            registerSummonButtonsForBots();

            if (unsubscribeUserConnected) {
                unsubscribeUserConnected();
                unsubscribeUserConnected = null;
            }
        }
    });

    // Also check if already connected
    const alreadyConnected = get(userIsConnected);
    console.log(`[Bot Extension] Already connected check: ${alreadyConnected}`);
    if (alreadyConnected) {
        if (localUserStore.isLogged()) {
            console.log("[Bot Extension] User already connected, setting up bot editor");
            setTimeout(() => {
                setupBotEditor(options);
            }, 1000);
        }

        // Ensure summon buttons are registered
        registerSummonButtonsForBots();
    }
}

const botExtensionModule: ExtensionModule = {
    id: "workadventure-bots",
    calendarSynchronised: false,
    todoListSynchronized: false,

    init(roomMetadata: unknown, options: ExtensionModuleOptions) {
        console.log("Bot Extension Module initialized");

        // Check if room changed (before storing new options or initializing service)
        // Compare with current roomId in BotApiService if it's already initialized
        const previousRoomId = _extensionOptions?.roomId || botApiService.getRoomId();
        const roomIdChanged = previousRoomId !== null && previousRoomId !== options.roomId;

        if (roomIdChanged) {
            console.log(`[Bot Extension] Room changed from ${previousRoomId} to ${options.roomId}`);
        }

        // Store options for later use
        _extensionOptions = options;

        // Notify room enter immediately (user is already in the room when module loads)
        // This ensures bots spawn even if userIsConnected hasn't fired yet
        console.log("[Bot Extension] Notifying room enter immediately on init");
        notifyRoomEnterForAllUsers(options);

        // If room changed and bot editor is open, trigger a reload
        if (roomIdChanged && botEditorOpen) {
            console.log("[Bot Extension] Room changed and bot editor is open, triggering reload");
            // Import dynamically to avoid circular dependency
            void import("./stores/BotEditorStore").then(({ roomChangeTriggerStore }) => {
                console.log("[Bot Extension] Updating roomChangeTriggerStore");
                roomChangeTriggerStore.update((n) => n + 1);
            });
        }

        // Also start summon button registration after bots have time to spawn
        setTimeout(() => {
            registerSummonButtonsForBots();
        }, 3000);

        // Initialize bot editor integration (for authenticated users)
        // This will call setupBotEditor if user is already connected
        initializeBotEditor(options);

        // Also ensure setupBotEditor is called if user is already connected and authenticated
        // This ensures the API service is updated with the new roomId
        if (localUserStore.isLogged()) {
            const alreadyConnected = get(userIsConnected);
            if (alreadyConnected) {
                console.log("[Bot Extension] User already connected, ensuring bot editor is set up for new room");
                setTimeout(() => {
                    setupBotEditor(options);

                    // Wait a bit longer to ensure setupBotEditor has fully initialized subscriptions
                    setTimeout(() => {
                        // If BotEditor tool was selected before destroy() (user had it open when navigating),
                        // restore the tool selection and reopen the bot editor for the new room
                        if (wasBotEditorSelectedBeforeDestroy) {
                            console.log(
                                "[Bot Extension] BotEditor was selected before navigation, restoring and reopening for new room"
                            );
                            // Restore tool selection - this should trigger the subscription in setupBotEditor
                            // which will call openBotEditor() automatically
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            mapEditorSelectedToolStore.set(BOT_EDITOR_TOOL_NAME as any);
                            // Also call openBotEditor directly as a fallback (in case subscription hasn't fired yet)
                            setTimeout(() => {
                                // Check if tool selection was actually set (might have been overridden)
                                const currentTool = get(mapEditorSelectedToolStore);
                                if (currentTool === BOT_EDITOR_TOOL_NAME && !botEditorOpen) {
                                    console.log(
                                        "[Bot Extension] Tool selection restored but editor not open, opening now"
                                    );
                                    openBotEditor();
                                } else if (currentTool !== BOT_EDITOR_TOOL_NAME) {
                                    console.warn(
                                        `[Bot Extension] Tool selection was not restored (current: ${currentTool}), trying again...`
                                    );
                                    // Try again - something might have reset it
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    mapEditorSelectedToolStore.set(BOT_EDITOR_TOOL_NAME as any);
                                    setTimeout(() => {
                                        if (!botEditorOpen) {
                                            openBotEditor();
                                        }
                                    }, 200);
                                }
                            }, 300);
                        } else {
                            // Check if tool is currently selected (might have been preserved)
                            const selectedTool = get(mapEditorSelectedToolStore);
                            if (selectedTool === BOT_EDITOR_TOOL_NAME && !botEditorOpen) {
                                console.log(
                                    "[Bot Extension] BotEditor tool still selected, reopening bot editor for new room"
                                );
                                openBotEditor();
                            }
                        }
                    }, 800); // Increased delay to ensure setupBotEditor completes
                }, 500);
            }
        }
    },

    destroy() {
        // Check if BotEditor tool was selected before destroying
        // This allows us to restore it in init() if user was in bot editor when navigating
        wasBotEditorSelectedBeforeDestroy = get(mapEditorSelectedToolStore) === BOT_EDITOR_TOOL_NAME;

        // Store the roomId before destroying, so we can detect room changes when editor reopens
        // Don't clear lastRoomIdWhenEditorWasOpen - we need it to detect room changes
        // when the editor is reopened after navigating to a new map
        // Also, don't clear botEditorOpen state - we'll check if tool is still selected in init()

        // Notify bot-server that player left the room (may despawn bots if room is empty)
        if (_extensionOptions?.roomId && botApiService.isInitialized()) {
            botApiService.notifyRoomLeave(_extensionOptions.roomId).catch((e) => {
                console.warn("[Bot Editor] Failed to notify room leave:", e);
            });
        }

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
        if (unsubscribeSelectedTool) {
            unsubscribeSelectedTool();
            unsubscribeSelectedTool = null;
        }
        // Remove tool button (but don't unsubscribe from tool selection - we need to restore it)
        // Actually, we do need to unsubscribe to avoid memory leaks, but we'll restore selection in init()
        removeBotEditorTool();
        // Don't close bot editor here - just remove the component
        // The tool selection might still be "BotEditor", and we'll reopen it in init() if needed
        removeBotEditorComponent();
        botEditorOpen = false; // Mark as closed, but we'll check tool selection in init()
        // Don't switch to EntityEditor - preserve the tool selection so we can restore it in init()
        // Ensure Phaser tool is deactivated (in case closeBotEditor didn't handle it)
        try {
            destroyBotEditorTool();
        } catch (e) {
            console.warn("Error deactivating bot editor tool in destroy:", e);
        }
        sidebarContentElement = null;
        // Don't clear _extensionOptions - we need it to detect room changes
        // It will be updated in init() with the new roomId
    },
};

export default botExtensionModule;
