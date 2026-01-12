import { writable, derived, get } from "svelte/store";
import type { BotData } from "../types";
import { botApiService } from "../services/BotApiService";

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
    if (!bot.id) {
        console.warn("[BotEditorStore] upsertBot called with bot missing id:", bot);
        return;
    }

    botPreviewsStore.update((bots) => {
        const newMap = new Map(bots);
        // Ensure we're using the correct key (bot.id)
        newMap.set(bot.id, bot);
        // Safety check: ensure no duplicates exist
        if (newMap.size !== bots.size + (bots.has(bot.id) ? 0 : 1)) {
            console.warn("[BotEditorStore] Potential duplicate detected after upsertBot:", {
                botId: bot.id,
                oldSize: bots.size,
                newSize: newMap.size,
            });
        }
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
 * Saves position to API and spawns the bot
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

        // Save position to Admin API and spawn the bot (async, don't block)
        if (botApiService.isInitialized() && updatedBot.id) {
            // Save updated position to API
            botApiService
                .updateBot(updatedBot.id, {
                    behaviorConfig: updatedBot.behaviorConfig,
                })
                .then(() => {
                    console.log("[BotEditorStore] Bot position saved, spawning bot...");
                    // Spawn the bot on the server
                    return botApiService.spawnBot(updatedBot.id);
                })
                .then((result) => {
                    if (result.spawned) {
                        console.log("[BotEditorStore] Bot spawned successfully");
                    } else {
                        console.log("[BotEditorStore] Bot spawn result:", result.reason);
                    }
                })
                .catch((error) => {
                    console.error("[BotEditorStore] Error saving/spawning bot:", error);
                });
        }

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
 * Send live update to the running bot on the server
 * This teleports the bot or updates its behavior in real-time
 */
export async function sendLiveUpdate(
    botId: string,
    updates: {
        position?: { x: number; y: number };
        behaviorConfig?: Record<string, unknown>;
        behaviorType?: string;
    }
): Promise<void> {
    if (!botApiService.isInitialized()) {
        console.warn("[BotEditorStore] API not initialized, skipping live update");
        return;
    }

    try {
        const result = await botApiService.updateRunningBot(botId, updates);
        if (result.updated) {
            console.log(`[BotEditorStore] Live update sent: ${result.changes?.join(", ")}`);
        } else {
            // Bot might not be running (e.g., room is empty), that's okay
            console.log(`[BotEditorStore] Live update skipped: ${result.reason}`);
        }
    } catch (error) {
        console.error("[BotEditorStore] Live update error:", error);
    }
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

            // Send live update to running bot (teleport it)
            void sendLiveUpdate(botId, { position: { x, y } });

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

            // Send live update to running bot
            void sendLiveUpdate(botId, {
                behaviorConfig: {
                    assignedSpace: { ...updatedBot.behaviorConfig.assignedSpace },
                },
            });

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

            // Send live update to running bot
            void sendLiveUpdate(botId, {
                behaviorConfig: { conversationRadius },
            });

            return newMap;
        }
        return bots;
    });
}

/**
 * Update a bot's behavior type
 */
export function updateBehaviorType(botId: string, behaviorType: "idle" | "patrol" | "social"): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot) {
            const updatedBot: BotData = {
                ...bot,
                behaviorType,
                behaviorConfig: {
                    ...bot.behaviorConfig,
                    behaviorType,
                    // Clear waypoints when switching away from patrol
                    ...(behaviorType !== "patrol" ? { patrolWaypoints: [] } : {}),
                    // Set default conversation radius when switching to social
                    ...(behaviorType === "social" && !bot.behaviorConfig?.conversationRadius
                        ? { conversationRadius: Math.min(100, bot.behaviorConfig?.assignedSpace?.radius || 100) }
                        : {}),
                },
            };
            const newMap = new Map(bots);
            newMap.set(botId, updatedBot);

            // Update selected bot if it's the same one
            const selected = get(selectedBotStore);
            if (selected?.id === botId) {
                selectedBotStore.set(updatedBot);
            }

            // Send live update to running bot (changes behavior in real-time)
            void sendLiveUpdate(botId, {
                behaviorType,
                behaviorConfig: updatedBot.behaviorConfig,
            });

            return newMap;
        }
        return bots;
    });
}

/**
 * Clear all waypoints for a patrol bot
 */
