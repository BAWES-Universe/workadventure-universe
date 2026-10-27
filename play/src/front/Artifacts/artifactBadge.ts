import type { TranslationFunctions } from "../../i18n/i18n-types";
import type { ArtifactKind } from "./artifactCard";

const COLORS: Record<ArtifactKind, string> = {
    app: "#7c3aed",
    page: "#2563eb",
    markdown: "#0f766e",
    svg: "#be185d",
};
const UNKNOWN_COLOR = "#5b6b82";

/** The badge of an artifact's icon: APP in violet for a mini app, other kinds in their own colour. */
export function artifactBadge(
    kind: ArtifactKind | undefined,
    texts: TranslationFunctions
): { label: string; color: string } {
    const chat = texts.chat.artifacts;
    switch (kind) {
        case "app":
            return { label: chat.badgeApp(), color: COLORS.app };
        case "page":
            return { label: chat.badgePage(), color: COLORS.page };
        case "markdown":
            return { label: chat.badgeMarkdown(), color: COLORS.markdown };
        case "svg":
            return { label: chat.badgeSvg(), color: COLORS.svg };
        default:
            return { label: chat.badgeApp(), color: UNKNOWN_COLOR };
    }
}

/** "Mini app", "Page"...: what the card says the artifact is. */
export function artifactKindName(kind: ArtifactKind | undefined, texts: TranslationFunctions): string {
    const chat = texts.chat.artifacts;
    switch (kind) {
        case "app":
            return chat.kindApp();
        case "page":
            return chat.kindPage();
        case "markdown":
            return chat.kindMarkdown();
        case "svg":
            return chat.kindSvg();
        default:
            return chat.kindUnknown();
    }
}
