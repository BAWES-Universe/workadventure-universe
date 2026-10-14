import type { AvailabilityStatus } from "@workadventure/messages";
import type { UsernameDomLayerClient, UsernameDomLayerHost } from "../Game/UsernameDomLayer";
import { getDisplayScale, getShownName } from "./UsernameDisplayMetrics";
import {
    PLAYER_NAME_FONT_SIZE,
    PLAYER_NAME_GAP,
    PLAYER_NAME_HEIGHT,
    PLAYER_NAME_PADDING_LEFT,
    PLAYER_NAME_PADDING_RIGHT,
    STATUS_DOT_BORDER_WIDTH,
    TALK_BUBBLE_HEIGHT,
} from "./UsernameDisplaySizes";
import { UsernameMegaphoneDisplay } from "./UsernameMegaphoneDisplay";
import { UsernameStatusDisplay } from "./UsernameStatusDisplay";
import { UsernameTalkBubble } from "./UsernameTalkBubble";

/** Space kept between the pill and the bubble above it: at least 3 screen pixels or 2 game pixels, plus .3f. */
const BUBBLE_GAP_MIN_SCREEN_PX = 3;
const BUBBLE_GAP_MIN_GAME_PX = 2;
const BUBBLE_GAP_EXTRA = PLAYER_NAME_FONT_SIZE * 0.3;

/**
 * The player name over a Woka: a round pill with the status dot, the name, and (while the player speaks to everyone)
 * a megaphone. It lives in the scene's UsernameDomLayer, in game pixels, and sizes itself so the name stays readable:
 * it stops shrinking when zoomed far out and stops growing past 13 px on screen when zoomed in.
 *
 * - Highlighted (the pointer is over the player, or the player walked up to them): lighter pill,
 *   in front of the other names, and the full name.
 * - Talking: a white bubble with three waving dots sits just above the pill.
 */
export class UsernameDisplay implements UsernameDomLayerClient {
    private readonly element: HTMLDivElement;
    private readonly nameElement: HTMLSpanElement;
    private readonly statusDisplay = new UsernameStatusDisplay();
    private readonly megaphoneDisplay = new UsernameMegaphoneDisplay();
    private readonly talkBubble = new UsernameTalkBubble();
    private displayScale = 1;
    private x: number;
    private y: number;
    private depth = 0;
    private highlighted = false;
    private customColor: number | undefined;
    private destroyed = false;

    constructor(
        private readonly layer: UsernameDomLayerHost,
        x: number,
        y: number,
        private readonly playerName: string,
        private readonly onLayoutChanged: () => void = () => {}
    ) {
        this.x = x;
        this.y = y;

        this.nameElement = document.createElement("span");
        this.nameElement.className = "username-display-name";
        this.nameElement.textContent = getShownName(playerName, false);

        this.element = document.createElement("div");
        this.element.setAttribute("aria-hidden", "true");
        this.element.className = "username-display";
        this.element.append(
            this.statusDisplay.element,
            this.nameElement,
            this.megaphoneDisplay.element,
            this.talkBubble.element
        );

        this.layer.addUsername(this.element);
        this.layer.register(this);
        this.applyStyles();
        // The first layout may have measured the layer before Phaser applied its transform for this frame:
        // lay out again at render time, against the real on-screen scale.
        this.layer.requestStyles(this);
    }

    public setAvailabilityStatus(availabilityStatus: AvailabilityStatus, instant = false): void {
        this.statusDisplay.setAvailabilityStatus(availabilityStatus, instant);
    }

    public getAvailabilityStatus(): AvailabilityStatus {
        return this.statusDisplay.availabilityStatus;
    }

    public setMegaphone(show: boolean, instant = false): void {
        this.megaphoneDisplay.show(show, instant);
    }

    /** The talk bubble above the pill. */
    public setTalking(talking: boolean, forceClose = false): void {
        this.talkBubble.show(talking, forceClose);
        this.onLayoutChanged();
    }

    public isTalking(): boolean {
        return this.talkBubble.isShown();
    }

    /** Faded along with the player (see Character.setFaded). */
    public setFaded(faded: boolean): void {
        this.element.style.opacity = faded ? "0.45" : "";
    }

    /**
     * The lighter pill, in front of the other names, with the full name.
     */
    public setHighlighted(highlighted: boolean): void {
        if (this.highlighted === highlighted) {
            return;
        }
        this.highlighted = highlighted;
        this.element.classList.toggle("is-highlighted", highlighted);
        this.nameElement.textContent = getShownName(this.playerName, highlighted);
        this.updateBackground();
        this.updateDepth();
        this.layer.requestStyles(this);
    }

