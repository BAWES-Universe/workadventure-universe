import { withoutBlankEdges } from "./BlankEdges";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/**
 * Words as the message box holds them: it is HTML, where the only markup it takes is a line break (<br>). Whatever the
 * words contain is text, never markup.
 */
export function wordsAsComposerHtml(words: string): string {
    return words.replace(/[&<>]/g, (char) => ESCAPES[char]).replace(/\r?\n/g, "<br>");
}

/**
 * The box after words are put in it to be edited (#1664): what was already typed stays, and the words go after it, on
 * their own line, so nothing typed is lost.
 */
export function withWordsAdded(current: string, words: string): string {
    const html = wordsAsComposerHtml(words.trim());
    if (html === "") return current;
    const typed = withoutBlankEdges(current);
    return typed === "" ? html : `${typed}<br>${html}`;
}
