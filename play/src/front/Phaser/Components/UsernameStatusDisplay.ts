import { AvailabilityStatus } from "@workadventure/messages";
import { getColorOfStatus } from "../../Utils/AvailabilityStatus";
import { prefersReducedMotion } from "./prefersReducedMotion";
import { STATUS_DOT_BORDER_WIDTH, STATUS_DOT_SIZE } from "./UsernameDisplaySizes";

const colorNumberToHex = (color: number): string => `#${color.toString(16).padStart(6, "0")}`;

/**
 * The status dot at the left of the name: the status colour, with a border in the status outline colour. The border's
 * width is set by the pill (`--username-dot-border`): .12f, and at least one screen pixel, so it stays visible when
 * the pill is small.
 */
export class UsernameStatusDisplay {
    public readonly element: HTMLSpanElement;

    private availabilityStatusValue = AvailabilityStatus.ONLINE;
    private animation?: Animation;
    private redrawTimeout: number | undefined;

    constructor() {
        this.element = document.createElement("span");
        this.element.style.display = "inline-block";
        this.element.style.flex = "0 0 auto";
        this.element.style.width = `calc(${STATUS_DOT_SIZE}px * var(--username-dom-scale, 1))`;
        this.element.style.height = `calc(${STATUS_DOT_SIZE}px * var(--username-dom-scale, 1))`;
        this.element.style.borderRadius = "50%";
        this.element.style.boxSizing = "border-box";
        this.element.style.borderWidth = `var(--username-dot-border, ${STATUS_DOT_BORDER_WIDTH}px)`;
        this.redraw();
    }

    public setAvailabilityStatus(availabilityStatus: AvailabilityStatus, instant = false): void {
        if (
            this.availabilityStatusValue === availabilityStatus ||
            availabilityStatus === AvailabilityStatus.UNCHANGED
        ) {
            return;
        }

        this.availabilityStatusValue = availabilityStatus;
        if (instant || typeof this.element.animate !== "function" || prefersReducedMotion()) {
            this.stopAnimation();
            this.redraw();
            return;
        }

        this.playStatusChangeAnimation();
    }

    public destroy(): void {
        this.stopAnimation();
        this.element.remove();
    }

    private playStatusChangeAnimation(): void {
        this.stopAnimation();

        this.animation = this.element.animate(
            [{ transform: "scale(1)" }, { transform: "scale(0.25)" }, { transform: "scale(1)" }],
            {
                duration: 300,
                easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
            }
        );

        this.redrawTimeout = window.setTimeout(() => {
            this.redraw();
            this.redrawTimeout = undefined;
        }, 150);

        this.animation.onfinish = () => {
            this.animation = undefined;
            this.element.style.transform = "";
        };
    }

    private stopAnimation(): void {
        this.animation?.cancel();
        this.animation = undefined;

        if (this.redrawTimeout !== undefined) {
            window.clearTimeout(this.redrawTimeout);
            this.redrawTimeout = undefined;
        }

        this.element.style.transform = "";
    }

    private redraw(): void {
        const colors = getColorOfStatus(this.availabilityStatusValue);
        this.element.style.backgroundColor = colorNumberToHex(colors.filling);
        this.element.style.borderStyle = "solid";
        this.element.style.borderColor = colorNumberToHex(colors.outline);
    }

    get availabilityStatus(): AvailabilityStatus {
        return this.availabilityStatusValue;
    }
}
