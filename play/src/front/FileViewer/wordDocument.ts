import DOMPurify from "dompurify";

/** A Word file is read in memory; a file far bigger than any document is offered as a download instead. */
export const MAX_WORD_BYTES = 30 * 1024 * 1024;

/**
 * The rules of the sealed page the document is drawn in. Nothing can be fetched from anywhere: no address is
 * allowed except pictures and fonts that sit inside the page itself (data addresses), and no script can run.
 */
export const WORD_PAGE_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

export interface RenderedWord {
    /** The full page text for the sealed frame (its `srcdoc`). */
    srcdoc: string;
    /** The width of a page in pixels, at 100%. */
    pageWidth: number;
    pageCount: number;
}

// Its own sanitizer, so these settings never touch the chat's.
const purify = DOMPurify(window);

const SAFE_PICTURE = /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|x-emf|x-wmf|tiff);base64,/i;
const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

/**
 * Makes the drawn pages safe to hand to the frame. Only pictures stored inside the file stay (docx-preview turns
 * them into data addresses), links keep only web, mail and phone addresses, and everything that could load or run
 * something is removed. The pages are parsed inert: nothing loads here.
 */
export function cleanPages(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = purify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: [
            "script",
            "iframe",
            "object",
            "embed",
            "form",
            "input",
            "button",
            "textarea",
            "select",
            "video",
            "audio",
            "source",
            "track",
            "link",
            "meta",
            "base",
            "style",
        ],
        FORBID_ATTR: ["srcset", "poster", "background", "formaction", "action"],
        ALLOW_DATA_ATTR: false,
    });
    for (const picture of Array.from(template.content.querySelectorAll("img"))) {
        if (!SAFE_PICTURE.test((picture.getAttribute("src") ?? "").trim())) picture.remove();
    }
    for (const link of Array.from(template.content.querySelectorAll("a"))) {
        const href = (link.getAttribute("href") ?? "").trim();
        if (SAFE_LINK.test(href)) {
            link.setAttribute("target", "_blank");
            link.setAttribute("rel", "noopener noreferrer");
        } else {
            link.removeAttribute("href");
            link.removeAttribute("target");
        }
    }
    return template.innerHTML;
}

/** The look of the sealed page around the document: the viewer's dark desk with white sheets on it. */
const PAGE_FRAME_STYLE = `
html{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%}
body{margin:0;background:#3a3950}
.docx-wrapper{background:#3a3950!important;padding:16px 16px 2px!important}
.docx-wrapper>section.docx{box-shadow:0 4px 14px rgba(0,0,0,.35)!important;margin-bottom:14px!important;border-radius:3px}
a{cursor:pointer}
`;

function pageWidthOf(pages: HTMLElement | undefined): number {
    // docx-preview gives each sheet its width from the file, in points (or pixels).
    const width = pages?.style.width ?? "";
    const value = Number.parseFloat(width);
    if (!Number.isFinite(value) || value <= 0) return 816;
    return width.endsWith("pt") ? (value * 96) / 72 : value;
}

/**
 * Draws a .docx into a detached page and returns the text for the sealed frame. docx-preview is loaded on the first
 * Word file only. Throws when the file is not a readable Word file (damaged, locked, or another kind of file).
 */
export async function renderWordDocument(bytes: ArrayBuffer): Promise<RenderedWord> {
    const { renderAsync } = await import("docx-preview");
    const body = document.createElement("div");
    const styles = document.createElement("div");
    await renderAsync(bytes, body, styles, {
        inWrapper: true,
        breakPages: true,
        ignoreFonts: true,
        // Pictures inside the file become data addresses: nothing is stored as an object address the page keeps.
        useBase64URL: true,
        // What a file could use to bring in outside content or text that is not the document's own.
        renderAltChunks: false,
        renderComments: false,
        renderChanges: false,
        experimental: false,
        debug: false,
    });
    const sheets = Array.from(body.querySelectorAll<HTMLElement>("section.docx"));
    if (sheets.length === 0) throw new Error("The file has no pages to show");
    const pageWidth = pageWidthOf(sheets[0]);
    const css = Array.from(styles.querySelectorAll("style"))
        // Fonts and pictures in the file's styles may only be data addresses, like everything else in the frame.
        .map((style) => style.textContent ?? "")
        .join("\n")
        .replace(/@import[^;]*;/gi, "")
        // Only data addresses stay in the styles, and the text can never close its own style tag.
        .replace(/url\(\s*(?!["']?data:)[^)]*\)/gi, "none")
        .replace(/<\/style/gi, "<\\/style");
    const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WORD_PAGE_POLICY}"><style>${css}</style><style>${PAGE_FRAME_STYLE}</style></head><body>${cleanPages(
        body.innerHTML
    )}</body></html>`;
    return { srcdoc, pageWidth, pageCount: sheets.length };
}