export function clearWaypoints(botId: string): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot && bot.behaviorConfig?.behaviorType === "patrol") {
            const updatedBot: BotData = {
                ...bot,
                behaviorConfig: {
                    ...bot.behaviorConfig,
                    patrolWaypoints: [],
                },
            };

            const newMap = new Map(bots);
            newMap.set(botId, updatedBot);

            // Update selected bot if it's the same one
            const selected = get(selectedBotStore);
            if (selected?.id === botId) {
                selectedBotStore.set(updatedBot);
            }

            // Send live update with empty waypoints
            void sendLiveUpdate(botId, {
                behaviorConfig: { patrolWaypoints: [] },
            });

            return newMap;
        }
        return bots;
    });
}

/**
 * Add a waypoint to a patrol bot
 */
export function addWaypoint(botId: string, x: number, y: number, index?: number): void {
    let updatedWaypoints: Array<{ x: number; y: number }> | undefined;

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

            updatedWaypoints = waypoints;

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

    // Send live update with new waypoints
    if (updatedWaypoints) {
        void sendLiveUpdate(botId, {
            behaviorConfig: { patrolWaypoints: updatedWaypoints },
        });
    }
}

/**
 * Update a waypoint position
 */
export function updateWaypoint(botId: string, waypointIndex: number, x: number, y: number): void {
    let updatedWaypoints: Array<{ x: number; y: number }> | undefined;

    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot && bot.behaviorConfig?.behaviorType === "patrol") {
            const waypoints = [...(bot.behaviorConfig.patrolWaypoints || [])];
            if (waypointIndex >= 0 && waypointIndex < waypoints.length) {
                waypoints[waypointIndex] = { x, y };
                updatedWaypoints = waypoints;

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

    // Send live update with new waypoints
    if (updatedWaypoints) {
        void sendLiveUpdate(botId, {
            behaviorConfig: { patrolWaypoints: updatedWaypoints },
        });
    }
}

/**
 * Remove a waypoint
 */
export function removeWaypoint(botId: string, waypointIndex: number): void {
    let updatedWaypoints: Array<{ x: number; y: number }> | undefined;

    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot && bot.behaviorConfig?.behaviorType === "patrol") {
            const waypoints = [...(bot.behaviorConfig.patrolWaypoints || [])];
            if (waypointIndex >= 0 && waypointIndex < waypoints.length) {
                waypoints.splice(waypointIndex, 1);
                updatedWaypoints = waypoints;

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

    // Send live update with updated waypoints
    if (updatedWaypoints) {
        void sendLiveUpdate(botId, {
            behaviorConfig: { patrolWaypoints: updatedWaypoints },
        });
    }
}

/**
 * Load bots from API response into the store
 * Converts API format to BotData format
 */
export function loadBotPreviews(apiBots: Array<Record<string, unknown>>): void {
    const botsMap = new Map<string, BotData>();

    for (const apiBot of apiBots) {
        const botData: BotData = {
            id: apiBot.id as string,
            botId: apiBot.id as string,
            name: apiBot.name as string,
            description: (apiBot.description as string) || undefined,
            characterTexture: (apiBot.characterTextureId as string) || "",
            characterTextureIds: (apiBot.characterTextureId as string) ? [apiBot.characterTextureId as string] : [],
            behaviorType: (apiBot.behaviorType as "idle" | "patrol" | "social") || "idle",
            enabled: (apiBot.enabled as boolean) ?? true,
            behaviorConfig: (apiBot.behaviorConfig as BotData["behaviorConfig"]) || {
                behaviorType: (apiBot.behaviorType as "idle" | "patrol" | "social") || "idle",
                assignedSpace: {
                    center: { x: 0, y: 0 },
                    radius: 0,
                },
            },
            aiProviderRef: (apiBot.aiProviderRef as string) || undefined,
            chatInstructions: (apiBot.chatInstructions as string) || "",
            movementInstructions: (apiBot.movementInstructions as string) || "",
            createdAt: (apiBot.createdAt as string) || new Date().toISOString(),
            updatedAt: (apiBot.updatedAt as string) || new Date().toISOString(),
            createdBy: (apiBot.createdBy as BotData["createdBy"]) || null,
            updatedBy: (apiBot.updatedBy as BotData["updatedBy"]) || null,
        };

        botsMap.set(botData.id, botData);
    }

    botPreviewsStore.set(botsMap);
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
