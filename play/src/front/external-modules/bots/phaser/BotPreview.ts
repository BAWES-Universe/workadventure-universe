import Phaser from "phaser";
import type { BotData } from "../types";

const TILE_SIZE = 32;
const BOT_DEPTH = 1000;

// Behavior colors
const COLORS = {
    idle: { fill: 0x3b82f6, stroke: 0x1d4ed8 }, // Blue
    patrol: { fill: 0x22c55e, stroke: 0x15803d }, // Green
    social: { fill: 0xa855f7, stroke: 0x7c3aed }, // Purple
    default: { fill: 0x6b7280, stroke: 0x4b5563 }, // Gray
};

export enum BotPreviewEvent {
    Selected = "BotPreview:Selected",
    PositionChanged = "BotPreview:PositionChanged",
    RadiusChanged = "BotPreview:RadiusChanged",
    ConversationRadiusChanged = "BotPreview:ConversationRadiusChanged",
    DragStart = "BotPreview:DragStart",
    DragEnd = "BotPreview:DragEnd",
}

/**
 * Simple bot preview - a colored 32x32 square with radius circle
 */
export class BotPreview extends Phaser.GameObjects.Container {
    private botData: BotData;
    private square: Phaser.GameObjects.Rectangle;
    private radiusCircle: Phaser.GameObjects.Arc;
    private conversationRadiusCircle: Phaser.GameObjects.Arc | null = null;
    private nameText: Phaser.GameObjects.Text;
    private resizeHandle: Phaser.GameObjects.Arc;
    private conversationResizeHandle: Phaser.GameObjects.Arc | null = null;

    private isSelected = false;
    private isHovered = false;
    private isDragging = false;
    private isResizing = false;

    constructor(scene: Phaser.Scene, botData: BotData) {
        const x = botData.behaviorConfig?.assignedSpace?.center?.x || 0;
        const y = botData.behaviorConfig?.assignedSpace?.center?.y || 0;

        super(scene, x, y);
        this.botData = botData;

        const colors = this.getColors();
        const radius = botData.behaviorConfig?.assignedSpace?.radius || 0;
        const conversationRadius = botData.behaviorConfig?.conversationRadius || 0;

        // Radius circle (behind square)
        this.radiusCircle = scene.add.arc(0, 0, radius, 0, 360, false);
        this.radiusCircle.setFillStyle(colors.fill, 0.2);
        this.radiusCircle.setStrokeStyle(2, colors.stroke, 0.6);
        this.radiusCircle.setVisible(radius > 0);
        this.add(this.radiusCircle);

        // Conversation radius circle for social bots
        if (botData.behaviorConfig?.behaviorType === "social") {
            const convRadius = conversationRadius > 0 ? conversationRadius : Math.min(80, radius);
            this.conversationRadiusCircle = scene.add.arc(0, 0, convRadius, 0, 360, false);
            this.conversationRadiusCircle.setFillStyle(0xa855f7, 0.15);
            this.conversationRadiusCircle.setStrokeStyle(3, 0xa855f7, 0.9);
            this.add(this.conversationRadiusCircle);

            // Conversation radius resize handle (purple, on y-axis to distinguish)
            this.conversationResizeHandle = scene.add.arc(0, -convRadius, 8, 0, 360, false, 0xe9d5ff);
            this.conversationResizeHandle.setStrokeStyle(2, 0xa855f7);
            this.conversationResizeHandle.setVisible(false);
            this.conversationResizeHandle.setInteractive({ cursor: "ns-resize", draggable: true });
            this.add(this.conversationResizeHandle);

            // Setup conversation handle drag
            this.conversationResizeHandle.on(Phaser.Input.Events.DRAG_START, () => {
                this.isResizing = true;
            });

            this.conversationResizeHandle.on(
                Phaser.Input.Events.DRAG,
                (_p: Phaser.Input.Pointer, _dragX: number, dragY: number) => {
                    const movementRadius = this.botData.behaviorConfig?.assignedSpace?.radius || 100;
                    // Cap conversation radius between 50 and movement area
                    const newRadius = Math.min(movementRadius, Math.max(50, Math.abs(dragY)));
                    this.setConversationRadius(newRadius);
                    this.emit(BotPreviewEvent.ConversationRadiusChanged, this.botData.id, newRadius);
                }
            );

            this.conversationResizeHandle.on(Phaser.Input.Events.DRAG_END, () => {
                this.isResizing = false;
            });
        }

        // Main square (32x32 tile)
        this.square = scene.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, colors.fill);
        this.square.setStrokeStyle(3, colors.stroke);
        this.add(this.square);

        // Name label
        this.nameText = scene.add.text(0, -TILE_SIZE / 2 - 8, botData.name || "Bot", {
            fontSize: "11px",
            color: "#ffffff",
            backgroundColor: "#000000cc",
            padding: { x: 4, y: 2 },
        });
        this.nameText.setOrigin(0.5, 1);
        this.add(this.nameText);

