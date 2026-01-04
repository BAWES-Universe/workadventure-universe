import Phaser from "phaser";
import { get } from "svelte/store";
import type { Unsubscriber } from "svelte/store";
import type { BotData } from "../types";
import {
    botEditorModeStore,
    botEditorToolActiveStore,
    selectedBotStore,
    botPreviewsStore,
    placingBotStore,
    placementCursorStore,
    hoveredBotIdStore,
    editingWaypointIndexStore,
    updateBotPosition,
    updateBotRadius,
    addWaypoint,
    updateWaypoint,
    removeWaypoint,
    selectBot,
    confirmPlacement,
    cancelPlacement,
    stopWaypointEditing,
    type BotEditorMode,
} from "../stores/BotEditorStore";
import { gameManager } from "../../../Phaser/Game/GameManager";
import { WaypointPath, WaypointPathEvent } from "./WaypointPath";
import { BotPreview, BotPreviewEvent } from "./BotPreview";

/**
 * BotEditorTool - Manages bot visualization and interaction on the map
 *
 * This tool is activated when the bot editor is open and provides:
 * - Visual previews of all bots on the map
 * - Selection and drag-and-drop positioning
 * - Radius adjustment via drag handles
 * - Waypoint editing for patrol bots
 * - Placement mode for new bots
 */
export class BotEditorTool {
    private scene: Phaser.Scene | undefined;
    private botPreviews: Map<string, BotPreview> = new Map();
    private waypointPaths: Map<string, WaypointPath> = new Map();
    private placementPreview: BotPreview | undefined;

    private isActive: boolean = false;
    private shiftKey?: Phaser.Input.Keyboard.Key;
    private escapeKey?: Phaser.Input.Keyboard.Key;
    private deleteKey?: Phaser.Input.Keyboard.Key;

    // Store subscriptions
    private unsubscribers: Unsubscriber[] = [];

    // Event handlers
    private pointerDownHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerMoveHandler?: (pointer: Phaser.Input.Pointer) => void;
    private pointerUpHandler?: (pointer: Phaser.Input.Pointer) => void;

    constructor() {
        // Scene will be set on activate
    }

    /**
     * Get the current game scene
     */
    private getScene(): Phaser.Scene | undefined {
        try {
            return gameManager.getCurrentGameScene();
        } catch {
            return undefined;
        }
    }

    /**
     * Activate the bot editor tool
     */
    public activate(): void {
        if (this.isActive) {
            return;
        }

        this.scene = this.getScene();
        if (!this.scene) {
            console.warn("BotEditorTool: Cannot activate - no scene available");
            return;
        }

        this.isActive = true;
        botEditorToolActiveStore.set(true);

        // Setup keyboard
        this.shiftKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
        this.escapeKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        this.deleteKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.DELETE);

        // Subscribe to stores
        this.subscribeToStores();

        // Bind event handlers
        this.bindEventHandlers();

        // Create previews for existing bots
        this.createBotPreviews();

