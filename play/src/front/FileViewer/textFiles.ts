import { Marked } from "marked";
import DOMPurify from "dompurify";
import { textEncodingOf } from "./fileKinds";

/** Only this much of a text file is shown; the rest is one tap away as a download. */
export const MAX_TEXT_BYTES = 1024 * 1024;
/** A table shows this many rows and columns at most: more would make the panel slow. */
export const MAX_TABLE_ROWS = 1000;
export const MAX_TABLE_COLUMNS = 100;

export interface DecodedText {
    text: string;
    /** The file is longer than what was decoded. */
    truncated: boolean;
}

/** The first megabyte of a file as text, in whichever Unicode form the file says it is in. */
export function decodeText(bytes: Uint8Array, limit = MAX_TEXT_BYTES): DecodedText {
    const encoding = textEncodingOf(bytes);
    const truncated = bytes.length > limit;
    // UTF-16 takes two bytes a letter: cut on a pair so a letter is never split.
    const end = encoding === "utf-8" ? limit : limit - (limit % 2);
    let text = new TextDecoder(encoding).decode(truncated ? bytes.subarray(0, end) : bytes);
    // The decoder drops a byte order mark itself. A letter cut in half by the limit shows as one replacement mark.
    if (truncated && text.endsWith("�")) text = text.slice(0, -1);
    return { text, truncated };
}

/**
 * Lays a one-line JSON text out over several lines. Only white space is added: the values stay exactly as they are
 * written (a long number keeps all its digits). A text that already has line breaks, or is not JSON, is left as it is.
 */
export function indentJson(text: string): string {
    const trimmed = text.trim();
    if (trimmed.includes("\n")) return text;
    // Only text that really is JSON is laid out: anything else (a cut-off file, notes) is shown as it is.
    try {
        JSON.parse(trimmed);
    } catch {
        return text;
    }
    let out = "";
    let depth = 0;
    let inString = false;
    let escaped = false;
    const newline = () => `\n${"  ".repeat(Math.max(0, depth))}`;
    for (let index = 0; index < trimmed.length; index++) {
        const char = trimmed[index];
        if (inString) {
            out += char;
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            out += char;
        } else if (char === "{" || char === "[") {
            const next = trimmed[index + 1];
            // An empty {} or [] stays on one line.
            if ((char === "{" && next === "}") || (char === "[" && next === "]")) {
                out += char + next;
                index++;
            } else {
                depth++;
                out += char + newline();
            }
        } else if (char === "}" || char === "]") {
            depth--;
            out += newline() + char;
        } else if (char === ",") {
            out += char + newline();
        } else if (char === ":") {
            out += ": ";
        } else if (!/\s/.test(char)) {
            out += char;
        }
    }
    return out;
}

/** The separator a table text uses: a comma, a semicolon (many locales) or a tab, taken from its first line. */
function delimiterOf(text: string): string {
    const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
    let inQuotes = false;
    for (const char of text.slice(0, 4096)) {
        if (char === '"') inQuotes = !inQuotes;
        else if (!inQuotes && char === "\n") break;
        else if (!inQuotes && char in counts) counts[char]++;
    }
    const [best, count] = Object.entries(counts).sort((first, second) => second[1] - first[1])[0];
    return count > 0 ? best : ",";
}

export interface ParsedTable {
    rows: string[][];
    /** How many rows the text has in all, when it was read to the end (a cut-off text does not know). */
    totalRows: number | undefined;
    rowsCut: boolean;
    columnsCut: boolean;
}

/** A comma separated text as rows of cells (quotes, doubled quotes and line breaks inside a cell understood). */
export function parseCsv(text: string, complete: boolean): ParsedTable {
    const delimiter = delimiterOf(text);
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;
    let totalRows = 0;
    let columnsCut = false;

    const endCell = () => {
        if (row.length < MAX_TABLE_COLUMNS) row.push(cell);
        else columnsCut = true;
        cell = "";
    };
    const endRow = () => {
        endCell();
        // A blank line is not a row.
        if (!(row.length === 1 && row[0] === "")) {
            totalRows++;
            if (rows.length < MAX_TABLE_ROWS) rows.push(row);
        }
        row = [];
    };

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (inQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    cell += '"';
                    index++;
                } else inQuotes = false;
            } else cell += char;
        } else if (char === '"' && cell === "") inQuotes = true;
        else if (char === delimiter) endCell();
        else if (char === "\n") endRow();
        else if (char === "\r") {
            if (text[index + 1] === "\n") index++;
            endRow();
        } else cell += char;
    }
    // The last row, when the text does not end with a line break.
    if (cell !== "" || row.length > 0) endRow();

    return {
        rows,
        totalRows: complete ? totalRows : undefined,
        rowsCut: totalRows > rows.length,
        columnsCut,
    };
}

const SAFE_INLINE_PICTURE = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

// Its own sanitizer, so these settings and hooks never touch the chat's.
const purify = DOMPurify(window);
purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
    }
});

/**
 * A picture that points to another site would tell that site who opened the file, so it becomes a link. Only
 * pictures inside the file itself (a data address) stay pictures. The text is parsed inert: nothing loads here.
 */
function picturesFromOtherSitesToLinks(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const picture of Array.from(template.content.querySelectorAll("img"))) {
        const source = (picture.getAttribute("src") ?? "").trim();
        const alt = picture.getAttribute("alt") ?? "";
        if (SAFE_INLINE_PICTURE.test(source)) {
            picture.removeAttribute("srcset");
        } else if (/^https?:\/\//i.test(source)) {
            const link = document.createElement("a");
            link.setAttribute("href", source);
            link.textContent = alt || source;
            picture.replaceWith(link);
        } else {
            picture.replaceWith(document.createTextNode(alt));
        }
    }
    return template.innerHTML;
}

const marked = new Marked({ gfm: true, async: false });

/**
 * A Markdown file as safe HTML, formatted the way chat messages are. HTML inside the file is cleaned (no scripts, no
 * styles, no forms, no frames), links open in a new tab, and pictures from other sites become links.
 */
export function renderMarkdown(text: string): string {
    const html = marked.parse(text) as string;
    return purify.sanitize(picturesFromOtherSitesToLinks(html), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: [
            "style",
            "form",
            "input",
            "button",
            "textarea",
            "select",
            "option",
            "video",
            "audio",
            "source",
            "track",
            "picture",
            "link",
            "meta",
            "base",
            "iframe",
            "object",
            "embed",
        ],
        FORBID_ATTR: ["style", "srcset", "poster", "background", "formaction", "action"],
    });
}
