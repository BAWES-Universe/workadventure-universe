import { describe, expect, it } from "vitest";
import { buildMapScriptPopup } from "../MapScriptPopup";

function actionsOf(container: HTMLDivElement): HTMLElement | null {
    return container.querySelector(".u-map-popup-actions");
}

describe("buildMapScriptPopup", () => {
    it("puts the buttons side by side in the actions div, in script order, with their ids", () => {
        const { container, buttons } = buildMapScriptPopup(7, "Hello", [
            { label: "Begin + shore signal" },
            { label: "Not now" },
            { label: "Close" },
        ]);

        const actions = actionsOf(container);
        expect(actions).not.toBeNull();
        expect(Array.from(actions?.children ?? [])).toEqual(buttons);
        expect(buttons.map((button) => button.id)).toEqual(["popup-7-0", "popup-7-1", "popup-7-2"]);
        expect(buttons.map((button) => button.textContent)).toEqual(["Begin + shore signal", "Not now", "Close"]);
        expect(buttons.every((button) => button.type === "button")).toBe(true);
        expect(container.querySelectorAll("button")).toHaveLength(3);
    });

    it("hands back a hidden styled container inside a plain outer element", () => {
        const { element, container } = buildMapScriptPopup(1, "Hi", []);

        expect(element.tagName).toBe("DIV");
        expect(element.children).toHaveLength(1);
        expect(element.firstElementChild).toBe(container);
        expect(container.id).toBe("container");
        expect(container.classList.contains("u-map-popup")).toBe(true);
        expect(container.classList.contains("u-surface")).toBe(true);
        expect(container.hidden).toBe(true);
    });

    it("keeps the message as text, line breaks included", () => {
        const { container } = buildMapScriptPopup(1, "Line one\nLine two", [{ label: "OK" }]);

        const message = container.querySelector(".u-map-popup-msg");
        expect(message?.textContent).toBe("Line one\nLine two");
    });

    it("never turns markup in the message or a label into elements or attributes", () => {
        const { container, buttons } = buildMapScriptPopup(1, '<b>x</b> <img src="y">', [
            { label: "<b>x</b>", className: '" onclick="x' },
            { label: '" onclick="x' },
        ]);

        expect(container.querySelector(".u-map-popup-msg")?.textContent).toBe('<b>x</b> <img src="y">');
        expect(container.querySelector("b, img")).toBeNull();
        expect(buttons[0].textContent).toBe("<b>x</b>");
        expect(buttons[1].textContent).toBe('" onclick="x');
        // Only the elements the builder makes: message, actions, two buttons.
        expect(container.querySelectorAll("*")).toHaveLength(4);
        for (const button of buttons) {
            expect(button.hasAttribute("onclick")).toBe(false);
            expect(button.getAttributeNames().sort()).toEqual(["class", "id", "type"]);
        }
        expect(buttons[0].className).toBe("u-map-popup-btn u-cta-secondary");
    });

    it("maps the button className to a Universe button class", () => {
        const classNames = [undefined, "normal", "primary", "success", "warning", "error", "disabled", "whatever"];
        const { buttons } = buildMapScriptPopup(
            1,
            "",
            classNames.map((className) => ({ label: "b", className }))
        );

        expect(buttons.map((button) => button.className)).toEqual([
            "u-map-popup-btn u-cta-secondary",
            "u-map-popup-btn u-cta-secondary",
            "u-map-popup-btn u-cta",
            "u-map-popup-btn u-cta",
            "u-map-popup-btn u-cta-coral",
            "u-map-popup-btn u-cta-coral",
            "u-map-popup-btn u-cta-secondary",
            "u-map-popup-btn u-cta-secondary",
        ]);
    });

    it("disables only the buttons given the disabled className", () => {
        const { buttons } = buildMapScriptPopup(1, "", [
            { label: "a", className: "disabled" },
            { label: "b", className: "primary" },
            { label: "c" },
        ]);

        expect(buttons.map((button) => button.disabled)).toEqual([true, false, false]);
    });

    it("marks exactly two buttons as a pair", () => {
        const pair = actionsOf(buildMapScriptPopup(1, "", [{ label: "a" }, { label: "b" }]).container);
        const three = actionsOf(buildMapScriptPopup(1, "", [{ label: "a" }, { label: "b" }, { label: "c" }]).container);
        const one = actionsOf(buildMapScriptPopup(1, "", [{ label: "a" }]).container);

        expect(pair?.classList.contains("is-pair")).toBe(true);
        expect(three?.classList.contains("is-pair")).toBe(false);
        expect(one?.classList.contains("is-pair")).toBe(false);
    });

    it("leaves out the message when it is empty", () => {
        const { container } = buildMapScriptPopup(1, "", [{ label: "OK" }]);

        expect(container.querySelector(".u-map-popup-msg")).toBeNull();
        expect(actionsOf(container)).not.toBeNull();
    });

    it("leaves out the actions when there are no buttons", () => {
        const { container, buttons } = buildMapScriptPopup(1, "Just a note", []);

        expect(buttons).toEqual([]);
        expect(actionsOf(container)).toBeNull();
        expect(container.querySelector(".u-map-popup-msg")?.textContent).toBe("Just a note");
    });
});
