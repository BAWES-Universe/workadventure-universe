import { describe, expect, it } from "vitest";
import {
    codeKindOfArtifact,
    codeKindOfExtension,
    codeLanguageOfName,
    colorLines,
    loadHighlighter,
    MAX_COLORED_CHARS,
    splitColoredLines,
} from "../codeHighlight";

describe("knowing what code is", () => {
    it("reads the language and its name from a file's ending", () => {
        expect(codeKindOfExtension("ts")).toEqual({ language: "typescript", label: "TypeScript" });
        expect(codeKindOfExtension("HTML")).toEqual({ language: "xml", label: "HTML" });
        expect(codeKindOfExtension("yml")).toEqual({ language: "yaml", label: "YAML" });
        expect(codeKindOfExtension("txt")).toEqual({ language: undefined, label: "Text" });
        expect(codeKindOfExtension("")).toEqual({ language: undefined, label: "Text" });
    });

    it("reads a mini app or page as HTML, a drawing as SVG and a document as Markdown", () => {
        expect(codeKindOfArtifact("app")).toEqual({ language: "xml", label: "HTML" });
        expect(codeKindOfArtifact("page")).toEqual({ language: "xml", label: "HTML" });
        expect(codeKindOfArtifact("svg")).toEqual({ language: "xml", label: "SVG" });
        expect(codeKindOfArtifact("markdown")).toEqual({ language: "markdown", label: "Markdown" });
        expect(codeKindOfArtifact(undefined)).toEqual({ language: undefined, label: "Text" });
    });

    it("knows the languages a Markdown code block names, and only those", () => {
        expect(codeLanguageOfName("js")).toBe("javascript");
        expect(codeLanguageOfName("TypeScript")).toBe("typescript");
        expect(codeLanguageOfName("html")).toBe("xml");
        expect(codeLanguageOfName("shell")).toBe("bash");
        expect(codeLanguageOfName("rust")).toBeUndefined();
        expect(codeLanguageOfName("constructor")).toBeUndefined();
        expect(codeLanguageOfName(undefined)).toBeUndefined();
    });
});

describe("coloring code line by line", () => {
    it("closes a colored part at a line break and opens it again on the next line", () => {
        expect(splitColoredLines('a<span class="c">/* one\ntwo */</span>b\n')).toEqual([
            'a<span class="c">/* one</span>',
            '<span class="c">two */</span>b',
            "",
        ]);
        expect(splitColoredLines('<span class="x"><span class="y">1\n2</span></span>')).toEqual([
            '<span class="x"><span class="y">1</span></span>',
            '<span class="x"><span class="y">2</span></span>',
        ]);
    });

    it("gives one colored line for every line of code, with the code's own text escaped", async () => {
        const hljs = await loadHighlighter();
        const code = '<div class="a">\n  <script>let x = "<b>";</script>\n</div>';
        const lines = colorLines(hljs, code, "xml");

        expect(lines).toHaveLength(3);
        const box = document.createElement("div");
        box.innerHTML = (lines ?? []).join("\n");
        expect(box.textContent).toBe(code);
        expect(box.querySelector("b, script, div")).toBeNull();
        expect(box.querySelector(".hljs-keyword")?.textContent).toBe("let");
    });

    it("leaves plain text and very long code uncolored", async () => {
        const hljs = await loadHighlighter();
        expect(colorLines(hljs, "just words", undefined)).toBeUndefined();
        expect(colorLines(hljs, "x".repeat(MAX_COLORED_CHARS + 1), "javascript")).toBeUndefined();
    });
});
