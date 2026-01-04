import Phaser from "phaser";

const WAYPOINT_RADIUS = 16;
const WAYPOINT_HOVER_RADIUS = 20;
const PATH_LINE_WIDTH = 4;
const PATH_COLOR = 0x22c55e;
const PATH_HOVER_COLOR = 0x4ade80;
const WAYPOINT_FILL = 0xffffff;
const WAYPOINT_STROKE = 0x15803d;
const ARROW_SIZE = 12;
const WAYPOINT_DEPTH = 1002;

export enum WaypointPathEvent {
    WaypointSelected = "WaypointPath:WaypointSelected",
    WaypointMoved = "WaypointPath:WaypointMoved",
    WaypointAdded = "WaypointPath:WaypointAdded",
    WaypointDeleted = "WaypointPath:WaypointDeleted",
}

interface Waypoint {
    x: number;
    y: number;
}

interface WaypointMarker {
    container: Phaser.GameObjects.Container;
    circle: Phaser.GameObjects.Arc;
    label: Phaser.GameObjects.Text;
    deleteButton: Phaser.GameObjects.Arc;
}

/**
 * WaypointPath - Visual patrol route editor
 *
 * Features:
 * - Large, easy to grab waypoint markers
 * - Drag markers to reposition
 * - Click "+" to add waypoint at end
 * - Click "X" on marker to delete
 * - Directional arrows showing patrol direction
 */
export class WaypointPath extends Phaser.GameObjects.Container {
    private waypoints: Waypoint[];
    private pathGraphics: Phaser.GameObjects.Graphics;
    private markers: WaypointMarker[] = [];
    private addButton: Phaser.GameObjects.Container | null = null;
    private selectedIndex: number = -1;
    private isEditing: boolean = false;
    private isDragging: boolean = false;

    private shiftKey?: Phaser.Input.Keyboard.Key;

    // Instruction overlay
    private instructionText: Phaser.GameObjects.Text | null = null;

    constructor(scene: Phaser.Scene, waypoints: Waypoint[] = []) {
        super(scene, 0, 0);

        this.waypoints = [...waypoints];

        this.shiftKey = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        // Path graphics
        this.pathGraphics = scene.add.graphics();
        this.add(this.pathGraphics);

        this.setDepth(WAYPOINT_DEPTH);

        // Build markers
        this.rebuildMarkers();
        this.draw();

        scene.add.existing(this);
    }

    /**
     * Set waypoints
     */
    public setWaypoints(waypoints: Waypoint[]): void {
        this.waypoints = [...waypoints];
        this.selectedIndex = -1;
        this.rebuildMarkers();
        this.draw();
    }

    /**
     * Get waypoints
     */
    public getWaypoints(): Waypoint[] {
        return [...this.waypoints];
    }

    /**
     * Enable/disable editing mode
     */
    public setEditing(editing: boolean): void {
        this.isEditing = editing;

        // Update marker interactivity
        this.markers.forEach((marker) => {
            if (editing) {
                marker.container.setInteractive({ cursor: "grab", draggable: true });
                marker.deleteButton.setVisible(true);
            } else {
                marker.container.disableInteractive();
                marker.deleteButton.setVisible(false);
            }
        });

        // Show/hide add button
        if (this.addButton) {
            this.addButton.setVisible(editing);
        }

        // Show/hide instructions
        this.updateInstructions();

        if (!editing) {
            this.selectedIndex = -1;
        }

        this.draw();
    }

    /**
     * Get editing state
     */
    public getEditing(): boolean {
        return this.isEditing;
    }

    /**
     * Select a waypoint
     */
    public selectWaypoint(index: number): void {
        this.selectedIndex = index;
        this.draw();
        this.emit(WaypointPathEvent.WaypointSelected, index);
    }

    /**
     * Get selected index
     */
    public getSelectedWaypointIndex(): number {
        return this.selectedIndex;
    }

    /**
     * Add a waypoint at position
     */
    public addWaypoint(x: number, y: number, index?: number): void {
        const newWaypoint = { x, y };

        if (index !== undefined && index >= 0 && index <= this.waypoints.length) {
            this.waypoints.splice(index, 0, newWaypoint);
        } else {
            this.waypoints.push(newWaypoint);
        }

        this.rebuildMarkers();
        this.draw();
        this.emit(WaypointPathEvent.WaypointAdded, this.waypoints.length - 1, x, y);
    }

    /**
     * Remove a waypoint
     */
    public removeWaypoint(index: number): void {
        if (index >= 0 && index < this.waypoints.length && this.waypoints.length > 0) {
            this.waypoints.splice(index, 1);

            if (this.selectedIndex === index) {
                this.selectedIndex = -1;
            } else if (this.selectedIndex > index) {
                this.selectedIndex--;
            }

            this.rebuildMarkers();
            this.draw();
            this.emit(WaypointPathEvent.WaypointDeleted, index);
        }
    }

    /**
     * Update a waypoint position
     */
    public updateWaypoint(index: number, x: number, y: number): void {
        if (index >= 0 && index < this.waypoints.length) {
            this.waypoints[index] = { x, y };
            this.draw();
            this.emit(WaypointPathEvent.WaypointMoved, index, x, y);
        }
    }

