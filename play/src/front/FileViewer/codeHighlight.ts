import { tick } from "svelte";
import type { HLJSApi } from "highlight.js";

/** The languages the code view colors. Only these are loaded, and only when code is shown. */
export type CodeLanguage =
    | "xml"
    | "css"
    | "javascript"
    | "typescript"
    | "json"
    | "markdown"
    | "python"
    | "yaml"
    | "bash"
    | "sql";

/** What code is: the language it is colored as, and the name shown over it ("HTML · 90 lines"). */
export interface CodeKind {
    language: CodeLanguage | undefined;
    label: string;
}

const CODE_BY_EXTENSION: Record<string, CodeKind> = {
    html: { language: "xml", label: "HTML" },
    htm: { language: "xml", label: "HTML" },
    xml: { language: "xml", label: "XML" },
    svg: { language: "xml", label: "SVG" },
    css: { language: "css", label: "CSS" },
    js: { language: "javascript", label: "JavaScript" },
    mjs: { language: "javascript", label: "JavaScript" },
    cjs: { language: "javascript", label: "JavaScript" },
    jsx: { language: "javascript", label: "JavaScript" },
    ts: { language: "typescript", label: "TypeScript" },
    mts: { language: "typescript", label: "TypeScript" },
    cts: { language: "typescript", label: "TypeScript" },
    tsx: { language: "typescript", label: "TypeScript" },
    json: { language: "json", label: "JSON" },
    md: { language: "markdown", label: "Markdown" },
    py: { language: "python", label: "Python" },
    yaml: { language: "yaml", label: "YAML" },
    yml: { language: "yaml", label: "YAML" },
    sh: { language: "bash", label: "Shell" },
    bash: { language: "bash", label: "Shell" },
    sql: { language: "sql", label: "SQL" },
};

/** The file endings that open as code in the file viewer (Markdown and SVG have their own readers). */
export const CODE_EXTENSIONS: readonly string[] = Object.keys(CODE_BY_EXTENSION).filter(
    (extension) => !["md", "svg", "json"].includes(extension)
);

const PLAIN: CodeKind = { language: undefined, label: "Text" };

/** What a file's code is, from its ending. A file with another ending is plain text. */
export function codeKindOfExtension(extension: string): CodeKind {
    return CODE_BY_EXTENSION[extension.toLowerCase()] ?? PLAIN;
}

/** What a mini app's code is, from its kind: a page or an app is one HTML file, its styles and script inside it. */
export function codeKindOfArtifact(kind: string | undefined): CodeKind {
    if (kind === "app" || kind === "page") return CODE_BY_EXTENSION.html;
    if (kind === "svg") return CODE_BY_EXTENSION.svg;
    if (kind === "markdown") return CODE_BY_EXTENSION.md;
    return PLAIN;
}

/**
 * Code as its lines. Windows line ends read as plain ones, and the line end that closes a file does not open one more
 * line.
 */
export function codeLinesOf(code: string): string[] {
    return code.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
}

/** Code longer than this is shown without colors: coloring it would hold the page for too long. */
export const MAX_COLORED_CHARS = 300_000;

let highlighter: Promise<HLJSApi> | undefined;

/** The highlighter with only the languages above (about 21 KB compressed), loaded once, on first use. */
export function loadHighlighter(): Promise<HLJSApi> {
    highlighter ??= (async () => {
        const [core, xml, css, javascript, typescript, json, markdown, python, yaml, bash, sql] = await Promise.all([
            import("highlight.js/lib/core"),
            import("highlight.js/lib/languages/xml"),
            import("highlight.js/lib/languages/css"),
            import("highlight.js/lib/languages/javascript"),
            import("highlight.js/lib/languages/typescript"),
            import("highlight.js/lib/languages/json"),
            import("highlight.js/lib/languages/markdown"),
            import("highlight.js/lib/languages/python"),
            import("highlight.js/lib/languages/yaml"),
            import("highlight.js/lib/languages/bash"),
            import("highlight.js/lib/languages/sql"),
        ]);
        const hljs = core.default;
        const languages = { xml, css, javascript, typescript, json, markdown, python, yaml, bash, sql };
        for (const [name, language] of Object.entries(languages)) {
            if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language.default);
        }
        return hljs;
    })().catch((error) => {
        // A failed download (offline for a moment) is tried again the next time code is shown.
        highlighter = undefined;
        throw error;
    });
    return highlighter;
}

/**
 * Colored HTML cut into one piece per line. A colored part that runs over a line break (a comment, a long string) is
 * closed at the end of each line and opened again on the next, so every line stands on its own.
 */
export function splitColoredLines(html: string): string[] {
    const lines: string[] = [];
    const open: string[] = [];
    let line = "";
    const parts = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g;
    let part: RegExpExecArray | null;
    while ((part = parts.exec(html))) {
        if (part[1]) {
            open.push(part[1]);
            line += part[1];
        } else if (part[2]) {
            open.pop();
            line += part[2];
        } else if (part[3]) {
            lines.push(line + "</span>".repeat(open.length));
            line = open.join("");
        } else {
            line += part[4];
        }
    }
    lines.push(line);
    return lines;
}

/** The code as colored lines, or undefined when it is shown plain (no language, or too long to color). */
export function colorLines(hljs: HLJSApi, code: string, language: CodeLanguage | undefined): string[] | undefined {
    if (!language || code.length > MAX_COLORED_CHARS) return undefined;
    return splitColoredLines(hljs.highlight(code, { language, ignoreIllegals: true }).value);
}

const LANGUAGES: ReadonlySet<string> = new Set<CodeLanguage>([
    "xml",
    "css",
    "javascript",
    "typescript",
    "json",
    "markdown",
    "python",
    "yaml",
    "bash",
    "sql",
]);

/** The language a Markdown code block names ("```js", "```html", "```shell"), when it is one the code view knows. */
export function codeLanguageOfName(name: string | undefined): CodeLanguage | undefined {
    const lower = (name ?? "").toLowerCase();
    if (LANGUAGES.has(lower)) return lower as CodeLanguage;
    if (lower === "shell" || lower === "zsh") return "bash";
    return CODE_BY_EXTENSION[lower]?.language;
}

/**
 * Colors the code blocks of a Markdown file drawn inside this element. Only blocks that name a language the code view
 * knows are colored; the others stay as they are.
 */
export async function colorCodeBlocks(root: HTMLElement): Promise<void> {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code[data-code-language]"));
    if (blocks.length === 0) return;
    const hljs = await loadHighlighter();
    for (const block of blocks) {
        const language = codeLanguageOfName(block.dataset.codeLanguage);
        const code = block.textContent ?? "";
        if (!language || !block.isConnected || code.length > MAX_COLORED_CHARS) continue;
        // The highlighter writes the text back escaped, wrapped only in its own color spans.
        block.innerHTML = hljs.highlight(code, { language, ignoreIllegals: true }).value;
        block.removeAttribute("data-code-language");
        block.setAttribute("data-code-colored", "");
    }
}

/**
 * A Svelte action for an element that draws a Markdown text: colors its code blocks once it is drawn, and again when it
 * is drawn anew (the text it is given changes).
 */
export function coloredCodeBlocks(node: HTMLElement, _html: string): { update: (html: string) => void } {
    const color = () => {
        // After the new text is in place
        tick()
            .then(() => colorCodeBlocks(node))
            .catch((error) => console.warn("Could not color the code blocks", error));
    };
    color();
    return { update: color };
}