    /**
     * A script or "follow" colours the pill. Without a colour it stays on the Universe look, and so does a
     * highlighted pill: the highlight takes over.
     */
    public setCustomColor(color: number | undefined): void {
        if (this.customColor === color) {
            return;
        }
        this.customColor = color;
        this.updateBackground();
    }

    public setPlayerDepth(depth: number): void {
        if (this.depth === depth) {
            return;
        }
        this.depth = depth;
        this.updateDepth();
    }

    public setPosition(x: number, y: number): this {
        if (x === this.x && y === this.y) {
            return this;
        }
        this.x = x;
        this.y = y;
        this.layer.requestTransform(this);
        return this;
    }

    /** Height of the pill, in game pixels, as it is drawn now. */
    public getPillHeight(): number {
        return PLAYER_NAME_HEIGHT * this.displayScale;
    }

    /**
     * Height of the talk bubble and the space under it, in game pixels, as they are drawn now: how far the bubble's
     * top stands above the pill's top.
     */
    public getBubbleExtent(): number {
        return this.getBubbleGap() + TALK_BUBBLE_HEIGHT * this.displayScale;
    }

    public destroy(): void {
        this.destroyed = true;
        this.layer.unregister(this);
        this.element.remove();
        this.statusDisplay.destroy();
        this.megaphoneDisplay.destroy();
        this.talkBubble.destroy();
    }

    /** Lays the pill out for the current zoom. Called by the layer when the zoom changes. */
    public applyStyles(): void {
        if (this.destroyed) {
            return;
        }
        const ancestorScale = this.layer.getAncestorScale();
        this.displayScale = getDisplayScale(this.layer.getZoomModifier(), ancestorScale);
        const transformScale = this.getTransformScale();
        const domScale = this.displayScale / transformScale;

        this.element.style.setProperty("--username-dom-scale", domScale.toString());
        // The status dot's border (.12f, and at least one screen pixel) and the bubble's gap, in the pill's own layout
        // pixels.
        const onePixelOnScreen = 1 / (transformScale * ancestorScale);
        this.element.style.setProperty(
            "--username-dot-border",
            `${Math.max(onePixelOnScreen, STATUS_DOT_BORDER_WIDTH * domScale)}px`
        );
        this.element.style.setProperty("--username-bubble-gap", `${this.getBubbleGap() / transformScale}px`);
        this.element.style.height = `${PLAYER_NAME_HEIGHT * domScale}px`;
        this.element.style.gap = `${PLAYER_NAME_GAP * domScale}px`;
        this.element.style.padding = `0 ${PLAYER_NAME_PADDING_RIGHT * domScale}px 0 ${
            PLAYER_NAME_PADDING_LEFT * domScale
        }px`;
        this.applyTransform();
        this.onLayoutChanged();
    }

    /** Places the pill. Called by the layer once Phaser has applied its own transform. */
    public applyTransform(): void {
        if (this.destroyed) {
            return;
        }
        const scale = this.getTransformScale();
        // The pill's bottom sits on the given y.
        const y = this.y - (PLAYER_NAME_HEIGHT / 2) * this.displayScale;
        this.element.style.transform = `translate3d(${this.x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`;
    }

    /**
     * The scale applied through the element's own CSS `transform`.
     *
     * The element is a promoted compositing layer (`will-change: transform`). Safari rasterizes such a layer's
     * backing store at full resolution only when its own transform is a minification (scale < 1); with a pure
     * translation it keeps the bitmap at `devicePixelRatio` and lets the parent's transform stretch it: blurry.
     * So the parent layer's on-screen scale is cancelled here to bring the total to at most 1, and the part that
     * cannot be cancelled without magnifying is folded into the layout size instead (see applyStyles): the pill is
     * laid out, and so rasterized, at its full size. The size on screen is `displayScale * ancestorScale` either way.
     */
    private getTransformScale(): number {
        return Math.min(1 / this.layer.getAncestorScale(), 1);
    }

    private getBubbleGap(): number {
        return (
            Math.max(BUBBLE_GAP_MIN_SCREEN_PX / this.layer.getAncestorScale(), BUBBLE_GAP_MIN_GAME_PX) +
            BUBBLE_GAP_EXTRA * this.displayScale
        );
    }

    private updateBackground(): void {
        this.element.style.background =
            this.customColor === undefined || this.highlighted
                ? ""
                : `#${this.customColor.toString(16).padStart(6, "0")}`;
    }

    private updateDepth(): void {
        // A highlighted name is above every other one.
        this.element.style.zIndex = `${Math.round(this.depth + (this.highlighted ? 2000000000 : 0))}`;
    }
}
