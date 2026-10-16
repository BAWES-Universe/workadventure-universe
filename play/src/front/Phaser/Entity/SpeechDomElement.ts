import { get } from "svelte/store";
import { marked } from "marked";
import LL from "../../../i18n/i18n-svelte";
import { sanitizeHtml } from "../../Utils/HtmlSanitizer";
import { isTouchDevice } from "../../Utils/TouchDevice";
import { replaceSpaceToken, SOUND_ICON_PATHS } from "../../Utils/HintKey";

function createSoundIcon(): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("u-hint-icon");
    for (const d of SOUND_ICON_PATHS) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

export class SpeechDomElement extends Phaser.GameObjects.DOMElement {
    private timeoutDestroyText: NodeJS.Timeout | null = null;
    private readonly span: HTMLSpanElement | null = null;

    constructor(
        public readonly id: string,
        text: string,
        scene: Phaser.Scene,
        x = -1,
        y = -50,
        public readonly callback = () => this.destroy(),
        type: "warning" | "message" = "message",
        icon?: "sound"
    ) {
        // Create span element
        // Map-authored raw HTML is displayed literally; Markdown formatting still works.
        // Use a local renderer so other Markdown consumers are not affected.
        const renderer = new marked.Renderer();
        renderer.html = (html) => {
            const escaped = document.createElement("span");
            escaped.textContent = html;
            return escaped.innerHTML;
        };
        const textMarked = marked.parse(text, { renderer });
        // The [SPACE] of a hint is shown as a key chip: "Space" on a computer, "Tap" on a touch screen.
        const trigger = get(LL).trigger;
        const keyLabel = isTouchDevice() ? trigger.keyTap() : trigger.keySpace();
        const renderText = (html: string) => sanitizeHtml(replaceSpaceToken(html, trigger.spaceKeyboard(), keyLabel));
        const content = document.createElement("span");
        const span = document.createElement("span");
        const row = document.createElement("span");
        row.classList.add("u-hint-row");
        if (icon === "sound") row.appendChild(createSoundIcon());
        row.appendChild(content);
        span.appendChild(row);

        if (textMarked instanceof Promise) {
            textMarked
                .then((resolvedText) => {
                    content.innerHTML = renderText(resolvedText);
                })
                .catch((e) => console.error(e));
        } else {
            content.innerHTML = renderText(textMarked);
        }
        span.id = `spanText-${id}`;
        span.classList.add("characterTriggerAction", "u-hint");

        super(
            scene,
            x,
            y,
            span,
            `z-index:10; color: ${
                type === "message" ? "#ffffff" : "#f9e81e"
            }; cursor: pointer; max-height: 150px; overflow-y: auto;`
        );

        this.span = span;
        this.span.addEventListener("click", this.callback);
        this.setAlpha(0);
    }

    public play(textX: number, textY: number, duration: number, callback?: (id: string) => void) {
        if (this.timeoutDestroyText) clearTimeout(this.timeoutDestroyText);
        this.scene?.tweens.add({
            targets: this,
            props: {
                alpha: 1,
                y: textY,
                x: textX,
            },
            ease: "Power2",
            duration: 1000,
            onComplete: () => {
                if (duration < 1) return;
                this.timeoutDestroyText = setTimeout(() => {
                    this.destroy();
                    if (callback) callback(this.id);
                }, duration);
            },
        });
    }

    public destroy() {
        if (this.span) {
            this.span.removeEventListener("click", this.callback);
        }
        if (this.timeoutDestroyText) {
            clearTimeout(this.timeoutDestroyText);
        }
        super.destroy();
    }
}
