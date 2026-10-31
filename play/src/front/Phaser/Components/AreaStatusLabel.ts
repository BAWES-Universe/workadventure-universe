import type { UsernameDomLayerClient, UsernameDomLayerHost } from "../Game/UsernameDomLayer";
import { getDisplayScale } from "./UsernameDisplayMetrics";
import {
    PLAYER_NAME_GAP,
    PLAYER_NAME_HEIGHT,
    PLAYER_NAME_PADDING_LEFT,
    PLAYER_NAME_PADDING_RIGHT,
} from "./UsernameDisplaySizes";

// The icons of the editor's Max people and Lockable room settings.
const LOCK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const PEOPLE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></svg>';

/**
 * The pill at the top of a room that says it is full ("Full · 3/3", #1621) or locked (red, "Locked", #1622). It is
 * drawn like a player's name pill, in the same DOM layer, so it follows the map and keeps the same size on screen at
 * every zoom.
 */
export class AreaStatusLabel implements UsernameDomLayerClient {
    private readonly element: HTMLDivElement;
    private readonly textElement: HTMLSpanElement;
    private readonly iconElement: HTMLSpanElement;
    private kind: "full" | "locked" | undefined;
    private displayScale = 1;
    private destroyed = false;

    constructor(
        private readonly layer: UsernameDomLayerHost,
        private x: number,
        private y: number,
        text: string,
        kind: "full" | "locked" = "full"
    ) {
        const icon = document.createElement("span");
        icon.className = "area-status-label-icon";
        this.iconElement = icon;

        this.textElement = document.createElement("span");
        this.textElement.className = "username-display-name";
        this.textElement.textContent = text;

        this.element = document.createElement("div");
        this.element.className = "username-display area-status-label";
        this.element.dataset.testid = "area-status-label";
        this.element.append(icon, this.textElement);
        this.setKind(kind);

        this.layer.addUsername(this.element);
        this.layer.register(this);
        this.applyStyles();
        this.layer.requestStyles(this);
    }

    public setText(text: string, kind: "full" | "locked" = this.kind ?? "full"): void {
        this.textElement.textContent = text;
        this.setKind(kind);
    }

    private setKind(kind: "full" | "locked"): void {
        if (this.kind === kind) {
            return;
        }
        this.kind = kind;
        this.iconElement.innerHTML = kind === "locked" ? LOCK_ICON : PEOPLE_ICON;
        this.element.classList.toggle("is-locked", kind === "locked");
    }

    public setPosition(x: number, y: number): void {
        if (x === this.x && y === this.y) {
            return;
        }
        this.x = x;
        this.y = y;
        this.layer.requestTransform(this);
    }

    public destroy(): void {
        this.destroyed = true;
        this.layer.unregister(this);
        this.element.remove();
    }

    public applyStyles(): void {
        if (this.destroyed) {
            return;
        }
        const ancestorScale = this.layer.getAncestorScale();
        this.displayScale = getDisplayScale(this.layer.getZoomModifier(), ancestorScale);
        const domScale = this.displayScale / this.getTransformScale();
        this.element.style.setProperty("--username-dom-scale", domScale.toString());
        this.element.style.height = `${PLAYER_NAME_HEIGHT * domScale}px`;
        this.element.style.gap = `${PLAYER_NAME_GAP * domScale}px`;
        this.element.style.padding = `0 ${PLAYER_NAME_PADDING_RIGHT * domScale}px 0 ${
            PLAYER_NAME_PADDING_LEFT * domScale
        }px`;
        this.applyTransform();
    }

    public applyTransform(): void {
        if (this.destroyed) {
            return;
        }
        const scale = this.getTransformScale();
        // Centred on the given point, just inside the room's top edge.
        this.element.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) translate(-50%, 0) scale(${scale})`;
    }

    /** Same as UsernameDisplay: keeps the element's own transform a minification, so Safari draws it sharp. */
    private getTransformScale(): number {
        return Math.min(1 / this.layer.getAncestorScale(), 1);
    }
}
