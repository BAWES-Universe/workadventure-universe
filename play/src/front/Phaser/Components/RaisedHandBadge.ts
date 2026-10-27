import type { UsernameDomLayerClient, UsernameDomLayerHost } from "../Game/UsernameDomLayer";

/** Height of the badge, in game pixels. */
export const RAISED_HAND_BADGE_HEIGHT = 13;

/**
 * The ✋ with the person's number in line, above their name on the map, while their hand is raised. It matches the
 * raise hand button while the hand is up: an ink pill with a gold edge and a gold number.
 *
 * It lives in the scene's UsernameDomLayer next to the name pill, so the browser draws it at the screen's own
 * resolution. Drawn into the game canvas it came out blurry: the canvas is drawn in game pixels and stretched to the
 * screen (#1441). Unlike the name, it simply follows the map's zoom, at RAISED_HAND_BADGE_HEIGHT game pixels.
 */
export class RaisedHandBadge implements UsernameDomLayerClient {
    private element: HTMLDivElement | undefined;
    private numberElement: HTMLSpanElement | undefined;
    /** The place in line shown, 0 while it isn't known yet, undefined while the hand is down. */
    private position: number | undefined;
    private x = 0;
    private y = 0;
    private depth = 0;
    private faded = false;
    private destroyed = false;

    constructor(private readonly layer: UsernameDomLayerHost) {}

    /** Shows the badge with this number in line (0 while the number isn't known yet), or hides it (undefined). */
    public showPlace(position: number | undefined): void {
        if (this.destroyed || position === this.position) {
            return;
        }
        this.position = position;
        if (position === undefined) {
            this.element?.classList.remove("is-shown");
            return;
        }
        const element = this.element ?? this.createElement();
        if (this.numberElement) {
            this.numberElement.textContent = position > 0 ? String(position) : "";
        }
        element.classList.add("is-shown");
        this.layer.requestStyles(this);
    }

    public isShown(): boolean {
        return this.position !== undefined;
    }

    /** The badge's centre, in game pixels. */
    public setPosition(x: number, y: number): void {
        if (x === this.x && y === this.y) {
            return;
        }
        this.x = x;
        this.y = y;
        if (this.element) {
            this.layer.requestTransform(this);
        }
    }

    public setPlayerDepth(depth: number): void {
        if (this.depth === depth) {
            return;
        }
        this.depth = depth;
        if (this.element) {
            this.element.style.zIndex = `${Math.round(depth)}`;
        }
    }

    /** Faded along with the player (see Character.setFaded). */
    public setFaded(faded: boolean): void {
        this.faded = faded;
        if (this.element) {
            this.element.style.opacity = faded ? "0.45" : "";
        }
    }

    /** Lays the badge out for the current zoom. Called by the layer when the zoom changes. */
    public applyStyles(): void {
        if (!this.element || this.destroyed) {
            return;
        }
        // Laid out at its full size on screen and brought back down by its own transform, as the name pill does: see
        // UsernameDisplay.getTransformScale, Safari keeps a magnified layer blurry.
        this.element.style.setProperty("--raised-hand-scale", (1 / this.getTransformScale()).toString());
        this.applyTransform();
    }

    /** Places the badge. Called by the layer once Phaser has applied its own transform. */
    public applyTransform(): void {
        if (!this.element || this.destroyed) {
            return;
        }
        const scale = this.getTransformScale();
        this.element.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) translate(-50%, -50%) scale(${scale})`;
    }

    public destroy(): void {
        this.destroyed = true;
        this.layer.unregister(this);
        this.element?.remove();
        this.element = undefined;
        this.numberElement = undefined;
    }

    private getTransformScale(): number {
        return Math.min(1 / this.layer.getAncestorScale(), 1);
    }

    /** Made the first time the hand goes up: most players never raise it. */
    private createElement(): HTMLDivElement {
        const icon = document.createElement("span");
        icon.className = "raised-hand-badge-icon";
        icon.textContent = "✋";

        this.numberElement = document.createElement("span");
        this.numberElement.className = "raised-hand-badge-number";

        this.element = document.createElement("div");
        this.element.setAttribute("aria-hidden", "true");
        this.element.className = "raised-hand-badge";
        this.element.append(icon, this.numberElement);
        this.element.style.zIndex = `${Math.round(this.depth)}`;
        if (this.faded) {
            this.element.style.opacity = "0.45";
        }

        this.layer.addUsername(this.element);
        this.layer.register(this);
        return this.element;
    }
}
