import { GameScene } from "../../Game/GameScene";

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

    /** Fingers need a bigger handle than a mouse: on a touch screen the handles are big white dots with a violet ring. */
    private static readonly SIZE = window.matchMedia?.("(pointer: coarse)").matches ? 22 : 9;
    /** With a mouse, the handle catches the pointer a little around it, so it is easy to land on. */
    private static readonly HIT_SIZE = Math.max(SizeAlteringSquare.SIZE, 20);

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
            hitAreaCallback: (area: Phaser.Geom.Rectangle, x: number, y: number) =>
                Phaser.Geom.Rectangle.Contains(area, x, y),
            cursor,
        });
        this.scene.input.setDraggable(this);

        this.bindEventHandlers();

        this.scene.add.existing(this);
    }

    public update(time: number, dt: number): void {
        // NOTE: We use update instead of PointerMove to not loose focus when moving too fast with pointer
    }

    private select(value: boolean): void {
        if (this.selected === value) {
            return;
        }
        this.selected = value;
        this.setFillStyle(value ? 0x000000 : 0xffffff);
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