        console.log("BotEditorTool: Activated");
    }

    /**
     * Deactivate the bot editor tool
     */
    public deactivate(): void {
        if (!this.isActive) {
            return;
        }

        this.isActive = false;
        botEditorToolActiveStore.set(false);

        // Unbind event handlers
        this.unbindEventHandlers();

        // Unsubscribe from stores
        this.unsubscribers.forEach((unsub) => unsub());
        this.unsubscribers = [];

        // Destroy all previews
        this.destroyAllPreviews();

        // Clean up keyboard
        this.shiftKey = undefined;
        this.escapeKey = undefined;
        this.deleteKey = undefined;

        console.log("BotEditorTool: Deactivated");
    }

    /**
     * Update method - call from game loop
     */
    public update(time: number, delta: number): void {
        if (!this.isActive) {
            return;
        }

        // Update all bot previews
        this.botPreviews.forEach((preview) => preview.update(time, delta));

        // Handle keyboard input
        this.handleKeyboardInput();
    }

    /**
     * Subscribe to store changes
     */
    private subscribeToStores(): void {
        // Subscribe to bots store to create/update/remove previews
        const botsUnsub = botPreviewsStore.subscribe((bots) => {
            this.syncPreviews(bots);
        });
        this.unsubscribers.push(botsUnsub);

        // Subscribe to selected bot changes
        const selectedUnsub = selectedBotStore.subscribe((bot) => {
            this.updateSelection(bot);
        });
        this.unsubscribers.push(selectedUnsub);

        // Subscribe to hovered bot changes
        const hoveredUnsub = hoveredBotIdStore.subscribe((botId) => {
            this.updateHover(botId);
        });
        this.unsubscribers.push(hoveredUnsub);

        // Subscribe to mode changes
        const modeUnsub = botEditorModeStore.subscribe((mode) => {
            this.handleModeChange(mode);
        });
        this.unsubscribers.push(modeUnsub);

        // Subscribe to placement cursor
        const cursorUnsub = placementCursorStore.subscribe((cursor) => {
            this.updatePlacementPreview(cursor);
        });
        this.unsubscribers.push(cursorUnsub);

        // Subscribe to placing bot
        const placingUnsub = placingBotStore.subscribe((bot) => {
            if (bot && !this.placementPreview && this.scene) {
                this.createPlacementPreview(bot);
            } else if (!bot && this.placementPreview) {
                this.destroyPlacementPreview();
            }
        });
        this.unsubscribers.push(placingUnsub);
    }

    /**
     * Bind Phaser event handlers
     */
    private bindEventHandlers(): void {
        if (!this.scene) {
            return;
        }

        this.pointerDownHandler = (pointer: Phaser.Input.Pointer) => {
            this.handlePointerDown(pointer);
        };

        this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
            this.handlePointerMove(pointer);
        };

        this.pointerUpHandler = (pointer: Phaser.Input.Pointer) => {
            this.handlePointerUp(pointer);
        };

        this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.pointerDownHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_UP, this.pointerUpHandler);
    }

    /**
     * Unbind Phaser event handlers
     */
    private unbindEventHandlers(): void {
        if (!this.scene) {
            return;
        }

        if (this.pointerDownHandler) {
            this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.pointerDownHandler);
        }
        if (this.pointerMoveHandler) {
            this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveHandler);
        }
        if (this.pointerUpHandler) {
            this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.pointerUpHandler);
        }
    }

    /**
     * Handle pointer down event
     */
    private handlePointerDown(pointer: Phaser.Input.Pointer): void {
        const mode = get(botEditorModeStore);

        if (mode === "placing") {
            // Set cursor position from click if not already set
            let x = pointer.worldX;
            let y = pointer.worldY;

            // Snap to grid if shift is held
            if (this.shiftKey?.isDown) {
                x = Math.round(x / 32) * 32;
                y = Math.round(y / 32) * 32;
            }

            placementCursorStore.set({ x, y });

            // Confirm placement
            const bot = confirmPlacement();
            if (bot) {
                // Create the preview for the newly placed bot
                this.createBotPreview(bot);
            }
            return;
        }

        if (mode === "waypoint-edit") {
            const selectedBot = get(selectedBotStore);
            if (selectedBot) {
                const waypointPath = this.waypointPaths.get(selectedBot.id);
                // Check if clicking on path to insert waypoint
                waypointPath?.handlePathClick(pointer.worldX, pointer.worldY);
            }
            return;
        }

        // Check if clicking on empty space to deselect
        const hitObjects = this.scene?.input.hitTestPointer(pointer);
        const hitBot = hitObjects?.find((obj) => {
            return this.botPreviews.has((obj as BotPreview).getBotId?.());
        });

        if (!hitBot && mode === "detail") {
            selectBot(undefined);
            botEditorModeStore.set("list");
        }
    }

    /**
     * Handle pointer move event
     */
    private handlePointerMove(pointer: Phaser.Input.Pointer): void {
        const mode = get(botEditorModeStore);

        if (mode === "placing") {
            let x = pointer.worldX;
            let y = pointer.worldY;

            // Snap to grid if shift is held
            if (this.shiftKey?.isDown) {
                x = Math.round(x / 32) * 32;
                y = Math.round(y / 32) * 32;
            }

            placementCursorStore.set({ x, y });
        }
    }

    /**
     * Handle pointer up event
     */
    private handlePointerUp(_pointer: Phaser.Input.Pointer): void {
        // Notify all bot previews of pointer up (for radius handle release)
        this.botPreviews.forEach((preview) => {
            preview.handlePointerUp();
        });
    }

    /**
     * Handle keyboard input
     */
    private handleKeyboardInput(): void {
        // Escape key
        if (Phaser.Input.Keyboard.JustDown(this.escapeKey!)) {
            const mode = get(botEditorModeStore);

            if (mode === "placing") {
                cancelPlacement();
            } else if (mode === "waypoint-edit") {
                stopWaypointEditing();
            } else if (mode === "detail") {
                selectBot(undefined);
                botEditorModeStore.set("list");
            }
        }

        // Delete key
        if (Phaser.Input.Keyboard.JustDown(this.deleteKey!)) {
            const mode = get(botEditorModeStore);
            const selectedBot = get(selectedBotStore);

            if (mode === "waypoint-edit") {
                const waypointIndex = get(editingWaypointIndexStore);
                if (selectedBot && waypointIndex !== undefined && waypointIndex >= 0) {
                    removeWaypoint(selectedBot.id, waypointIndex);
                }
            } else if (selectedBot) {
                // Delete the selected bot
                this.deleteBotPreview(selectedBot.id);
            }
        }
    }

    /**
     * Handle mode change
     */
    private handleModeChange(mode: BotEditorMode): void {
        // Update cursor based on mode
        if (this.scene) {
            switch (mode) {
                case "placing":
                    this.scene.input.setDefaultCursor("crosshair");
                    break;
                case "waypoint-edit": {
                    this.scene.input.setDefaultCursor("cell");
                    // Enable waypoint editing for selected bot
                    const selectedBot = get(selectedBotStore);
                    if (selectedBot) {
                        const waypointPath = this.waypointPaths.get(selectedBot.id);
                        waypointPath?.setEditing(true);
                    }
                    break;
                }
                default:
                    this.scene.input.setDefaultCursor("auto");
                    // Disable waypoint editing
                    this.waypointPaths.forEach((path) => path.setEditing(false));
                    break;
            }
        }
    }

    /**
     * Create bot previews from store
     */
    private createBotPreviews(): void {
        const bots = get(botPreviewsStore);
        bots.forEach((bot) => {
            this.createBotPreview(bot);
        });
    }

    /**
     * Create a single bot preview
     */
    private createBotPreview(bot: BotData): void {
        if (!this.scene || this.botPreviews.has(bot.id)) {
            return;
        }

        const preview = new BotPreview(this.scene, bot);

        // Setup event handlers
        preview.on(BotPreviewEvent.Selected, (selectedPreview: BotPreview) => {
            selectBot(selectedPreview.getBotData());
        });

        preview.on(BotPreviewEvent.PositionChanged, (botId: string, x: number, y: number) => {
            updateBotPosition(botId, x, y);
        });

        preview.on(BotPreviewEvent.RadiusChanged, (botId: string, radius: number) => {
            updateBotRadius(botId, radius);
        });

        this.botPreviews.set(bot.id, preview);

        // Create waypoint path if patrol bot
        if (bot.behaviorConfig?.behaviorType === "patrol") {
            this.createWaypointPath(bot);
        }
    }

    /**
     * Create waypoint path for a patrol bot
     */
    private createWaypointPath(bot: BotData): void {
        if (!this.scene || this.waypointPaths.has(bot.id)) {
            return;
        }

        const waypoints = bot.behaviorConfig?.patrolWaypoints || [];
        const waypointPath = new WaypointPath(this.scene, waypoints);

        // Setup event handlers
        waypointPath.on(WaypointPathEvent.WaypointMoved, (index: number, x: number, y: number) => {
            updateWaypoint(bot.id, index, x, y);
        });

        waypointPath.on(WaypointPathEvent.WaypointAdded, (index: number, x: number, y: number) => {
            addWaypoint(bot.id, x, y, index);
        });

        waypointPath.on(WaypointPathEvent.WaypointDeleted, (index: number) => {
            removeWaypoint(bot.id, index);
        });

        this.waypointPaths.set(bot.id, waypointPath);
    }

    /**
     * Sync previews with store data
     */
    private syncPreviews(bots: Map<string, BotData>): void {
        // Remove previews for bots that no longer exist
        this.botPreviews.forEach((preview, botId) => {
            if (!bots.has(botId)) {
                this.deleteBotPreview(botId);
            }
        });

        // Create or update previews for all bots
        bots.forEach((bot) => {
            if (this.botPreviews.has(bot.id)) {
                // Update existing preview
                const preview = this.botPreviews.get(bot.id)!;
                preview.updateBotData(bot);

                // Update waypoint path if patrol
                if (bot.behaviorConfig?.behaviorType === "patrol") {
                    let waypointPath = this.waypointPaths.get(bot.id);
                    if (!waypointPath && this.scene) {
                        this.createWaypointPath(bot);
                        waypointPath = this.waypointPaths.get(bot.id);
                    }
                    waypointPath?.setWaypoints(bot.behaviorConfig.patrolWaypoints || []);
                } else {
                    // Remove waypoint path if behavior changed
                    this.deleteWaypointPath(bot.id);
                }
            } else {
                // Create new preview
                this.createBotPreview(bot);
            }
        });
    }

    /**
     * Update selection state
     */
    private updateSelection(selectedBot: BotData | undefined): void {
        this.botPreviews.forEach((preview, botId) => {
            preview.setSelected(selectedBot?.id === botId);
        });

        // Show/hide waypoint paths based on selection
        this.waypointPaths.forEach((path, botId) => {
            path.setVisible(selectedBot?.id === botId);
        });
    }

    /**
     * Update hover state
     */
    private updateHover(hoveredBotId: string | undefined): void {
        this.botPreviews.forEach((preview, botId) => {
            if (botId !== get(selectedBotStore)?.id) {
                preview.setHovered(hoveredBotId === botId);
            }
        });
    }

    /**
     * Create placement preview
     */
    private createPlacementPreview(bot: BotData): void {
        if (!this.scene) {
            return;
        }

        const cursor = get(placementCursorStore);
        const previewBot: BotData = {
            ...bot,
            behaviorConfig: {
                ...bot.behaviorConfig,
                assignedSpace: {
                    ...bot.behaviorConfig.assignedSpace,
                    center: cursor || { x: 0, y: 0 },
                },
            },
        };

        this.placementPreview = new BotPreview(this.scene, previewBot);
        this.placementPreview.setAlpha(0.6);
    }

    /**
     * Update placement preview position
     */
    private updatePlacementPreview(cursor: { x: number; y: number } | undefined): void {
        if (this.placementPreview && cursor) {
            this.placementPreview.setPosition(cursor.x, cursor.y);
        }
    }

    /**
     * Destroy placement preview
     */
    private destroyPlacementPreview(): void {
        this.placementPreview?.destroy();
        this.placementPreview = undefined;
    }

    /**
     * Delete a bot preview
     */
    private deleteBotPreview(botId: string): void {
        const preview = this.botPreviews.get(botId);
        if (preview) {
            preview.destroy();
            this.botPreviews.delete(botId);
        }

        this.deleteWaypointPath(botId);
    }

    /**
     * Delete a waypoint path
     */
    private deleteWaypointPath(botId: string): void {
        const waypointPath = this.waypointPaths.get(botId);
        if (waypointPath) {
            waypointPath.destroy();
            this.waypointPaths.delete(botId);
        }
    }

    /**
     * Destroy all previews
     */
    private destroyAllPreviews(): void {
        this.botPreviews.forEach((preview) => preview.destroy());
        this.botPreviews.clear();

        this.waypointPaths.forEach((path) => path.destroy());
        this.waypointPaths.clear();

        this.destroyPlacementPreview();
    }

    /**
     * Pan camera to a bot
     */
    public panToBot(botId: string): void {
        const bot = get(botPreviewsStore).get(botId);
        if (bot && this.scene) {
            const x = bot.behaviorConfig?.assignedSpace?.center?.x || 0;
            const y = bot.behaviorConfig?.assignedSpace?.center?.y || 0;

            // Use the game's camera manager to pan
            try {
                const gameScene = gameManager.getCurrentGameScene();
                gameScene.getCameraManager().setPosition({ x, y }, 500);
            } catch (e) {
                console.warn("BotEditorTool: Could not pan camera", e);
            }
        }
    }

    /**
     * Check if tool is active
     */
    public getIsActive(): boolean {
        return this.isActive;
    }
}

// Singleton instance
let botEditorToolInstance: BotEditorTool | undefined;

/**
 * Get the bot editor tool singleton
 */
export function getBotEditorTool(): BotEditorTool {
    if (!botEditorToolInstance) {
        botEditorToolInstance = new BotEditorTool();
    }
    return botEditorToolInstance;
}

/**
 * Destroy the bot editor tool singleton
 */
export function destroyBotEditorTool(): void {
    botEditorToolInstance?.deactivate();
    botEditorToolInstance = undefined;
}
