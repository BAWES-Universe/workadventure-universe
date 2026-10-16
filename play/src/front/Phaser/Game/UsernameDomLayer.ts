import { waScaleManager } from "../Services/WaScaleManager";
import type { GameScene } from "./GameScene";
import { DEPTH_INGAME_TEXT_INDEX } from "./DepthIndexes";

// Side of the square probe used to measure the ancestor scale. Large enough that sub-pixel rounding
// on the measured on-screen size is negligible.
const SCALE_PROBE_SIZE = 100;

/** What the layer asks of a name pill: lay itself out for the current scale, and place itself. */
export interface UsernameDomLayerClient {
    applyStyles(): void;
    applyTransform(): void;
}

/**
 * What a name pill asks of the layer that holds it. A small interface so the pill can be tested without Phaser.
 */
export interface UsernameDomLayerHost {
    addUsername(usernameDisplayElement: HTMLElement): void;
    register(client: UsernameDomLayerClient): void;
    unregister(client: UsernameDomLayerClient): void;
    /** Asks for `applyTransform()` at the next render, once Phaser has applied the layer's own transform. */
    requestTransform(client: UsernameDomLayerClient): void;
    /** Asks for `applyStyles()` (and the transform) at the next render. */
    requestStyles(client: UsernameDomLayerClient): void;
    getAncestorScale(): number;
    getZoomModifier(): number;
}

/**
 * One DOM layer in the scene that holds every player's name pill. Phaser scales the layer to follow the camera, so a
 * pill laid out in game pixels follows the map; the pill then cancels or adds to that scale (see UsernameDisplay) so
 * its size on screen follows its own rules.
 */
export class UsernameDomLayer implements UsernameDomLayerHost {
    private readonly container: HTMLDivElement;
    private readonly domElement: Phaser.GameObjects.DOMElement;
    // A hidden, fixed-size element living in the same container as the usernames. Phaser scales this
    // container to follow the camera, so the probe's measured on-screen width divided by its layout
    // width gives the exact scale the DOM layer applies on screen (`ancestorScale`). We measure it
    // rather than derive it from the zoom because the real value depends on the camera zoom AND the
    // device pixel ratio.
    private readonly scaleProbe: HTMLDivElement;
    private ancestorScale = 1;
    private ancestorScaleStale = true;
    private readonly clients = new Set<UsernameDomLayerClient>();
    private readonly stylesRequested = new Set<UsernameDomLayerClient>();
    private readonly transformRequested = new Set<UsernameDomLayerClient>();
    private lastZoomSignature = "";

    private readonly onRender = (): void => {
        const signature = this.getZoomSignature();
        if (signature !== this.lastZoomSignature) {
            // The zoom, the window or the pixel ratio changed: measure again and lay every pill out again.
            this.lastZoomSignature = signature;
            this.ancestorScaleStale = true;
            this.stylesRequested.clear();
            this.transformRequested.clear();
            for (const client of this.clients) {
                client.applyStyles();
            }
            return;
        }
        if (this.stylesRequested.size > 0) {
            // A pill that was just created or restyled measures against the real on-screen scale.
            this.ancestorScaleStale = true;
            for (const client of this.stylesRequested) {
                this.transformRequested.delete(client);
                client.applyStyles();
            }
            this.stylesRequested.clear();
        }
        for (const client of this.transformRequested) {
            client.applyTransform();
        }
        this.transformRequested.clear();
    };

    constructor(private readonly scene: GameScene) {
        this.container = document.createElement("div");
        this.container.style.position = "relative";
        this.container.style.pointerEvents = "none";
        this.container.style.overflow = "visible";

        this.scaleProbe = document.createElement("div");
        this.scaleProbe.style.position = "absolute";
        this.scaleProbe.style.top = "0";
        this.scaleProbe.style.left = "0";
        this.scaleProbe.style.width = `${SCALE_PROBE_SIZE}px`;
        this.scaleProbe.style.height = `${SCALE_PROBE_SIZE}px`;
        this.scaleProbe.style.visibility = "hidden";
        this.scaleProbe.style.pointerEvents = "none";
        this.container.appendChild(this.scaleProbe);

        this.domElement = scene.add.dom(0, 0, this.container).setOrigin(0, 0).setDepth(DEPTH_INGAME_TEXT_INDEX);
        this.domElement.pointerEvents = "none";

        scene.events.on(Phaser.Scenes.Events.RENDER, this.onRender);
    }

    public addUsername(usernameDisplayElement: HTMLElement): void {
        this.container.appendChild(usernameDisplayElement);
    }

    public register(client: UsernameDomLayerClient): void {
        this.clients.add(client);
    }

    public unregister(client: UsernameDomLayerClient): void {
        this.clients.delete(client);
        this.stylesRequested.delete(client);
        this.transformRequested.delete(client);
    }

    public requestTransform(client: UsernameDomLayerClient): void {
        this.transformRequested.add(client);
    }

    public requestStyles(client: UsernameDomLayerClient): void {
        this.stylesRequested.add(client);
    }

    public getZoomModifier(): number {
        return waScaleManager.zoomModifier;
    }

    /**
     * The scale the DOM layer currently applies to its children on screen, measured from the probe.
     * Measurement is lazy and cached: the (potentially layout-forcing) `getBoundingClientRect` runs
     * at most once per invalidation, shared by every username. Read it at render time, once Phaser
     * has applied the layer's transform for the current frame.
     */
    public getAncestorScale(): number {
        if (this.ancestorScaleStale) {
            const width = this.scaleProbe.getBoundingClientRect().width;
            // Guard against a 0 measurement (layer not laid out yet): keep the previous value and
            // stay stale so we measure again later.
            if (width > 0) {
                this.ancestorScale = width / SCALE_PROBE_SIZE;
                this.ancestorScaleStale = false;
            }
        }
        return this.ancestorScale;
    }

    /**
     * A still copy of the names as they are on screen now, placed as Phaser places them: an empty copy of the game's
     * DOM box holding a copy of this layer. Used for the picture of the room shown while the game gets back in (#958).
     */
    public copyForPicture(): HTMLElement | undefined {
        const node = this.domElement.node;
        const box = node.parentElement;
        if (!box) return undefined;
        const copy = box.cloneNode(false) as HTMLElement;
        copy.setAttribute("aria-hidden", "true");
        copy.appendChild(node.cloneNode(true));
        return copy;
    }

    public destroy(): void {
        this.scene.events.off(Phaser.Scenes.Events.RENDER, this.onRender);
        this.clients.clear();
        this.stylesRequested.clear();
        this.transformRequested.clear();
        this.domElement.destroy();
    }

    private getZoomSignature(): string {
        const camera = this.scene.cameras.main;
        const scale = this.scene.scale;
        return [
            waScaleManager.zoomModifier,
            camera?.zoom,
            scale.zoom,
            scale.width,
            scale.height,
            scale.displaySize.width,
            window.devicePixelRatio,
        ].join("|");
    }
}
