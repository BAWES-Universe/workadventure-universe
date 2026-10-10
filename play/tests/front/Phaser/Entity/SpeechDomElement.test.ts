import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { marked } from "marked";
import type { SpeechDomElement as SpeechDomElementType } from "../../../../src/front/Phaser/Entity/SpeechDomElement";

vi.mock("../../../../src/i18n/i18n-svelte", () => ({
    default: {
        subscribe: (callback: (value: unknown) => void) => {
            callback({ trigger: { spaceKeyboard: () => "[SPACE]" } });
            return () => {};
        },
    },
}));

class DOMElement {
    constructor(_scene: unknown, _x: number, _y: number, public node: HTMLElement) {}
    setAlpha() {}
    destroy() {}
}

let SpeechDomElement: typeof SpeechDomElementType;

beforeAll(async () => {
    vi.stubGlobal("Phaser", { GameObjects: { DOMElement } });
    ({ SpeechDomElement } = await import("../../../../src/front/Phaser/Entity/SpeechDomElement"));
});

afterEach(() => vi.restoreAllMocks());

describe.each([false, true])("SpeechDomElement (async Markdown: %s)", (asyncMarkdown) => {
    async function render(text: string): Promise<HTMLElement> {
        if (asyncMarkdown) {
            const parse = marked.parse.bind(marked);
            vi.spyOn(marked, "parse").mockImplementation((...args) => Promise.resolve(parse(...args)));
        }
        const bubble = new SpeechDomElement("test", text, {} as Phaser.Scene);
        await Promise.resolve();
        return (bubble as unknown as DOMElement).node;
    }

    it("shows raw HTML literally without creating attacker elements", async () => {
        const html = "<b>x</b><img src=x onerror=alert(1)><svg onload=alert(1)></svg><script>alert(1)</script>";
        const node = await render(html);
        expect(node.textContent?.trim()).toBe(html);
        expect(node.querySelector("b, img, svg, script, [onerror], [onload]")).toBeNull();
    });

    it("preserves Markdown, safe links and the Space hint", async () => {
        const node = await render("**Welcome** [help](https://example.com) [SPACE]");
        expect(node.querySelector("strong")?.textContent).toBe("Welcome");
        expect(node.querySelector("a")?.href).toBe("https://example.com/");
        expect(node.querySelector("svg text")?.textContent).toBe("SPACE");
    });

    it("removes executable URLs produced by Markdown", async () => {
        const node = await render("[click](javascript:alert%281%29)");
        expect(node.querySelector("a")?.getAttribute("href")).toBeNull();
    });
});

it("keeps popup activation and removes its listener on destruction", () => {
    const callback = vi.fn();
    const bubble = new SpeechDomElement(
        "trigger",
        "[SPACE] to open web site 👀",
        {} as Phaser.Scene,
        -1,
        -50,
        callback
    );
    const node = (bubble as unknown as DOMElement).node;
    node.click();
    expect(callback).toHaveBeenCalledOnce();
    bubble.destroy();
    node.click();
    expect(callback).toHaveBeenCalledOnce();
});
