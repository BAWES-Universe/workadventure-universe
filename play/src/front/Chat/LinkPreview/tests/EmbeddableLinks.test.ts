import { describe, expect, it } from "vitest";
import { isPlainClick, opensHere, rememberEmbeddable } from "../EmbeddableLinks";

const GAME = "https://play.bawes.net";

describe("opensHere", () => {
    it("opens a page the server said the game may show, with or without its #part", () => {
        rememberEmbeddable("https://en.wikipedia.org/wiki/Kuwait", {
            url: "https://en.wikipedia.org/wiki/Kuwait",
            embeddable: true,
        });
        expect(opensHere("https://en.wikipedia.org/wiki/Kuwait", GAME)).toBe(true);
        expect(opensHere("https://en.wikipedia.org/wiki/Kuwait#History", GAME)).toBe(true);
    });

    it("knows a bare site name by the address its link gets", () => {
        rememberEmbeddable("https://bawes.blog", { url: "https://bawes.blog/", embeddable: true });
        // The browser writes the link's href with a trailing slash.
        expect(opensHere("https://bawes.blog/", GAME)).toBe(true);
    });

    it("keeps a new tab for pages that refuse, and for links not previewed yet", () => {
        rememberEmbeddable("https://github.com/BAWES-Universe", { embeddable: false });
        rememberEmbeddable("https://example.com/no-answer", undefined);
        expect(opensHere("https://github.com/BAWES-Universe", GAME)).toBe(false);
        expect(opensHere("https://example.com/no-answer", GAME)).toBe(false);
        expect(opensHere("https://never-previewed.com/", GAME)).toBe(false);
    });

    it("keeps a new tab for http pages and for Universe itself", () => {
        rememberEmbeddable("http://plain.example.com/", { embeddable: true });
        rememberEmbeddable("https://play.bawes.net/_/room", { embeddable: true });
        expect(opensHere("http://plain.example.com/", GAME)).toBe(false);
        expect(opensHere("https://play.bawes.net/_/room", GAME)).toBe(false);
    });

    it("never throws on something that isn't an address", () => {
        expect(opensHere("not a link", GAME)).toBe(false);
        expect(() => rememberEmbeddable("not a link", { embeddable: true })).not.toThrow();
    });
});

describe("isPlainClick", () => {
    const click = (init: MouseEventInit) => new MouseEvent("click", init);

    it("is a left click with no key held", () => {
        expect(isPlainClick(click({ button: 0 }))).toBe(true);
    });

    it("leaves Ctrl, Cmd, Shift, Alt and middle clicks to the browser", () => {
        expect(isPlainClick(click({ button: 0, ctrlKey: true }))).toBe(false);
        expect(isPlainClick(click({ button: 0, metaKey: true }))).toBe(false);
        expect(isPlainClick(click({ button: 0, shiftKey: true }))).toBe(false);
        expect(isPlainClick(click({ button: 0, altKey: true }))).toBe(false);
        expect(isPlainClick(click({ button: 1 }))).toBe(false);
    });
});
