import { QuillDeltaToHtmlConverter } from "quill-delta-to-html";

/**
 * Turns the Quill delta of a global text message into HTML.
 * Shared by the popup people receive and the preview in the composer, so the preview matches what arrives.
 */
export function renderGlobalTextMessage(ops: unknown[]): string {
    return new QuillDeltaToHtmlConverter(ops, { inlineStyles: true }).convert();
}
