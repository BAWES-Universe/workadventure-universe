import { writable, derived, get } from "svelte/store";
import type { BotData } from "../types";

/**
 * Bot Editor Mode
 * - "list": Viewing the list of all bots
 * - "detail": Viewing/editing a single bot's details
 * - "placing": Placing a new bot on the map (click to set position)
 * - "waypoint-edit": Editing patrol waypoints for a bot
 */
export type BotEditorMode = "list" | "detail" | "placing" | "waypoint-edit";

/**
 * Current editor mode
 */
export const botEditorModeStore = writable<BotEditorMode>("list");

/**
 * Currently selected bot for editing
 */
export const selectedBotStore = writable<BotData | undefined>(undefined);

/**
 * All bots on the current map
 */
export const botPreviewsStore = writable<Map<string, BotData>>(new Map());

/**
 * Bot being placed (temporary state during placement)
 */
export const placingBotStore = writable<BotData | undefined>(undefined);

/**
 * Current cursor position during placement mode
 */
export const placementCursorStore = writable<{ x: number; y: number } | undefined>(undefined);

/**
 * Waypoint index currently being edited (for patrol bots)
 */
export const editingWaypointIndexStore = writable<number | undefined>(undefined);

/**
 * Whether the bot editor tool is active on the map
 */
export const botEditorToolActiveStore = writable<boolean>(false);

/**
 * Bot currently being hovered in the list (for map highlighting)
 */
export const hoveredBotIdStore = writable<string | undefined>(undefined);

/**
 * Derived store: Get the selected bot's behavior type
 */
export const selectedBotBehaviorStore = derived(selectedBotStore, ($selectedBot) => {
    return $selectedBot?.behaviorConfig?.behaviorType || "idle";
});

/**
 * Derived store: Check if we're in an editing mode (not list)
 */
export const isEditingStore = derived(botEditorModeStore, ($mode) => {
    return $mode !== "list";
});

/**
 * Derived store: Get bots as an array for easier iteration
 */
export const botsArrayStore = derived(botPreviewsStore, ($botsMap) => {
    return Array.from($botsMap.values());
});

// ============================================================================
// Store Actions
// ============================================================================

/**
 * Add or update a bot in the previews store
 */
export function upsertBot(bot: BotData): void {
    botPreviewsStore.update((bots) => {
        const newMap = new Map(bots);
        newMap.set(bot.id, bot);
        return newMap;
    });

    // Also update selectedBotStore if this is the selected bot
    const selected = get(selectedBotStore);
    if (selected?.id === bot.id) {
        selectedBotStore.set(bot);
    }
}

/**
 * Remove a bot from the previews store
 */
export function removeBot(botId: string): void {
    botPreviewsStore.update((bots) => {
        const newMap = new Map(bots);
        newMap.delete(botId);
        return newMap;
    });

    // Clear selection if the removed bot was selected
    const selected = get(selectedBotStore);
    if (selected?.id === botId) {
        selectedBotStore.set(undefined);
        botEditorModeStore.set("list");
    }
}

/**
 * Select a bot for editing
 */
export function selectBot(bot: BotData | undefined): void {
    selectedBotStore.set(bot);
    if (bot) {
        botEditorModeStore.set("detail");
    }
}

/**
 * Start placing a new bot
 */
export function startPlacingBot(bot: BotData): void {
    placingBotStore.set(bot);
    botEditorModeStore.set("placing");
}

/**
 * Cancel bot placement
 */
export function cancelPlacement(): void {
    placingBotStore.set(undefined);
    placementCursorStore.set(undefined);
    botEditorModeStore.set("list");
}

/**
 * Confirm bot placement at current cursor position
 */
export function confirmPlacement(): BotData | undefined {
    const bot = get(placingBotStore);
    const cursor = get(placementCursorStore);

    if (bot && cursor) {
        // Update bot position
        const updatedBot: BotData = {
            ...bot,
            behaviorConfig: {
                ...bot.behaviorConfig,
                assignedSpace: {
                    ...bot.behaviorConfig.assignedSpace,
                    center: { x: cursor.x, y: cursor.y },
                },
            },
        };

        // Add to bots and select it
        upsertBot(updatedBot);
        selectBot(updatedBot);

        // Clear placement state
        placingBotStore.set(undefined);
        placementCursorStore.set(undefined);

        return updatedBot;
    }

    return undefined;
}

/**
 * Enter waypoint editing mode for patrol bots
 * Auto-creates first waypoint at bot's center if none exist
 */
export function startWaypointEditing(): void {
    const bot = get(selectedBotStore);
    if (bot?.behaviorConfig?.behaviorType === "patrol") {
        // Auto-create first waypoint at bot's center if no waypoints exist
        const waypoints = bot.behaviorConfig.patrolWaypoints || [];
        if (waypoints.length === 0) {
            const center = bot.behaviorConfig.assignedSpace?.center || { x: 0, y: 0 };
            addWaypoint(bot.id, center.x, center.y);
        }
        botEditorModeStore.set("waypoint-edit");
    }
}

/**
 * Exit waypoint editing mode
 */
export function stopWaypointEditing(): void {
    editingWaypointIndexStore.set(undefined);
    botEditorModeStore.set("detail");
}

/**
 * Update a bot's position
 */
