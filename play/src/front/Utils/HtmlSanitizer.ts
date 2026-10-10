import DOMPurify from "dompurify";

/** Keep Markdown and our SVG keyboard hints, but remove executable markup and unsafe URLs. */
export function sanitizeHtml(html: string): string {
    // DOMPurify drops dominant-baseline, which centres the "SPACE" label inside the keyboard hint.
    return DOMPurify.sanitize(html, { ADD_ATTR: ["dominant-baseline"] });
}
