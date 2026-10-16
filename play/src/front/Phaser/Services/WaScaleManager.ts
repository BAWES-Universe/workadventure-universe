import { coWebsiteManager } from "../../Stores/CoWebsiteStore";
import { HtmlUtils } from "../../WebRtc/HtmlUtils";
import type { Game } from "../Game/Game";
import { ResizableScene } from "../Login/ResizableScene";
import { HdpiManager } from "./HdpiManager";
import ScaleManager = Phaser.Scale.ScaleManager;

export enum WaScaleManagerEvent {
    RefreshFocusOnTarget = "wa-scale-manager:refresh-focus-on-target",
}

/** Phaser.Scale.Events.RESIZE, spelled out so this file does not need the Phaser global to be loaded. */
const PHASER_RESIZE_EVENT = "resize";

export type WaScaleManagerFocusTarget = { x: number; y: number; width?: number; height?: number };

export class WaScaleManager {
    private hdpiManager: HdpiManager;
    private scaleManager: ScaleManager | undefined;
    private game!: Game;
    private actualZoom = 1;
    private _saveZoom = 1;
    private zoomCamera?: Phaser.Cameras.Scene2D.Camera;
    /**
     * The CSS scale the DOM layer needs while the zoom goes through the camera, undefined otherwise (Phaser's own
     * value is right then). See applyDomContainerScale().
     */
    private domContainerScale: { x: number; y: number } | undefined;
    private readonly onPhaserResize = (): void => this.applyDomContainerScale();

    private focusTarget?: WaScaleManagerFocusTarget;

    public constructor(private minGamePixelsNumber: number, private absoluteMinPixelNumber: number) {
        this.hdpiManager = new HdpiManager(minGamePixelsNumber, absoluteMinPixelNumber);
    }

    public setGame(game: Game): void {
        this.scaleManager?.off(PHASER_RESIZE_EVENT, this.onPhaserResize);
        this.scaleManager = game.scale;
        // Phaser sets the DOM layer's scale again each time it refreshes: put ours back right after.
        this.scaleManager.on(PHASER_RESIZE_EVENT, this.onPhaserResize);
        this.game = game;
        this.zoomCamera = undefined;
    }

    public applyNewSize(camera?: Phaser.Cameras.Scene2D.Camera) {
        if (this.scaleManager === undefined) {
            return;
        }
        // Resizes and focus refreshes do not pass a camera. Reuse the one whose zoom we manage,
        // but only while it still belongs to an active scene, leaving other scene cameras alone.
        if (camera) {
            this.zoomCamera = camera;
        } else if (this.zoomCamera) {
            const zoomCamera = this.zoomCamera;
            if (
                this.game.scene
                    .getScenes(true)
                    .some((scene) => scene === zoomCamera.scene && scene.cameras.cameras.includes(zoomCamera))
            ) {
                camera = zoomCamera;
            } else {
                this.zoomCamera = undefined;
            }
        }
        const { width, height } = coWebsiteManager.getGameSize();
        const devicePixelRatio = window.devicePixelRatio ?? 1;
        const { game: gameSize, real: realSize } = this.hdpiManager.getOptimalGameSize({
            width: width * devicePixelRatio,
            height: height * devicePixelRatio,
        });

        if (realSize.width !== 0 && gameSize.width !== 0 && devicePixelRatio !== 0) {
            this.actualZoom = realSize.width / gameSize.width / devicePixelRatio;
        }

        // The performance shows us that resizing the game size outside its real size causes many lags and bad game performance.
        //      So we apply this condition: if the game size is greater than the real size, we don't zoom through the canvas.
        //      To zoom in and out, we use the camera. This is used in the Explorer mode. The zoom is calculated using the optimal zoom level.
        if (gameSize.width <= realSize.width && gameSize.height <= realSize.height) {
            this.scaleManager.resize(gameSize.width, gameSize.height);
            this.scaleManager.setZoom(this.actualZoom);
            camera?.setZoom(1);
            this.domContainerScale = undefined;
        } else {
            if (this.scaleManager.width !== realSize.width || this.scaleManager.height !== realSize.height) {
                this.scaleManager.resize(realSize.width, realSize.height);
            }

            const zoom =
                this.hdpiManager.zoomModifier * this.hdpiManager.getOptimalZoomLevel(realSize.width * realSize.height);
            this.scaleManager.setZoom(this.actualZoom);
            camera?.setZoom(zoom);
            // The canvas is not scaled in this mode (the camera zooms), so neither is the DOM layer. Phaser would
            // scale it down by the camera zoom, as its own zoom is set to `actualZoom`.
            this.domContainerScale = {
                x: realSize.width !== 0 ? Math.ceil(realSize.width / devicePixelRatio) / realSize.width : 1,
                y: realSize.height !== 0 ? Math.ceil(realSize.height / devicePixelRatio) / realSize.height : 1,
            };
        }

        // Override bug in canvas resizing in Phaser. Let's resize the canvas ourselves
        const style = this.scaleManager.canvas.style;
        style.width = Math.ceil(realSize.width !== 0 ? realSize.width / devicePixelRatio : 0) + "px";
        style.height = Math.ceil(realSize.height !== 0 ? realSize.height / devicePixelRatio : 0) + "px";

        // Resize the game element at the same size at the canvas
        const gameStyle = HtmlUtils.getElementByIdOrFail<HTMLDivElement>("game").style;
        gameStyle.width = style.width;
        gameStyle.height = style.height;

        // Resize the game element at the same size at the canvas
        // By default, the scaleManager.resize() method will change the take the zoom into account in the displaySize.
        // This is not what we want, we want the displaySize to be the real size of the game.
        this.scaleManager.displaySize.width = realSize.width;
        this.scaleManager.displaySize.height = realSize.height;
        this.scaleManager.refresh(realSize.width, realSize.height);

        // Resize the game element at the same size at the canvas
        // By default, the scaleManager.resize() method will change the take the zoom into account in the displaySize.
        // This is not what we want, we want the displaySize to be the real size of the game.
        this.scaleManager.displaySize.width = realSize.width;
        this.scaleManager.displaySize.height = realSize.height;
        this.scaleManager.refresh(realSize.width, realSize.height);
        this.applyDomContainerScale();

        // Note: onResize will be called twice (once here and once in Game.ts), but we have no better way.
        for (const scene of this.game.scene.getScenes(true)) {
            if (scene instanceof ResizableScene) {
                // We are delaying the call to the "render" event because otherwise, the "camera" coordinates are not correctly updated.
                scene.events.once(Phaser.Scenes.Events.RENDER, () => scene.onResize());
            }
        }

        this.game.markDirty();
    }

