import DOMPurify from "dompurify";

/** Keep Markdown and our SVG keyboard hints, but remove executable markup and unsafe URLs. */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html);
}
