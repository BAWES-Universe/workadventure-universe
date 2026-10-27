import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { PDF_VIEWER_SCOPE_CLASS, scopePdfViewerCss } from "../scopePdfViewerCss";

const SCOPE = `:where(.${PDF_VIEWER_SCOPE_CLASS})`;

function selectorsOf(css: string): string[] {
    const selectors: string[] = [];
    postcss.parse(css).walkRules((rule) => {
        selectors.push(...rule.selectors);
    });
    return selectors;
}

describe("the PDF reader's stylesheet kept inside the reader", () => {
    it("puts plain class rules under the reader's root, so the map editor's .sidebar is left alone", () => {
        const out = scopePdfViewerCss(".sidebar{width:239px}.dialog .title,.pdfViewer .page{color:red}");
        expect(selectorsOf(out)).toEqual([`${SCOPE} .sidebar`, `${SCOPE} .dialog .title`, `${SCOPE} .pdfViewer .page`]);
    });

    it("moves :root variables onto the reader's root", () => {
        const out = scopePdfViewerCss(":root{--a:1}:root *{--b:2}");
        expect(selectorsOf(out)).toEqual([SCOPE, `${SCOPE} *`]);
    });

    it("scopes rules inside @media and @supports too", () => {
        const out = scopePdfViewerCss("@media (forced-colors: active){.sidebar{color:Canvas}}");
        expect(selectorsOf(out)).toEqual([`${SCOPE} .sidebar`]);
        expect(out).toContain("@media (forced-colors: active)");
    });

    it("moves only the outer rule of nested CSS, as the inner ones are relative to it", () => {
        const out = scopePdfViewerCss(".messageBar{color:red;& .closeButton{color:blue}.title{color:green}}");
        expect(selectorsOf(out)).toEqual([`${SCOPE} .messageBar`, "& .closeButton", ".title"]);
    });

    it("leaves the steps of an animation alone", () => {
        const out = scopePdfViewerCss("@keyframes spin{from{opacity:0}to{opacity:1}}");
        expect(selectorsOf(out)).toEqual(["from", "to"]);
    });

    it("leaves no rule of the real stylesheet loose on the page", () => {
        const pdfjsDir = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
        const css = readFileSync(`${pdfjsDir}/web/pdf_viewer.css`, "utf8");
        const loose: string[] = [];
        postcss.parse(scopePdfViewerCss(css)).walkRules((rule) => {
            // Rules nested in another rule, even through an @media in between, are relative to it.
            for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
                if (parent.type === "rule") return;
            }
            loose.push(...rule.selectors.filter((selector) => !selector.startsWith(SCOPE)));
        });
        expect(loose).toEqual([]);
    });
});
