import { ADMIN_URL } from "../Enum/EnvironmentVariable";
import { ArtifactRequestError, fetchArtifact, type ArtifactChat } from "./ArtifactApi";
import { artifactKindOf, type ArtifactCard } from "./artifactCard";

const LINK_PATH = /^\/a\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/**
 * The artifact a pasted link points to (game #1582): only Universe's own share address, `<Orbit>/a/<id>`, as
 * `artifactLink()` builds it. Any other site, even one that looks like it, is an ordinary link.
 */
export function artifactIdOfLink(url: string, orbitUrl: string | undefined = ADMIN_URL): string | undefined {
    if (!orbitUrl) return undefined;
    try {
        const link = new URL(url);
        // Orbit's address may leave out its scheme ("//orbit.example"): its host is what counts.
        const orbit = new URL(orbitUrl, "https://orbit.invalid");
        if (link.protocol !== "https:" && link.protocol !== "http:") return undefined;
        if (link.host !== orbit.host || link.search || link.hash) return undefined;
        return LINK_PATH.exec(link.pathname)?.[1].toLowerCase();
    } catch {
        return undefined;
    }
}

/** Kept while the game is open: one check per artifact and chat, however many times its link shows. */
const checked = new Map<string, Promise<ArtifactCard | undefined>>();

/**
 * The card a pasted artifact link shows, at its latest version, or undefined when this person may not open it from
 * here (or it is gone): then the link stays a plain link and nothing about the artifact is shown. Orbit decides, with
 * the same rules as tapping a bot's card.
 */
export function linkedArtifactCard(id: string, chat: ArtifactChat | undefined): Promise<ArtifactCard | undefined> {
    const key = `${id}|${chat?.kind ?? ""}|${chat?.ref ?? ""}`;
    const known = checked.get(key);
    if (known) return known;
    const card = fetchArtifact(id, chat).then(
        ({ artifact }): ArtifactCard => ({
            id,
            version: artifact.version,
            title: artifact.title,
            kind: artifactKindOf(artifact.kind),
            maker: artifact.makerName,
        }),
        (error: unknown) => {
            // Not reached (offline, the server failed): asked again next time it shows. Refused or gone: kept.
            if (!(error instanceof ArtifactRequestError && error.notAvailable)) checked.delete(key);
            return undefined;
        }
    );
    checked.set(key, card);
    return card;
}

/** Only for tests. */
export function forgetLinkedArtifacts(): void {
    checked.clear();
}