        // Resize handle for movement area (on radius edge, only visible when selected)
        this.resizeHandle = scene.add.arc(radius, 0, 8, 0, 360, false, 0xffffff);
        this.resizeHandle.setStrokeStyle(2, colors.stroke);
        this.resizeHandle.setVisible(false);
        this.resizeHandle.setInteractive({ cursor: "ew-resize", draggable: true });
        this.add(this.resizeHandle);

        // Setup movement area handle drag
        this.resizeHandle.on(Phaser.Input.Events.DRAG_START, () => {
            this.isResizing = true;
        });

        this.resizeHandle.on(Phaser.Input.Events.DRAG, (_p: Phaser.Input.Pointer, dragX: number) => {
            // For social bots, don't allow radius smaller than conversation radius
            const minRadius =
                this.botData.behaviorConfig?.behaviorType === "social"
                    ? Math.max(50, this.botData.behaviorConfig?.conversationRadius || 50)
                    : 16;
            const newRadius = Math.max(minRadius, Math.abs(dragX));
            this.setRadius(newRadius);
            this.emit(BotPreviewEvent.RadiusChanged, this.botData.id, newRadius);
        });

        this.resizeHandle.on(Phaser.Input.Events.DRAG_END, () => {
            this.isResizing = false;
        });

        // Container setup
        this.setDepth(BOT_DEPTH);
        this.setSize(TILE_SIZE, TILE_SIZE);
        this.setInteractive({ cursor: "pointer", draggable: true });

        // Container events
        this.on(Phaser.Input.Events.POINTER_OVER, () => {
            if (!this.isSelected) this.setHovered(true);
        });

        this.on(Phaser.Input.Events.POINTER_OUT, () => {
            if (!this.isDragging) this.setHovered(false);
        });

        this.on(Phaser.Input.Events.POINTER_DOWN, () => {
            if (!this.isResizing) {
                this.emit(BotPreviewEvent.Selected, this);
            }
        });

        this.on(Phaser.Input.Events.DRAG_START, () => {
            if (!this.isResizing) {
                this.isDragging = true;
                this.setAlpha(0.7);
                this.emit(BotPreviewEvent.DragStart, this);
            }
        });

        this.on(Phaser.Input.Events.DRAG, (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            if (!this.isResizing) {
                this.setPosition(dragX, dragY);
            }
        });

        this.on(Phaser.Input.Events.DRAG_END, () => {
            if (!this.isResizing) {
                this.isDragging = false;
                this.setAlpha(1);

                // Update data
                if (this.botData.behaviorConfig?.assignedSpace?.center) {
                    this.botData.behaviorConfig.assignedSpace.center = { x: this.x, y: this.y };
                }

                this.emit(BotPreviewEvent.PositionChanged, this.botData.id, this.x, this.y);
                this.emit(BotPreviewEvent.DragEnd, this);
            }
        });

