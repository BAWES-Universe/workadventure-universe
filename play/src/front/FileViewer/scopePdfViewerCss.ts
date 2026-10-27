import postcss from "postcss";

/**
 * The class on the PDF reader's root element. The reader's stylesheet only applies inside it, once the build has run
 * it through scopePdfViewerCss.
 */
export const PDF_VIEWER_SCOPE_CLASS = "pdfjs-scope";

const SCOPE = `:where(.${PDF_VIEWER_SCOPE_CLASS})`;

/** A rule written inside another rule (CSS nesting) is already relative to that rule, so only the outer one moves. */
function isNested(rule: postcss.Rule): boolean {
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
        if (parent.type === "rule") return true;
        // The steps of an animation ("from", "50%") are not selectors.
        if (parent.type === "atrule" && /keyframes$/i.test((parent as postcss.AtRule).name)) return true;
    }
    return false;
}

/**
 * PDF.js's stylesheet is written for a page of its own: it styles plain class names such as .sidebar, .dialog and
 * .toggle-button for the whole page. Loaded into the game, its .sidebar rule turned the map editor's panel into a
 * 239px grey box. This puts every rule under the reader's root (:where keeps each rule as strong as it was, so the
 * file viewer's own overrides still win), and its :root variables on that root.
 */
export function scopePdfViewerCss(css: string): string {
    const root = postcss.parse(css);
    root.walkRules((rule) => {
        if (isNested(rule)) return;
        rule.selectors = rule.selectors.map((selector) =>
            selector.startsWith(":root") ? SCOPE + selector.slice(":root".length) : `${SCOPE} ${selector}`
        );
    });
    return root.toString();
}
