import Phaser from "phaser";

// Universe colours: numbered violet stops with a white edge, joined by a dashed lavender line
const WAYPOINT_RADIUS = 14;
const WAYPOINT_HOVER_RADIUS = 17;
const PATH_LINE_WIDTH = 3;
const PATH_COLOR = 0xc4b5fd;
const PATH_HOVER_COLOR = 0xddd6fe;
const WAYPOINT_FILL = 0x6d3ff8;
const WAYPOINT_STROKE = 0xffffff;
const WAYPOINT_LABEL = "#ffffff";
const ARROW_SIZE = 10;
const DASH = 10;
const GAP = 7;
const WAYPOINT_DEPTH = 100002; // just above the bots (BotPreview's depth)
// The × that removes a stop, on its top-right like before the redesign: red, with a white edge
const REMOVE_RADIUS = 11;
const REMOVE_HIT_RADIUS = 14; // a little larger than it looks, so it is easy to hit with a finger
const REMOVE_OFFSET = 20;
const REMOVE_FILL = 0xef4444;

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
    removeButton?: Phaser.GameObjects.Container;
}

/**
 * WaypointPath - Visual patrol route editor
 *
 * Features:
 * - Large, easy to grab waypoint markers
 * - Drag markers to reposition
 * - The × on a marker removes it (Undo in the route bar puts it back). Stop 1 has none: the bot starts there
 * - Directional arrows showing patrol direction
 * - A loop draws the way back from the last stop to the first
 */
export class WaypointPath extends Phaser.GameObjects.Container {
    private waypoints: Waypoint[];
    private pathGraphics: Phaser.GameObjects.Graphics;
    private markers: WaypointMarker[] = [];
    private selectedIndex: number = -1;
    private isEditing: boolean = false;
    private isDragging: boolean = false;
    private loop = true;

    private shiftKey?: Phaser.Input.Keyboard.Key;

    // Constraint boundary (waypoints must stay within this)
    private constraintCenter: { x: number; y: number } = { x: 0, y: 0 };
    private constraintRadius: number = 0;

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

    /** Whether the route loops (draws the way back from the last stop to the first) or goes back and forth. */
    public setLoop(loop: boolean): void {
        if (this.loop === loop) return;
        this.loop = loop;
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

        // Update marker interactivity; the × only shows while editing
        this.markers.forEach((marker) => {
            if (editing) {
                marker.container.setInteractive({ cursor: "grab", draggable: true });
            } else {
                marker.container.disableInteractive();
            }
            marker.removeButton?.setVisible(editing);
            if (editing) {
                marker.removeButton?.setInteractive();
            } else {
                marker.removeButton?.disableInteractive();
            }
        });

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
     * Set constraint boundary (waypoints must stay within this circle)
     */
    public setConstraint(center: { x: number; y: number }, radius: number): void {
        const centerChanged = this.constraintCenter.x !== center.x || this.constraintCenter.y !== center.y;
        this.constraintCenter = center;
        this.constraintRadius = radius;

        // Rebuild if center changed to reposition the + button
        if (centerChanged && this.waypoints.length === 0) {
            this.rebuildMarkers();
        }
    }

    /**
     * Constrain a position to stay within the boundary
     */
    private constrainPosition(x: number, y: number): { x: number; y: number } {
        if (this.constraintRadius <= 0) {
            return { x, y };
        }

        const dx = x - this.constraintCenter.x;
        const dy = y - this.constraintCenter.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If within bounds, return as-is
        if (distance <= this.constraintRadius) {
            return { x, y };
        }

        // Constrain to edge of circle (with small buffer to keep inside)
        const buffer = 8;
        const constrainedRadius = this.constraintRadius - buffer;
        const scale = constrainedRadius / distance;
        return {
            x: this.constraintCenter.x + dx * scale,
            y: this.constraintCenter.y + dy * scale,
        };
    }

    /**
     * Add a waypoint at position (constrained to boundary)
     */
    public addWaypoint(x: number, y: number, index?: number): void {
        const constrained = this.constrainPosition(x, y);
        const newWaypoint = { x: constrained.x, y: constrained.y };

        if (index !== undefined && index >= 0 && index <= this.waypoints.length) {
            this.waypoints.splice(index, 0, newWaypoint);
        } else {
            this.waypoints.push(newWaypoint);
        }

        this.rebuildMarkers();
        this.draw();
        this.emit(WaypointPathEvent.WaypointAdded, this.waypoints.length - 1, constrained.x, constrained.y);
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

        // Create markers
        this.waypoints.forEach((wp, index) => {
            const marker = this.createMarker(wp, index);
            this.markers.push(marker);
            this.add(marker.container);
        });
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
            fontSize: "13px",
            fontStyle: "bold",
            color: WAYPOINT_LABEL,
        });
        label.setOrigin(0.5, 0.5);
        container.add(label);

