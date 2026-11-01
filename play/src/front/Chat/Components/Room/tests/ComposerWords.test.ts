import { describe, expect, it } from "vitest";
import { withWordsAdded, wordsAsComposerHtml } from "../ComposerWords";

describe("words put in the message box to be edited", () => {
    it("are text, never markup, with line breaks as the box writes them", () => {
        expect(wordsAsComposerHtml('a <b>bold</b> & "quoted"\nnext')).toBe(
            'a &lt;b&gt;bold&lt;/b&gt; &amp; "quoted"<br>next'
        );
    });

    it("go into an empty box as they are", () => {
        expect(withWordsAdded("", "Actually which of them replied")).toBe("Actually which of them replied");
        expect(withWordsAdded("<br>", "Actually which")).toBe("Actually which");
    });

    it("go after what was already typed, which stays", () => {
        expect(withWordsAdded("hello there", "Actually which")).toBe("hello there<br>Actually which");
    });

    it("leave the box alone when there are no words", () => {
        expect(withWordsAdded("hello", "   ")).toBe("hello");
    });
});
