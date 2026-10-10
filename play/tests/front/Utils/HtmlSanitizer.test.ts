import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../../../src/front/Utils/HtmlSanitizer";

describe("HtmlSanitizer", () => {
    it.each([
        '<img src="x" onerror="alert(1)">',
        "<script>alert(1)</script>",
        "<svg onload=alert(1)><script>alert(1)</script></svg>",
        '<a href="javascript:alert(1)">click</a>',
        '<a href="jav&#x61;script:alert(1)">click</a>',
    ])("removes executable markup from %s", (html) => {
        const element = document.createElement("span");
        element.innerHTML = sanitizeHtml(html);
        expect(element.querySelector("script, [onerror], [onload]")).toBeNull();
        expect(element.querySelector("a")?.getAttribute("href") ?? "").not.toContain("javascript:");
    });

    it("keeps Markdown formatting and safe links", () => {
        const sanitized = sanitizeHtml('<p>Hello <strong>world</strong> <a href="https://example.com">link</a></p>');
        expect(sanitized).toContain("<strong>world</strong>");
        expect(sanitized).toContain('href="https://example.com"');
    });

    it("keeps the speech bubble SVG keyboard hint", () => {
        const sanitized = sanitizeHtml(
            '<svg width="20" height="10" viewBox="0 0 20 10" style="fill: white">' +
                '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">SPACE</text></svg>'
        );
        expect(sanitized).toContain("<svg");
        expect(sanitized).toContain('viewBox="0 0 20 10"');
        expect(sanitized).toContain("SPACE</text>");
    });
});
