/**
 * Adds a picked emoji to the end of the message box's content (HTML where a new line is a <br>).
 * A box emptied by hand (Backspace, select-all then Delete) is not empty to the browser: it keeps one
 * <br> so the caret has a line. Appending after it would put the emoji on a second line.
 */
export function appendEmoji(message: string | undefined, emoji: string): string {
    const current = message ?? "";
    if (/^\s*<br\s*\/?>\s*$/i.test(current)) return emoji;
    return current + emoji;
}
