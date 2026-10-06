import { writable, derived, get } from "svelte/store";
import type { BotData } from "../types";
import { botApiService } from "../services/BotApiService";
import { botModel, routeStops, walksRoute } from "../behaviorModel";

/**
 * Bot Editor Mode
 * - "list": Viewing the list of all bots
 * - "detail": Viewing/editing a single bot's details
 * - "placing": Placing a new bot on the map (click to set position)
 * - "waypoint-edit": Editing patrol waypoints for a bot
 */
export type BotEditorMode = "list" | "create" | "detail" | "placing" | "waypoint-edit";

/**
 * Current editor mode
 */
export const botEditorModeStore = writable<BotEditorMode>("list");

/**
 * Room change trigger - incrementing this value signals that the room has changed
 * BotEditor should reload bots when this value changes
 */
export const roomChangeTriggerStore = writable<number>(0);

/**
 * Currently selected bot for editing
 */
export const selectedBotStore = writable<BotData | undefined>(undefined);

/**
 * All bots on the current map
 */
export const botPreviewsStore = writable<Map<string, BotData>>(new Map());

/**
 * Room whose bots are currently in botPreviewsStore. The store outlives the editor panel, so
 * reopening the editor in the same room can show these bots straight away while it refreshes.
 */
export const botsLoadedForRoomIdStore = writable<string | null>(null);

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
    if (!bot) {
        selectedBotStore.set(undefined);
        return;
    }

    // Always get the latest bot data from previews store to ensure we have the correct bot
    // This prevents selecting stale bot data
    const previews = get(botPreviewsStore);
    const latestBot = previews.get(bot.id);

    // Use the bot from store if available, otherwise use the provided bot
    const botToSelect = latestBot || bot;

    if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
        console.log("[BotEditorStore] selectBot:", {
            requestedBotId: bot.id,
            requestedBotName: bot.name,
            foundInStore: !!latestBot,
            selectedBotId: botToSelect.id,
            selectedBotName: botToSelect.name,
            aiProviderRef: botToSelect.aiProviderRef,
        });
    }

    selectedBotStore.set(botToSelect);
    botEditorModeStore.set("detail");
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

// The stops when Edit route was pressed, to tell on Done whether the route changed.
let routeAtEditStart: Array<{ x: number; y: number }> | undefined;

/**
 * Enter waypoint editing mode for patrol bots
 * Auto-creates first waypoint at bot's center if none exist
 */
