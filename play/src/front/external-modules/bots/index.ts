import { get } from "svelte/store";
import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import { localUserStore } from "../../Connection/LocalUserStore";
import { mapEditorActivated, userIsConnected } from "../../Stores/MenuStore";
import { mapEditorVisibilityStore, mapEditorSelectedToolStore } from "../../Stores/MapEditorStore";
import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";

const BOT_EDITOR_TOOL_NAME = "BotEditor" as EditorToolName;
let botEditorOpen = false;
let unsubscribeUserConnected: (() => void) | null = null;
let unsubscribeMapEditor: (() => void) | null = null;
let unsubscribeMapEditorVisibility: (() => void) | null = null;
let unsubscribeSelectedTool: (() => void) | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Stored for potential future use
let _extensionOptions: ExtensionModuleOptions | null = null;
let toolButtonElement: HTMLElement | null = null;
let sidebarContentElement: HTMLElement | null = null;
let botEditorComponentInstance: { destroy: () => void } | null = null;
let buttonClickHandler: ((e: Event) => void) | null = null;

// Function to open the bot editor in sidebar
function openBotEditor() {
    if (botEditorOpen) return;

    botEditorOpen = true;
    mapEditorVisibilityStore.set(true);

    // Set the selected tool to our custom BotEditor tool name
    // We use a type assertion since BotEditor isn't in the enum, but the store accepts it at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapEditorSelectedToolStore.set(BOT_EDITOR_TOOL_NAME as any);

    // Try to inject the component into the sidebar
    injectBotEditorComponent();
}

// Function to close the bot editor
function closeBotEditor() {
    botEditorOpen = false;
    removeBotEditorComponent();

    // If BotEditor was selected, switch to EntityEditor or close
    if (get(mapEditorSelectedToolStore) === BOT_EDITOR_TOOL_NAME) {
        mapEditorSelectedToolStore.set(EditorToolName.EntityEditor);
    }
}

// Function to inject BotEditor component into the sidebar content area
function injectBotEditorComponent() {
    if (botEditorComponentInstance) {
        return; // Already injected
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

    // Insert after header buttons
    const headerButtons = sidebar.querySelector(".flex.flex-row.justify-end");
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
        })
        .catch((error) => {
            console.error("Failed to load BotEditor component:", error);
        });
}

// Function to remove BotEditor component from sidebar
function removeBotEditorComponent() {
    if (botEditorComponentInstance) {
        botEditorComponentInstance.destroy();
        botEditorComponentInstance = null;
    }

    const container = document.querySelector("#bot-editor-container");
    if (container && container.parentElement) {
        container.parentElement.removeChild(container);
    }

    // Show conditional content again
    if (sidebarContentElement) {
        const conditionalContent = sidebarContentElement.querySelectorAll(":scope > *");
        conditionalContent.forEach((el) => {
            if (el instanceof HTMLElement && el.id !== "bot-editor-container") {
                el.style.display = "";
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

    // Check if button already exists
    if (toolsContainer.querySelector("#bot-editor-tool-btn")) {
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
        if (unsubscribeSelectedTool) {
            unsubscribeSelectedTool();
            unsubscribeSelectedTool = null;
        }
        // Remove tool button
        removeBotEditorTool();
        closeBotEditor();
        sidebarContentElement = null;
        _extensionOptions = null;
    },
};

export default botExtensionModule;