    /**
     * Rebuild all waypoint markers
     */
    private rebuildMarkers(): void {
        // Destroy existing
        this.markers.forEach((m) => {
            m.container.destroy();
        });
        this.markers = [];

        if (this.addButton) {
            this.addButton.destroy();
            this.addButton = null;
        }

        // Create markers
        this.waypoints.forEach((wp, index) => {
            const marker = this.createMarker(wp, index);
            this.markers.push(marker);
            this.add(marker.container);
        });

        // Create "+" add button
        this.createAddButton();

        // Update instructions
        this.updateInstructions();
    }

    /**
     * Create a waypoint marker
     */
    private createMarker(waypoint: Waypoint, index: number): WaypointMarker {
        const container = this.scene.add.container(waypoint.x, waypoint.y);

        // Main circle
        const circle = this.scene.add.arc(0, 0, WAYPOINT_RADIUS, 0, 360, false, WAYPOINT_FILL, 1);
        circle.setStrokeStyle(3, WAYPOINT_STROKE);
        container.add(circle);

        // Number label
        const label = this.scene.add.text(0, 0, String(index + 1), {
            fontSize: "14px",
            fontStyle: "bold",
            color: "#166534",
        });
        label.setOrigin(0.5, 0.5);
        container.add(label);

        // Delete button (X) - positioned at top-right
        const deleteButton = this.scene.add.arc(WAYPOINT_RADIUS, -WAYPOINT_RADIUS, 10, 0, 360, false, 0xef4444, 1);
        deleteButton.setStrokeStyle(2, 0xffffff);
        deleteButton.setVisible(false);
        deleteButton.setInteractive({ cursor: "pointer" });
        container.add(deleteButton);

        // Delete button X
        const deleteX = this.scene.add.text(WAYPOINT_RADIUS, -WAYPOINT_RADIUS, "×", {
            fontSize: "14px",
            fontStyle: "bold",
            color: "#ffffff",
        });
        deleteX.setOrigin(0.5, 0.5);
        container.add(deleteX);

        // Set size for interaction
        container.setSize(WAYPOINT_RADIUS * 2, WAYPOINT_RADIUS * 2);
        container.setData("waypointIndex", index);

        // Setup events
        if (this.isEditing) {
            container.setInteractive({ cursor: "grab", draggable: true });
            deleteButton.setVisible(true);
        }

        // Delete button click
        deleteButton.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.removeWaypoint(index);
        });

        // Hover effects
        container.on(Phaser.Input.Events.POINTER_OVER, () => {
            circle.setRadius(WAYPOINT_HOVER_RADIUS);
        });

        container.on(Phaser.Input.Events.POINTER_OUT, () => {
            if (!this.isDragging) {
                circle.setRadius(this.selectedIndex === index ? WAYPOINT_HOVER_RADIUS : WAYPOINT_RADIUS);
            }
        });

        // Selection
        container.on(Phaser.Input.Events.POINTER_DOWN, () => {
            this.selectWaypoint(index);
        });

        // Drag
        container.on(Phaser.Input.Events.DRAG_START, () => {
            this.isDragging = true;
            this.selectWaypoint(index);
            circle.setRadius(WAYPOINT_HOVER_RADIUS);
        });

        container.on(Phaser.Input.Events.DRAG, (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            let newX = dragX;
            let newY = dragY;

            if (this.shiftKey?.isDown) {
                newX = Math.round(newX / 32) * 32;
                newY = Math.round(newY / 32) * 32;
            }

            container.setPosition(newX, newY);
            this.waypoints[index] = { x: newX, y: newY };
            this.draw();
        });

        container.on(Phaser.Input.Events.DRAG_END, () => {
            this.isDragging = false;
            const currentIndex = container.getData("waypointIndex") as number;
            this.emit(
                WaypointPathEvent.WaypointMoved,
                currentIndex,
                this.waypoints[currentIndex].x,
                this.waypoints[currentIndex].y
            );
        });

        return { container, circle, label, deleteButton };
    }

    /**
     * Create the "+" button to add waypoints
     */
    private createAddButton(): void {
        // Position after the last waypoint or at center if no waypoints
        let x = 0;
        let y = 0;

        if (this.waypoints.length > 0) {
            const last = this.waypoints[this.waypoints.length - 1];
            x = last.x + 64;
            y = last.y;
        }

        const container = this.scene.add.container(x, y);

        // Circle background
        const circle = this.scene.add.arc(0, 0, 20, 0, 360, false, 0x22c55e, 1);
        circle.setStrokeStyle(3, 0x166534);
        container.add(circle);

        // Plus sign
        const plus = this.scene.add.text(0, 0, "+", {
            fontSize: "24px",
            fontStyle: "bold",
            color: "#ffffff",
        });
        plus.setOrigin(0.5, 0.5);
        container.add(plus);

        // Label
        const label = this.scene.add.text(0, 32, "Add Point", {
            fontSize: "11px",
            color: "#ffffff",
            backgroundColor: "#00000088",
            padding: { x: 4, y: 2 },
        });
        label.setOrigin(0.5, 0);
        container.add(label);

        container.setSize(40, 40);
        container.setInteractive({ cursor: "pointer" });
        container.setVisible(this.isEditing);

        // Hover effect
        container.on(Phaser.Input.Events.POINTER_OVER, () => {
            circle.setFillStyle(0x4ade80, 1);
        });

        container.on(Phaser.Input.Events.POINTER_OUT, () => {
            circle.setFillStyle(0x22c55e, 1);
        });

        // Click to add waypoint
        container.on(Phaser.Input.Events.POINTER_DOWN, () => {
            this.addWaypoint(x, y);
        });

        this.addButton = container;
        this.add(container);
    }

    /**
     * Update instruction text
     */
    private updateInstructions(): void {
        if (this.instructionText) {
            this.instructionText.destroy();
            this.instructionText = null;
        }

        if (this.isEditing && this.waypoints.length === 0) {
            this.instructionText = this.scene.add.text(0, -40, "Click + to add patrol points", {
                fontSize: "14px",
                color: "#ffffff",
                backgroundColor: "#22c55ecc",
                padding: { x: 8, y: 4 },
            });
            this.instructionText.setOrigin(0.5, 1);
            this.add(this.instructionText);
        }
    }

    /**
     * Draw the path lines and arrows
     */
    private draw(): void {
        this.pathGraphics.clear();

        // Update marker positions and visuals
        this.markers.forEach((marker, index) => {
            if (index < this.waypoints.length) {
                marker.container.setPosition(this.waypoints[index].x, this.waypoints[index].y);
                marker.label.setText(String(index + 1));

                // Update selection visual
                if (this.selectedIndex === index) {
                    marker.circle.setRadius(WAYPOINT_HOVER_RADIUS);
                    marker.circle.setStrokeStyle(4, PATH_HOVER_COLOR);
                } else {
                    marker.circle.setRadius(WAYPOINT_RADIUS);
                    marker.circle.setStrokeStyle(3, WAYPOINT_STROKE);
                }
            }
        });

        // Update add button position
        if (this.addButton && this.waypoints.length > 0) {
            const last = this.waypoints[this.waypoints.length - 1];
            this.addButton.setPosition(last.x + 64, last.y);
        }

        // Don't draw lines if less than 2 waypoints
        if (this.waypoints.length < 2) return;

        // Draw path lines
        const lineColor = this.isEditing ? PATH_HOVER_COLOR : PATH_COLOR;
        this.pathGraphics.lineStyle(PATH_LINE_WIDTH, lineColor, 0.8);

        for (let i = 0; i < this.waypoints.length - 1; i++) {
            const start = this.waypoints[i];
            const end = this.waypoints[i + 1];

            this.pathGraphics.lineBetween(start.x, start.y, end.x, end.y);
            this.drawArrow(start, end, lineColor);
        }

        // Close the loop (last to first)
        if (this.waypoints.length > 2) {
            const start = this.waypoints[this.waypoints.length - 1];
            const end = this.waypoints[0];

            // Dashed line for return path
            this.pathGraphics.lineStyle(PATH_LINE_WIDTH, lineColor, 0.4);
            this.pathGraphics.lineBetween(start.x, start.y, end.x, end.y);
            this.drawArrow(start, end, lineColor, 0.4);
        }
    }

    /**
     * Draw directional arrow
     */
    private drawArrow(start: Waypoint, end: Waypoint, color: number, alpha: number = 0.8): void {
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const angle = Math.atan2(end.y - start.y, end.x - start.x);

        const p1x = midX - ARROW_SIZE * Math.cos(angle - Math.PI / 6);
        const p1y = midY - ARROW_SIZE * Math.sin(angle - Math.PI / 6);
        const p2x = midX - ARROW_SIZE * Math.cos(angle + Math.PI / 6);
        const p2y = midY - ARROW_SIZE * Math.sin(angle + Math.PI / 6);

        this.pathGraphics.fillStyle(color, alpha);
        this.pathGraphics.beginPath();
        this.pathGraphics.moveTo(midX, midY);
        this.pathGraphics.lineTo(p1x, p1y);
        this.pathGraphics.lineTo(p2x, p2y);
        this.pathGraphics.closePath();
        this.pathGraphics.fillPath();
    }

    /**
     * Handle click on path to insert waypoint
     */
    public handlePathClick(x: number, y: number): void {
        // For now, just add at the end if in editing mode
        if (this.isEditing) {
            this.addWaypoint(x, y);
        }
    }

    /**
     * Set visibility
     */
    public setVisible(visible: boolean): this {
        super.setVisible(visible);
        this.markers.forEach((m) => m.container.setVisible(visible));
        if (this.addButton) {
            this.addButton.setVisible(visible && this.isEditing);
        }
        return this;
    }

    /**
     * Destroy
     */
    public destroy(fromScene?: boolean): void {
        this.pathGraphics.destroy();
        this.markers.forEach((m) => m.container.destroy());
        this.addButton?.destroy();
        this.instructionText?.destroy();
        super.destroy(fromScene);
    }
}