        scene.add.existing(this);
    }

    private getColors() {
        const type = this.botData.behaviorConfig?.behaviorType || this.botData.behaviorType || "idle";
        return COLORS[type as keyof typeof COLORS] || COLORS.default;
    }

    public setSelected(selected: boolean): void {
        this.isSelected = selected;
        const colors = this.getColors();
        const radius = this.botData.behaviorConfig?.assignedSpace?.radius || 0;

        if (selected) {
            this.square.setStrokeStyle(4, 0xffffff);
            this.radiusCircle.setFillStyle(colors.fill, 0.3);
            this.radiusCircle.setStrokeStyle(3, colors.stroke, 0.8);
            this.resizeHandle.setVisible(radius > 0);
            // Show conversation radius handle for social bots
            this.conversationResizeHandle?.setVisible(true);
        } else {
            this.square.setStrokeStyle(3, colors.stroke);
            this.radiusCircle.setFillStyle(colors.fill, 0.2);
            this.radiusCircle.setStrokeStyle(2, colors.stroke, 0.6);
            this.resizeHandle.setVisible(false);
            this.conversationResizeHandle?.setVisible(false);
        }
    }

    public getSelected(): boolean {
        return this.isSelected;
    }

    public setHovered(hovered: boolean): void {
        this.isHovered = hovered;
        const colors = this.getColors();

        if (hovered && !this.isSelected) {
            this.square.setStrokeStyle(3, 0xffffff, 0.8);
            this.radiusCircle.setVisible(true);
        } else if (!this.isSelected) {
            this.square.setStrokeStyle(3, colors.stroke);
            const radius = this.botData.behaviorConfig?.assignedSpace?.radius || 0;
            this.radiusCircle.setVisible(radius > 0);
        }
    }

    public setRadius(radius: number): void {
        if (this.botData.behaviorConfig?.assignedSpace) {
            this.botData.behaviorConfig.assignedSpace.radius = radius;
        }

        this.radiusCircle.setRadius(radius);
        this.radiusCircle.setVisible(radius > 0);
        this.resizeHandle.setPosition(radius, 0);
        this.resizeHandle.setVisible(this.isSelected && radius > 0);
    }

    public setConversationRadius(radius: number): void {
        if (this.botData.behaviorConfig) {
            this.botData.behaviorConfig.conversationRadius = radius;
        }

        if (this.conversationRadiusCircle) {
            this.conversationRadiusCircle.setRadius(radius);
            this.conversationRadiusCircle.setVisible(radius > 0);
        }
        if (this.conversationResizeHandle) {
            this.conversationResizeHandle.setPosition(0, -radius);
            this.conversationResizeHandle.setVisible(this.isSelected);
        }
    }

    public getBotData(): BotData {
        return this.botData;
    }

    public getBotId(): string {
        return this.botData.id;
    }

    public updateBotData(newData: Partial<BotData>): void {
        // Deep merge behaviorConfig to preserve all fields
        if (newData.behaviorConfig) {
            this.botData = {
                ...this.botData,
                ...newData,
                behaviorConfig: {
                    ...this.botData.behaviorConfig,
                    ...newData.behaviorConfig,
                    assignedSpace: {
                        ...this.botData.behaviorConfig?.assignedSpace,
                        ...newData.behaviorConfig?.assignedSpace,
                    },
                },
            };
        } else {
            this.botData = { ...this.botData, ...newData };
        }

        // Update position
        const center = this.botData.behaviorConfig?.assignedSpace?.center;
        if (center) {
            this.setPosition(center.x, center.y);
        }

        // Update radius
        const radius = this.botData.behaviorConfig?.assignedSpace?.radius;
        if (radius !== undefined) {
            this.setRadius(radius);
        }

        // Get current behavior type (check both locations)
        const behaviorType = this.botData.behaviorConfig?.behaviorType || this.botData.behaviorType || "idle";

        // Update colors based on behavior type
        const colors = this.getColors();
        this.square.setFillStyle(colors.fill);
        if (!this.isSelected) {
            this.square.setStrokeStyle(3, colors.stroke);
        }
        this.radiusCircle.setFillStyle(colors.fill, this.isSelected ? 0.3 : 0.2);
        this.radiusCircle.setStrokeStyle(this.isSelected ? 3 : 2, colors.stroke, this.isSelected ? 0.8 : 0.6);
        this.resizeHandle.setStrokeStyle(2, colors.stroke);

        // Update name
        if (newData.name !== undefined) {
            this.nameText.setText(newData.name);
        }

        // Update conversation radius for social bots
        const conversationRadius = this.botData.behaviorConfig?.conversationRadius || 0;

        if (behaviorType === "social") {
            const convRadius = conversationRadius > 0 ? conversationRadius : Math.min(80, radius || 100);
            if (!this.conversationRadiusCircle) {
                this.conversationRadiusCircle = this.scene.add.arc(0, 0, convRadius, 0, 360, false);
                this.conversationRadiusCircle.setFillStyle(0xa855f7, 0.15);
                this.conversationRadiusCircle.setStrokeStyle(3, 0xa855f7, 0.9);
                this.addAt(this.conversationRadiusCircle, 1);
            } else {
                this.conversationRadiusCircle.setRadius(convRadius);
            }
            this.conversationRadiusCircle.setVisible(true);

            // Create resize handle if it doesn't exist
            if (!this.conversationResizeHandle) {
                this.conversationResizeHandle = this.scene.add.arc(0, -convRadius, 8, 0, 360, false, 0xe9d5ff);
                this.conversationResizeHandle.setStrokeStyle(2, 0xa855f7);
                this.conversationResizeHandle.setVisible(this.isSelected);
                this.conversationResizeHandle.setInteractive({ cursor: "ns-resize", draggable: true });
                this.add(this.conversationResizeHandle);

                this.conversationResizeHandle.on(Phaser.Input.Events.DRAG_START, () => {
                    this.isResizing = true;
                });
                this.conversationResizeHandle.on(
                    Phaser.Input.Events.DRAG,
                    (_p: Phaser.Input.Pointer, _dragX: number, dragY: number) => {
                        const movementRadius = this.botData.behaviorConfig?.assignedSpace?.radius || 100;
                        const newRadius = Math.min(movementRadius, Math.max(50, Math.abs(dragY)));
                        this.setConversationRadius(newRadius);
                        this.emit(BotPreviewEvent.ConversationRadiusChanged, this.botData.id, newRadius);
                    }
                );
                this.conversationResizeHandle.on(Phaser.Input.Events.DRAG_END, () => {
                    this.isResizing = false;
                });
            } else {
                this.conversationResizeHandle.setPosition(0, -convRadius);
                this.conversationResizeHandle.setVisible(this.isSelected);
            }
        } else {
            // Hide social elements for non-social bots
            this.conversationRadiusCircle?.setVisible(false);
            this.conversationResizeHandle?.setVisible(false);
        }
    }

    public update(_time: number, _delta: number): void {
        // No-op for now
    }

    public handlePointerUp(): void {
        this.isResizing = false;
    }

    public getRadiusOverlay(): Phaser.GameObjects.Arc {
        return this.radiusCircle;
    }

    public destroy(fromScene?: boolean): void {
        this.square.destroy();
        this.radiusCircle.destroy();
        this.conversationRadiusCircle?.destroy();
        this.conversationResizeHandle?.destroy();
        this.nameText.destroy();
        this.resizeHandle.destroy();
        super.destroy(fromScene);
    }
}
