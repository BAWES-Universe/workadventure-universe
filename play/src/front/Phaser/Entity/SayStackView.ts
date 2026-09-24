import type { SayStackLine, SayStackRemovalReason, SayStackView } from "./SayStack";
import { SpeechBubble } from "./SpeechBubble";
import { ThinkingCloud } from "./ThinkingCloud";

/** Keep in sync with the `say-stack-*` animations in style.scss. */
export const SAY_STACK_ANIMATION_MS = 180;

function prefersReducedMotion(): boolean {
    try {
        return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}

/**
 * Draws a {@link SayStack} as DOM: a zero-size anchor (placed by Phaser above the avatar) holding a
 * bottom-anchored column, so new lines appear at the bottom and older ones are pushed up.
 *
 * Motion: new items rise and fade in, the items they push up glide to their new place (FLIP),
 * and removed items fade out before leaving the layout. All of it is skipped with reduced motion.
 */
export class SayStackDomView implements SayStackView {
    private readonly root: HTMLDivElement;
    private readonly column: HTMLDivElement;
    private readonly lineItems = new Map<number, HTMLDivElement>();
    private thoughtItem: HTMLDivElement | undefined;
    private readonly leaveTimers = new Set<ReturnType<typeof setTimeout>>();
    private destroyed = false;

    constructor(private readonly onChange: () => void = () => {}) {
        this.root = document.createElement("div");
        this.root.classList.add("say-stack-anchor");
        this.column = document.createElement("div");
        this.column.classList.add("say-stack");
        this.root.appendChild(this.column);
    }

    public getElement(): HTMLDivElement {
        return this.root;
    }

    /** Height of the visible stack in layout pixels, 0 when empty. */
    public getHeight(): number {
        return this.column.childElementCount > 0 ? this.column.offsetHeight : 0;
    }

    public addLine(line: SayStackLine): void {
        const item = this.createItem(new SpeechBubble(line.text).getElement());
        item.dataset.lineId = String(line.id);
        this.lineItems.set(line.id, item);
        this.insert(item);
    }

    public removeLine(line: SayStackLine, _reason: SayStackRemovalReason): void {
        const item = this.lineItems.get(line.id);
        this.lineItems.delete(line.id);
        if (item) {
            this.leave(item);
        }
    }

    public showThought(text: string): void {
        const cloud = new ThinkingCloud({
            text,
            maxWidth: 200,
            fontSize: 11,
            cornerRadius: 10,
            padding: 12,
            fillColor: 0xffffff,
            fillAlpha: 0.8,
        }).getElement();
        const item = this.createItem(cloud);
        item.classList.add("say-stack__item--thought");
        this.thoughtItem = item;
        this.insert(item);
    }

    public hideThought(): void {
        const item = this.thoughtItem;
        this.thoughtItem = undefined;
        if (item) {
            this.leave(item);
        }
    }

    public destroy(): void {
        this.destroyed = true;
        for (const timer of this.leaveTimers) {
            clearTimeout(timer);
        }
        this.leaveTimers.clear();
        this.lineItems.clear();
        this.thoughtItem = undefined;
        this.column.replaceChildren();
        this.root.remove();
    }

    private createItem(content: HTMLElement): HTMLDivElement {
        const item = document.createElement("div");
        item.classList.add("say-stack__item");
        const inner = document.createElement("div");
        inner.classList.add("say-stack__content", "is-entering");
        inner.addEventListener("animationend", () => inner.classList.remove("is-entering"), { once: true });
        inner.appendChild(content);
        item.appendChild(inner);
        return item;
    }

    private insert(item: HTMLDivElement): void {
        if (this.destroyed) {
            return;
        }
        this.withFlip(() => this.column.appendChild(item));
        this.onChange();
    }

    private leave(item: HTMLDivElement): void {
        if (this.destroyed) {
            return;
        }
        const detach = () => {
            this.withFlip(() => item.remove());
            this.onChange();
        };
        if (prefersReducedMotion()) {
            detach();
            return;
        }
        item.classList.add("is-leaving");
        item.firstElementChild?.classList.remove("is-entering");
        item.firstElementChild?.classList.add("is-leaving");
        const timer = setTimeout(() => {
            this.leaveTimers.delete(timer);
            detach();
        }, SAY_STACK_ANIMATION_MS);
        this.leaveTimers.add(timer);
        this.onChange();
    }

    /**
     * Runs a layout change and makes the items that moved glide from their old place (FLIP).
     * Offsets are layout pixels, so the camera zoom applied by Phaser does not skew them.
     */
    private withFlip(mutate: () => void): void {
        if (prefersReducedMotion()) {
            mutate();
            return;
        }
        const items = Array.from(this.column.children).filter(
            (child): child is HTMLElement => child instanceof HTMLElement
        );
        const distanceFromBottom = (el: HTMLElement) => this.column.offsetHeight - el.offsetTop;
        const before = new Map(items.map((el) => [el, distanceFromBottom(el)]));

        mutate();

        for (const [el, previous] of before) {
            if (!el.isConnected) {
                continue;
            }
            const delta = distanceFromBottom(el) - previous;
            if (delta === 0) {
                continue;
            }
            el.style.transition = "none";
            el.style.transform = `translateY(${delta}px)`;
            // Force a reflow so the browser starts the transition from the old place.
            void el.offsetHeight;
            el.style.transition = "";
            el.style.transform = "";
        }
    }
}
