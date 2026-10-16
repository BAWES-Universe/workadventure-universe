import { describe, expect, it } from "vitest";
import { appendEmoji } from "./AppendEmoji";

describe("appendEmoji", () => {
    it("puts the emoji after typed text", () => {
        expect(appendEmoji("hi", "😌")).toBe("hi😌");
    });

    it("puts the emoji alone in an empty box", () => {
        expect(appendEmoji("", "😌")).toBe("😌");
        expect(appendEmoji(undefined, "😌")).toBe("😌");
    });

    it("ignores the lone <br> a browser leaves in a box that was emptied by hand", () => {
        expect(appendEmoji("<br>", "😌")).toBe("😌");
        expect(appendEmoji("<br/>", "😌")).toBe("😌");
    });

    it("keeps new lines the player typed", () => {
        expect(appendEmoji("hi<br>", "😌")).toBe("hi<br>😌");
        expect(appendEmoji("<br><br>", "😌")).toBe("<br><br>😌");
    });
});