export function updateBotPosition(botId: string, x: number, y: number): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot) {
            // Check if position changed significantly (more than 10 pixels)
            const oldCenter = bot.behaviorConfig?.assignedSpace?.center;
            const dx = oldCenter ? x - oldCenter.x : 0;
            const dy = oldCenter ? y - oldCenter.y : 0;
            const movedSignificantly = Math.sqrt(dx * dx + dy * dy) > 10;

            // Clear patrol waypoints if bot was moved significantly
            const shouldClearWaypoints = movedSignificantly && bot.behaviorConfig?.behaviorType === "patrol";

            const updatedBot: BotData = {
                ...bot,
                behaviorConfig: {
                    ...bot.behaviorConfig,
                    assignedSpace: {
                        ...bot.behaviorConfig.assignedSpace,
                        center: { x, y },
                    },
                    // Clear waypoints if bot moved
                    ...(shouldClearWaypoints ? { patrolWaypoints: [] } : {}),
                },
            };
            const newMap = new Map(bots);
            newMap.set(botId, updatedBot);

            // Update selected bot if it's the same one
            const selected = get(selectedBotStore);
            if (selected?.id === botId) {
                selectedBotStore.set(updatedBot);
            }

            return newMap;
        }
        return bots;
    });
}

/**
 * Update a bot's radius
 */
export function updateBotRadius(botId: string, radius: number): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot) {
            const updatedBot: BotData = {
                ...bot,
                behaviorConfig: {
                    ...bot.behaviorConfig,
                    assignedSpace: {
                        ...bot.behaviorConfig.assignedSpace,
                        radius,
                    },
                },
            };
            const newMap = new Map(bots);
            newMap.set(botId, updatedBot);

            // Update selected bot if it's the same one
            const selected = get(selectedBotStore);
            if (selected?.id === botId) {
                selectedBotStore.set(updatedBot);
            }

            return newMap;
        }
        return bots;
    });
}

/**
 * Update a bot's conversation radius (social bots)
 */
export function updateConversationRadius(botId: string, conversationRadius: number): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot && bot.behaviorConfig?.behaviorType === "social") {
            const updatedBot: BotData = {
                ...bot,
                behaviorConfig: {
                    ...bot.behaviorConfig,
                    conversationRadius,
                },
            };
            const newMap = new Map(bots);
            newMap.set(botId, updatedBot);

            // Update selected bot if it's the same one
            const selected = get(selectedBotStore);
            if (selected?.id === botId) {
                selectedBotStore.set(updatedBot);
            }

            return newMap;
        }
        return bots;
    });
}

/**
 * Add a waypoint to a patrol bot
 */
export function addWaypoint(botId: string, x: number, y: number, index?: number): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot && bot.behaviorConfig?.behaviorType === "patrol") {
            const waypoints = [...(bot.behaviorConfig.patrolWaypoints || [])];
            const newWaypoint = { x, y };

            if (index !== undefined && index >= 0 && index <= waypoints.length) {
                waypoints.splice(index, 0, newWaypoint);
            } else {
                waypoints.push(newWaypoint);
            }

            const updatedBot: BotData = {
                ...bot,
                behaviorConfig: {
                    ...bot.behaviorConfig,
                    patrolWaypoints: waypoints,
                },
            };

            const newMap = new Map(bots);
            newMap.set(botId, updatedBot);

            // Update selected bot if it's the same one
            const selected = get(selectedBotStore);
            if (selected?.id === botId) {
                selectedBotStore.set(updatedBot);
            }

            return newMap;
        }
        return bots;
    });
}

/**
 * Update a waypoint position
 */
export function updateWaypoint(botId: string, waypointIndex: number, x: number, y: number): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot && bot.behaviorConfig?.behaviorType === "patrol") {
            const waypoints = [...(bot.behaviorConfig.patrolWaypoints || [])];
            if (waypointIndex >= 0 && waypointIndex < waypoints.length) {
                waypoints[waypointIndex] = { x, y };

                const updatedBot: BotData = {
                    ...bot,
                    behaviorConfig: {
                        ...bot.behaviorConfig,
                        patrolWaypoints: waypoints,
                    },
                };

                const newMap = new Map(bots);
                newMap.set(botId, updatedBot);

                // Update selected bot if it's the same one
                const selected = get(selectedBotStore);
                if (selected?.id === botId) {
                    selectedBotStore.set(updatedBot);
                }

                return newMap;
            }
        }
        return bots;
    });
}

/**
 * Remove a waypoint
 */
export function removeWaypoint(botId: string, waypointIndex: number): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot && bot.behaviorConfig?.behaviorType === "patrol") {
            const waypoints = [...(bot.behaviorConfig.patrolWaypoints || [])];
            if (waypointIndex >= 0 && waypointIndex < waypoints.length) {
                waypoints.splice(waypointIndex, 1);

                const updatedBot: BotData = {
                    ...bot,
                    behaviorConfig: {
                        ...bot.behaviorConfig,
                        patrolWaypoints: waypoints,
                    },
                };

                const newMap = new Map(bots);
                newMap.set(botId, updatedBot);

                // Update selected bot if it's the same one
                const selected = get(selectedBotStore);
                if (selected?.id === botId) {
                    selectedBotStore.set(updatedBot);
                }

                // Clear editing index if we deleted the one being edited
                const editingIndex = get(editingWaypointIndexStore);
                if (editingIndex === waypointIndex) {
                    editingWaypointIndexStore.set(undefined);
                } else if (editingIndex !== undefined && editingIndex > waypointIndex) {
                    // Adjust index if we deleted one before the editing one
                    editingWaypointIndexStore.set(editingIndex - 1);
                }

                return newMap;
            }
        }
        return bots;
    });
}

/**
 * Reset all stores to initial state
 */
export function resetBotEditorStores(): void {
    botEditorModeStore.set("list");
    selectedBotStore.set(undefined);
    botPreviewsStore.set(new Map());
    placingBotStore.set(undefined);
    placementCursorStore.set(undefined);
    editingWaypointIndexStore.set(undefined);
    botEditorToolActiveStore.set(false);
    hoveredBotIdStore.set(undefined);
}
