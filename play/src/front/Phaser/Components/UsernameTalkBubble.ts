import { prefersReducedMotion } from "./prefersReducedMotion";
import {
    TALK_BUBBLE_DOT_SIZE,
    TALK_BUBBLE_HEIGHT,
    TALK_BUBBLE_TAIL_SIZE,
    TALK_BUBBLE_WIDTH,
} from "./UsernameDisplaySizes";

const ANIMATION_DURATION = 350;
const SHOW_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const REST_TRANSFORM = "translateX(-50%)";

/**
 * The bubble above the pill while a player talks: white, fully round, a small tail at the bottom centre and three
 * ink dots that wave (see `.username-talk-bubble` in style.scss). It is a child of the pill, so it follows the pill's
 * position and scale; its size comes from `--username-dom-scale`.
 */
export class UsernameTalkBubble {
    public readonly element: HTMLDivElement;

    private shown = false;
    private animation?: Animation;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "username-talk-bubble";
        this.element.setAttribute("aria-hidden", "true");
        this.element.style.display = "none";
        this.element.style.width = `calc(${TALK_BUBBLE_WIDTH}px * var(--username-dom-scale, 1))`;
        this.element.style.height = `calc(${TALK_BUBBLE_HEIGHT}px * var(--username-dom-scale, 1))`;
        this.element.style.setProperty(
            "--username-talk-tail",
            `calc(${TALK_BUBBLE_TAIL_SIZE}px * var(--username-dom-scale, 1))`
        );
        this.element.style.gap = `calc(${TALK_BUBBLE_DOT_SIZE * 0.7}px * var(--username-dom-scale, 1))`;
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement("i");
            dot.style.width = `calc(${TALK_BUBBLE_DOT_SIZE}px * var(--username-dom-scale, 1))`;
            dot.style.height = `calc(${TALK_BUBBLE_DOT_SIZE}px * var(--username-dom-scale, 1))`;
            this.element.appendChild(dot);
        }
    }

    public isShown(): boolean {
        return this.shown;
    }

    /**
     * @param forceClose hide at once, without the closing animation
     */
    public show(show = true, forceClose = false): void {
        if (this.shown === show && !forceClose) {
            return;
        }
        this.shown = show;
        this.stopAnimation();

        if (forceClose && !show) {
            this.element.style.display = "none";
            return;
        }

        this.element.style.display = "flex";
        if (typeof this.element.animate !== "function" || prefersReducedMotion()) {
            this.element.style.display = show ? "flex" : "none";
            return;
        }

        this.animation = this.element.animate(
            show
                ? [
                      { opacity: 0, transform: `${REST_TRANSFORM} translateY(40%) scale(0.2)` },
                      { opacity: 1, transform: REST_TRANSFORM },
                  ]
                : [
                      { opacity: 1, transform: REST_TRANSFORM },
                      { opacity: 0, transform: REST_TRANSFORM },
                  ],
            { duration: ANIMATION_DURATION, easing: show ? SHOW_EASING : "ease-out" }
        );
        this.animation.onfinish = () => {
            this.element.style.display = this.shown ? "flex" : "none";
            // A finished `fill: "forwards"` animation keeps applying its last keyframe and outranks inline styles:
            // release it now that the inline display describes the resting state.
            this.stopAnimation();
        };
        if (!show) {
            // Hold the transparent last frame until display:none is applied, so the bubble does not flash back.
            this.animation.effect?.updateTiming({ fill: "forwards" });
        }
    }

    public destroy(): void {
        this.stopAnimation();
        this.element.remove();
    }

    private stopAnimation(): void {
        this.animation?.cancel();
        this.animation = undefined;
    }
}
