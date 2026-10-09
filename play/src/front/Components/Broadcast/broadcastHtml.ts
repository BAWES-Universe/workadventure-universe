import { QuillDeltaToHtmlConverter } from "quill-delta-to-html";

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A broadcast's text as HTML. It travels in the rich editor's format (Quill's delta), which older tools and the
 * Orbit API still send; plain text is shown as a paragraph.
 */
export function broadcastHtml(content: string): string {
    try {
        const delta = JSON.parse(content) as { ops?: unknown };
        if (delta && Array.isArray(delta.ops)) {
            return new QuillDeltaToHtmlConverter(delta.ops, { inlineStyles: true }).convert();
        }
    } catch {
        // Not a delta: plain text.
    }
    return `<p>${escapeHtml(content).replace(/\n/g, "<br>")}</p>`;
}