        // Set size for interaction (a little larger than the circle, so it is easy to grab on a phone)
        container.setSize(WAYPOINT_HOVER_RADIUS * 2 + 8, WAYPOINT_HOVER_RADIUS * 2 + 8);
        container.setData("waypointIndex", index);

        // Setup events
        if (this.isEditing) {
            container.setInteractive({ cursor: "grab", draggable: true });
        }

        // The × removes the stop. Stop 1 has none: it is where the bot starts (and moves with the bot).
        let removeButton: Phaser.GameObjects.Container | undefined;
        if (index > 0) {
            removeButton = this.createRemoveButton(container);
        }

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

            // Constrain to boundary
            const constrained = this.constrainPosition(newX, newY);
            newX = constrained.x;
            newY = constrained.y;

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

        return { container, circle, label, removeButton };
    }

    /** The red × at a stop's top-right corner. A press on it removes the stop and does not start a drag. */
    private createRemoveButton(marker: Phaser.GameObjects.Container): Phaser.GameObjects.Container {
        const button = this.scene.add.container(REMOVE_OFFSET, -REMOVE_OFFSET);
        const disc = this.scene.add.arc(0, 0, REMOVE_RADIUS, 0, 360, false, REMOVE_FILL, 1);
        disc.setStrokeStyle(2, 0xffffff);
        const cross = this.scene.add.text(0, 0, "×", { fontSize: "16px", fontStyle: "bold", color: "#ffffff" });
        cross.setOrigin(0.5, 0.55);
        button.add([disc, cross]);
        button.setData("isDeleteButton", true); // BotEditorTool must not add a stop for this press
        button.setInteractive({
            hitArea: new Phaser.Geom.Circle(0, 0, REMOVE_HIT_RADIUS),
            hitAreaCallback: Phaser.Geom.Circle.Contains, //eslint-disable-line @typescript-eslint/unbound-method
            cursor: "pointer",
        });
        button.setVisible(this.isEditing);
        if (!this.isEditing) {
            button.disableInteractive();
        }
        button.on(
            Phaser.Input.Events.POINTER_DOWN,
            (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
                event.stopPropagation();
                const currentIndex = marker.getData("waypointIndex") as number;
                // After this event: removing rebuilds the markers, including this one
                setTimeout(() => this.removeWaypoint(currentIndex), 0);
            }
        );
        marker.add(button);
        return button;
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

        // Don't draw lines if less than 2 waypoints
        if (this.waypoints.length < 2) return;

        // Draw path lines
        const lineColor = this.isEditing ? PATH_HOVER_COLOR : PATH_COLOR;
        this.pathGraphics.lineStyle(PATH_LINE_WIDTH, lineColor, 0.85);

        for (let i = 0; i < this.waypoints.length - 1; i++) {
            const start = this.waypoints[i];
            const end = this.waypoints[i + 1];

            this.dashedLine(start, end);
            this.drawArrow(start, end, lineColor);
        }

        // Close the loop (last to first), fainter: back and forth routes turn round at the last stop instead
        if (this.loop && this.waypoints.length > 2) {
            const start = this.waypoints[this.waypoints.length - 1];
            const end = this.waypoints[0];

            this.pathGraphics.lineStyle(PATH_LINE_WIDTH, lineColor, 0.45);
            this.dashedLine(start, end);
            this.drawArrow(start, end, lineColor, 0.45);
        }
    }

    /** A dashed segment, in the current line style. */
    private dashedLine(start: Waypoint, end: Waypoint): void {
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length === 0) return;
        const ux = (end.x - start.x) / length;
        const uy = (end.y - start.y) / length;
        for (let d = 0; d < length; d += DASH + GAP) {
            const to = Math.min(length, d + DASH);
            this.pathGraphics.lineBetween(start.x + ux * d, start.y + uy * d, start.x + ux * to, start.y + uy * to);
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
        return this;
    }

    /**
     * Destroy
     */
    public destroy(fromScene?: boolean): void {
        this.pathGraphics.destroy();
        this.markers.forEach((m) => m.container.destroy());
        super.destroy(fromScene);
    }
}
