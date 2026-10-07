import { GameScene } from "../../Game/GameScene";
import { screenSpace } from "../../Game/MapEditor/ScreenSpace";

export enum SizeAlteringSquarePosition {
    TopLeft = 0,
    TopCenter,
    TopRight,
    LeftCenter,
    RightCenter,
    BottomLeft,
    BottomCenter,
    BottomRight,
    GameScene,
}

export enum SizeAlteringSquareEvent {
    Selected = "SizeAlteringSquare:Selected",
    Released = "SizeAlteringSquare:Released",
}

export class SizeAlteringSquare extends Phaser.GameObjects.Rectangle {
    private selected: boolean;
    /** Drawn by the page instead (see AreaPreview.useMapFrame): the square only catches the pointer. */
    private caughtOnly = false;

    /** Fingers need a bigger handle than a mouse: on a touch screen the handles are big white dots with a violet ring. */
    private static readonly SIZE = window.matchMedia?.("(pointer: coarse)").matches ? 22 : 9;
    /** With a mouse, the handle catches the pointer a little around it, so it is easy to land on. */
    private static readonly HIT_SIZE = Math.max(SizeAlteringSquare.SIZE, 20);
    /**
     * When the page draws the dot (28 CSS pixels with its ring, see AreaFrames.svelte), the square catches the pointer
     * over all of it and a little around, whatever the zoom: a world-sized square shrinks under the dot when zoomed out,
     * and the pointer then falls on the area (the move hand) or the map (the + for drawing).
     */
    private static readonly DRAWN_CATCH_PX = 36;

    constructor(scene: Phaser.Scene, pos: { x: number; y: number }, private cursor: string) {
        super(scene, pos.x, pos.y, SizeAlteringSquare.SIZE, SizeAlteringSquare.SIZE, 0xffffff);

        this.selected = false;

        if (SizeAlteringSquare.SIZE > 9) {
            this.setStrokeStyle(3, 0x8b5cf6);
        } else {
            this.setStrokeStyle(1, 0x000000);
        }
        const pad = (SizeAlteringSquare.HIT_SIZE - SizeAlteringSquare.SIZE) / 2;
        this.setInteractive({
            hitArea: new Phaser.Geom.Rectangle(-pad, -pad, SizeAlteringSquare.HIT_SIZE, SizeAlteringSquare.HIT_SIZE),
            hitAreaCallback: (area: Phaser.Geom.Rectangle, x: number, y: number) => {
                if (!this.caughtOnly) return Phaser.Geom.Rectangle.Contains(area, x, y);
                const half = Math.max(
                    SizeAlteringSquare.HIT_SIZE / 2,
                    SizeAlteringSquare.DRAWN_CATCH_PX / 2 / screenSpace(this.scene).scale
                );
                return (
                    Math.abs(x - SizeAlteringSquare.SIZE / 2) <= half &&
                    Math.abs(y - SizeAlteringSquare.SIZE / 2) <= half
                );
            },
            cursor,
        });
        this.scene.input.setDraggable(this);

        this.bindEventHandlers();

        this.scene.add.existing(this);
    }

    public catchOnly(): void {
        this.caughtOnly = true;
        this.setFillStyle(0xffffff, 0);
        this.setStrokeStyle(0, 0, 0);
    }

    public update(time: number, dt: number): void {
        // NOTE: We use update instead of PointerMove to not loose focus when moving too fast with pointer
    }

    private select(value: boolean): void {
        if (this.selected === value) {
            return;
        }
        this.selected = value;
        this.setFillStyle(value ? 0x000000 : 0xffffff, this.caughtOnly ? 0 : 1);
        if (this.scene instanceof GameScene) {
            this.scene.markDirty();
        } else {
            throw new Error("Not the Game Scene");
        }
    }

    private bindEventHandlers(): void {
        this.scene.input.on(Phaser.Input.Events.POINTER_UP, () => {
            if (this.selected) {
                this.select(false);
                this.emit(SizeAlteringSquareEvent.Released);
            }
        });

        this.on(Phaser.Input.Events.POINTER_DOWN, () => {
            this.select(true);
            this.emit(SizeAlteringSquareEvent.Selected);
        });
    }

    public isSelected(): boolean {
        return this.selected;
    }
}