export function startWaypointEditing(): void {
    const bot = get(selectedBotStore);
    if (bot && walksRoute(bot)) {
        routeUndoStack = [];
        routeUndoCountStore.set(0);
        routeAtEditStart = routeStops(bot).map((p) => ({ ...p }));
        // Auto-create first waypoint at bot's center if no waypoints exist
        if (routeStops(bot).length === 0) {
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
    // Done after the route changed: the bot starts it again from stop 1 instead of walking back to it. Only on Done,
    // so it doesn't jump while the stops are being added or dragged.
    const bot = get(selectedBotStore);
    if (bot && walksRoute(bot)) {
        const stops = routeStops(bot);
        const before = routeAtEditStart;
        const changed =
            !before ||
            before.length !== stops.length ||
            before.some((p, i) => p.x !== stops[i].x || p.y !== stops[i].y);
        if (changed && stops.length > 0) {
            void sendLiveUpdate(bot.id, { behaviorConfig: { patrolWaypoints: stops }, restartRoute: true });
        }
    }
    routeAtEditStart = undefined;
    editingWaypointIndexStore.set(undefined);
    routeUndoStack = [];
    routeUndoCountStore.set(0);
    botEditorModeStore.set("detail");
}

// Undo while editing a route: each change to the stops saves the stops it replaced. Done or leaving the route
// forgets them; the editor's own Undo (the pill at the top) is for objects and areas.
let routeUndoStack: Array<Array<{ x: number; y: number }>> = [];
/** How many route changes can be undone, so the route bar can show its Undo button. */
export const routeUndoCountStore = writable(0);

function rememberRouteForUndo(bot: BotData): void {
    if (get(botEditorModeStore) !== "waypoint-edit") return;
    routeUndoStack.push(routeStops(bot).map((p) => ({ ...p })));
    routeUndoCountStore.set(routeUndoStack.length);
}

/** Put back the stops as they were before the last change while editing the route. */
export function undoRouteChange(): void {
    const bot = get(selectedBotStore);
    const previous = routeUndoStack.pop();
    routeUndoCountStore.set(routeUndoStack.length);
    if (!bot || !previous) return;
    setRouteStops(bot.id, previous);
}

/** Replace all of a route bot's stops, as Undo does. */
export function setRouteStops(botId: string, stops: Array<{ x: number; y: number }>): void {
    let updated: BotData | undefined;
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (!bot) return bots;
        updated = { ...bot, behaviorConfig: { ...bot.behaviorConfig, patrolWaypoints: stops } };
        const newMap = new Map(bots);
        newMap.set(botId, updated);
        if (get(selectedBotStore)?.id === botId) {
            selectedBotStore.set(updated);
        }
        return newMap;
    });
    if (updated) {
        void sendLiveUpdate(botId, { behaviorConfig: { patrolWaypoints: stops } });
    }
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
        restartRoute?: boolean;
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

// Saves per bot, run one after another. The bots server reads the stored config, merges the update and writes it
// back, so two saves in flight for the same bot can overwrite each other (a late AI save putting back the behavior
// type a config save just changed, or a first drag's save landing after the second's)
const botSaveQueues = new Map<string, Promise<unknown>>();

/** Run a save for a bot once its earlier saves have finished */
export function queueBotSave<T>(botId: string, run: () => Promise<T>): Promise<T> {
    const save = (botSaveQueues.get(botId) ?? Promise.resolve()).then(run);
    // The next save waits for this one whether it succeeds or fails
    const settled = save.then(
        () => undefined,
        () => undefined
    );
    botSaveQueues.set(botId, settled);
    void settled.then(() => {
        if (botSaveQueues.get(botId) === settled) {
            botSaveQueues.delete(botId);
        }
    });
    return save;
}

function saveBotBehaviorConfig(bot: BotData): Promise<void> {
    if (!botApiService.isInitialized()) {
        return Promise.resolve();
    }
    return queueBotSave(bot.id, () =>
        botApiService.updateBot(bot.id, {
            behaviorType: bot.behaviorType || bot.behaviorConfig?.behaviorType || "idle",
            behaviorConfig: bot.behaviorConfig,
        })
    ).then(
        () => undefined,
        (error) => {
            console.error("[BotEditorStore] Failed to save bot position:", error);
        }
    );
}

/**
 * Update a bot's position
 */
export function updateBotPosition(botId: string, x: number, y: number): void {
    botPreviewsStore.update((bots) => {
        const bot = bots.get(botId);
        if (bot) {
            // On a route, stop 1 is where the bot starts, so it moves with the bot. The other stops stay where they
            // are: they are map positions, not offsets from the bot.
            const stops = routeStops(bot);
            const patrolWaypoints = walksRoute(bot) && stops.length > 0 ? [{ x, y }, ...stops.slice(1)] : undefined;
            const updatedBot: BotData = {
                ...bot,
                behaviorConfig: {
                    ...bot.behaviorConfig,
                    assignedSpace: {
                        ...bot.behaviorConfig.assignedSpace,
                        center: { x, y },
                    },
                    ...(patrolWaypoints ? { patrolWaypoints } : {}),
                },
            };
            const newMap = new Map(bots);
            newMap.set(botId, updatedBot);

            // Update selected bot if it's the same one
            const selected = get(selectedBotStore);
            if (selected?.id === botId) {
                selectedBotStore.set(updatedBot);
            }

            // Send live update to running bot (teleport it), with the route's new stop 1
            void sendLiveUpdate(botId, {
                position: { x, y },
                ...(patrolWaypoints ? { behaviorConfig: { patrolWaypoints } } : {}),
            });

            // Save the new spot now: a drag ends once, and the editor's auto-save only covers the selected
            // bot, so a bot dragged without being selected (or just before the editor closes) kept its old spot.
            void saveBotBehaviorConfig(updatedBot);

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
        if (bot && botModel(bot).goesToPeople) {
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
        if (bot && walksRoute(bot)) {
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
        if (bot && walksRoute(bot)) {
            rememberRouteForUndo(bot);
            const waypoints = routeStops(bot);
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
        if (bot && walksRoute(bot)) {
            rememberRouteForUndo(bot);
            const waypoints = routeStops(bot);
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
        if (bot && walksRoute(bot)) {
            rememberRouteForUndo(bot);
            const waypoints = routeStops(bot);
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
        // Get behaviorType with proper fallback - check both top-level and behaviorConfig
        // Ensure it's never undefined
        const apiBehaviorConfig = apiBot.behaviorConfig as BotData["behaviorConfig"] | undefined;
        let behaviorType: "idle" | "patrol" | "social" =
            (apiBot.behaviorType as "idle" | "patrol" | "social") || apiBehaviorConfig?.behaviorType || "idle"; // Final fallback

        // Ensure it's a valid value
        if (!["idle", "patrol", "social"].includes(behaviorType)) {
            console.warn(
                `[BotEditorStore] Invalid behaviorType "${behaviorType}" for bot ${apiBot.id}, defaulting to "idle"`
            );
            behaviorType = "idle";
        }

        // Preserve existing behaviorConfig and only merge in defaults for missing required fields
        // Reuse apiBehaviorConfig declared above
        const behaviorConfig: BotData["behaviorConfig"] =
            apiBehaviorConfig && typeof apiBehaviorConfig === "object" && !Array.isArray(apiBehaviorConfig)
                ? {
                      // Preserve all existing fields
                      ...apiBehaviorConfig,
                      // Ensure behaviorType is set
                      behaviorType: apiBehaviorConfig.behaviorType || behaviorType,
                      // Ensure assignedSpace exists with defaults
                      assignedSpace: apiBehaviorConfig.assignedSpace || {
                          center: { x: 0, y: 0 },
                          radius: 0,
                      },
                  }
                : {
                      // Fallback: create minimal config if behaviorConfig is missing/invalid
                      behaviorType,
                      assignedSpace: {
                          center: { x: 0, y: 0 },
                          radius: 0,
                      },
                  };

        const botData: BotData = {
            id: apiBot.id as string,
            botId: apiBot.id as string,
            name: apiBot.name as string,
            description: (apiBot.description as string) || undefined,
            characterTexture: (apiBot.characterTextureId as string) || "",
            characterTextureIds: (apiBot.characterTextureId as string) ? [apiBot.characterTextureId as string] : [],
            behaviorType,
            enabled: (apiBot.enabled as boolean) ?? true,
            behaviorConfig,
            aiProviderRef: (apiBot.aiProviderRef as string) || undefined,
            toolTimeoutSeconds: typeof apiBot.toolTimeoutSeconds === "number" ? apiBot.toolTimeoutSeconds : null,
            chatInstructions: (apiBot.chatInstructions as string) || "",
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
    botsLoadedForRoomIdStore.set(null);
    placingBotStore.set(undefined);
    placementCursorStore.set(undefined);
    editingWaypointIndexStore.set(undefined);
    botEditorToolActiveStore.set(false);
    hoveredBotIdStore.set(undefined);
}
