// Empty lines, spaces and zero-width characters: line breaks as the message box writes them (<br>, an empty <div> on
// iPhones), as Enter turns them into (\n, also inside that <div>), and &nbsp;.
const BLANK = "(?:<br\\s*/?>|<div>(?:<br\\s*/?>|\\s)*</div>|&nbsp;|[\\s\\u200B-\\u200D\\uFEFF])+";
const LEADING_BLANK = new RegExp(`^${BLANK}`, "i");
const TRAILING_BLANK = new RegExp(`${BLANK}$`, "i");

/**
 * The typed message without blank lines or spaces before or after it (#1139): a Return tapped before Send would
 * otherwise go out as empty room under the text in the bubble. Line breaks inside the message stay.
 */
export function withoutBlankEdges(text: string): string {
    return text.replace(LEADING_BLANK, "").replace(TRAILING_BLANK, "");
}