    /**
     * Phaser scales the DOM layer (the player names, speech bubbles, embedded websites) by `displaySize / baseSize`,
     * which `refresh()` computes again from its own zoom. That is right when the canvas is scaled, but not when
     * the zoom goes through the camera: the layer then ends up scaled by the camera zoom and everything in it
     * lands closer to the top left of the screen than the map under it.
     */
    private applyDomContainerScale(): void {
        const domContainer = this.game?.domContainer;
        if (!domContainer || !this.domContainerScale) {
            return;
        }
        domContainer.style.transform = `scale(${this.domContainerScale.x}, ${this.domContainerScale.y})`;
    }

    /**
     * Use this in case of resizing while focusing on something
     */
    public refreshFocusOnTarget(camera?: Phaser.Cameras.Scene2D.Camera): void {
        if (!this.focusTarget) {
            return;
        }
        if (this.focusTarget.width && this.focusTarget.height) {
            this.setZoomModifier(
                this.getTargetZoomModifierFor(this.focusTarget.width, this.focusTarget.height),
                camera
            );
        }

        this.game.events.emit(WaScaleManagerEvent.RefreshFocusOnTarget, this.focusTarget);
    }

    public setFocusTarget(targetDimensions?: WaScaleManagerFocusTarget): void {
        this.focusTarget = targetDimensions;
    }

    public getTargetZoomModifierFor(viewportWidth: number, viewportHeight: number) {
        const { width: gameWidth, height: gameHeight } = coWebsiteManager.getGameSize();
        const devicePixelRatio = window.devicePixelRatio ?? this.hdpiManager.maxZoomOut;

        const { real: realSize } = this.hdpiManager.getOptimalGameSize({
            width: gameWidth * devicePixelRatio,
            height: gameHeight * devicePixelRatio,
        });
        const desiredZoom = Math.min(realSize.width / viewportWidth, realSize.height / viewportHeight);
        const realPixelNumber = gameWidth * devicePixelRatio * gameHeight * devicePixelRatio;
        return desiredZoom / (this.hdpiManager.getOptimalZoomLevel(realPixelNumber) || 1);
    }

    public get zoomModifier(): number {
        return this.hdpiManager.zoomModifier;
    }

    public set zoomModifier(zoomModifier: number) {
        let camera = undefined;
        // Let's attempt to get the camera
        for (const scene of this.game.scene.getScenes(true)) {
            if (scene.cameras.main) {
                camera = scene.cameras.main;
            }
        }

        this.setZoomModifier(zoomModifier, camera);
    }

    public setZoomModifier(zoomModifier: number, camera?: Phaser.Cameras.Scene2D.Camera): void {
        this.hdpiManager.zoomModifier = zoomModifier;
        this.applyNewSize(camera);
    }

    public getFocusTarget(): WaScaleManagerFocusTarget | undefined {
        return this.focusTarget;
    }

    public saveZoom(): void {
        this._saveZoom = this.hdpiManager.zoomModifier;
    }

    public getSaveZoom(): number {
        return this._saveZoom;
    }

    public restoreZoom(): void {
        this.hdpiManager.zoomModifier = this._saveZoom;
        this.applyNewSize();
    }

    public getActualZoom(): number {
        return this.actualZoom;
    }

    /**
     * This is used to scale back the ui components to counter-act the zoom.
     */
    public get uiScalingFactor(): number {
        return this.actualZoom > 1 ? 1 : 1.2;
    }

    public set maxZoomOut(maxZoomOut: number) {
        this.hdpiManager.maxZoomOut = maxZoomOut;
    }
    public get maxZoomOut(): number {
        return this.hdpiManager.maxZoomOut;
    }
    public set zoomOutPastMapFit(zoomModifier: number | undefined) {
        this.hdpiManager.zoomOutPastMapFit = zoomModifier;
    }

    public get isMaximumZoomOutReached(): boolean {
        return this.hdpiManager.isMaximumZoomReached;
    }

    public get isMaximumZoomInReached(): boolean {
        return this.hdpiManager.isMaximumZoomInReached;
    }
}

export const waScaleManager = new WaScaleManager(640 * 480, 196 * 196);
