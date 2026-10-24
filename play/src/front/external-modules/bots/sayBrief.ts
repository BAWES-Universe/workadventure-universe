/**
 * The one-line brief of the Personality row: the first line of the instruction as it is written,
 * with "…" right after it when more text follows, so a long instruction never looks like a short one.
 * `none` is the text shown when there is no instruction.
 */
export function sayBrief(instructions: string | undefined, none: string): string {
    const text = instructions?.trim() ?? "";
    if (!text) return none;
    const [first, ...rest] = text.split("\n");
    const hasMore = rest.some((line) => line.trim() !== "");
    return hasMore ? `${first.trimEnd()}…` : first.trimEnd();
}
