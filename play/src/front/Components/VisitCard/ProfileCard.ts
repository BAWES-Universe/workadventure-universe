import { readable, type Readable } from "svelte/store";
import { profileMemory } from "../../Chat/Stores/ProfileMemory";

export interface ProfileCardLink {
    label: string;
    url: string;
}

export interface ProfileCardStamp {
    world: string;
    visits: number;
    /** The universe's colour, as Orbit gives it. */
    colour: string;
    /** A word too long for its stamp gets smaller type. */
    long: "long" | "longer" | undefined;
}

export interface ProfileCardData {
    bio: string;
    links: ProfileCardLink[];
    stamps: ProfileCardStamp[];
}

/**
 * What a card shows: loading (only the first time someone is seen), the card itself (null: nothing written, no links,
 * no stamps), or Orbit's own page in a frame, as before, when the card can't be read as data (signed out, Orbit down).
 */
export type ProfileCardState = { kind: "loading" } | { kind: "card"; card: ProfileCardData | null } | { kind: "frame" };

const PROFILE_PATH = /^\/api\/profile\/([^/]+)\/?$/;
const COLOUR = /^#[0-9a-f]{3,8}$/i;
const FALLBACK_COLOUR = "#8b5cf6";

/** The person an Orbit profile card is for, or undefined for any other page (another site, another Orbit). */
export function orbitProfileUuid(cardUrl: string, orbitOrigin: string | null, base: string): string | undefined {
    if (!orbitOrigin) return undefined;
    try {
        const url = new URL(cardUrl, base);
        if (url.origin !== orbitOrigin) return undefined;
        const match = PROFILE_PATH.exec(url.pathname);
        return match ? decodeURIComponent(match[1]) : undefined;
    } catch {
        return undefined;
    }
}

const isWebLink = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url);

/** Orbit's answer as a card, null when there is nothing to show; undefined when it isn't a card at all. */
export function parseProfileCard(answer: unknown): ProfileCardData | null | undefined {
    if (typeof answer !== "object" || answer === null) return undefined;
    const data = answer as { bio?: unknown; links?: unknown; stamps?: unknown };
    const bio = typeof data.bio === "string" ? data.bio : "";
    const links = (Array.isArray(data.links) ? data.links : []).flatMap((link: { label?: unknown; url?: unknown }) =>
        isWebLink(link?.url) ? [{ label: typeof link.label === "string" ? link.label : link.url, url: link.url }] : []
    );
    const stamps = (Array.isArray(data.stamps) ? data.stamps : []).flatMap(
        (stamp: { world?: unknown; visits?: unknown; colour?: unknown; long?: unknown }): ProfileCardStamp[] =>
            typeof stamp?.world === "string"
                ? [
                      {
                          world: stamp.world,
                          visits: typeof stamp.visits === "number" ? stamp.visits : 0,
                          colour:
                              typeof stamp.colour === "string" && COLOUR.test(stamp.colour)
                                  ? stamp.colour
                                  : FALLBACK_COLOUR,
                          long: stamp.long === "long" || stamp.long === "longer" ? stamp.long : undefined,
                      },
                  ]
                : []
    );
    if (!bio.trim() && links.length === 0 && stamps.length === 0) return null;
    return { bio, links, stamps };
}

const cards = profileMemory<ProfileCardData | null>();

/**
 * Someone's card, kept while the player is in the game (#1585): the card seen last shows at once and is asked again
 * each time, and only a card that changed is shown again. The first time, it loads; when Orbit can't answer and
 * nothing was kept, the card shows as Orbit's page in a frame, as it always did.
 *
 * `ask` answers Orbit's data, null for "no profile", undefined for no answer.
 */
export function profileCardStore(uuid: string, ask: (uuid: string) => Promise<unknown>): Readable<ProfileCardState> {
    const kept = (): ProfileCardState =>
        cards.has(uuid) ? { kind: "card", card: cards.get(uuid) ?? null } : { kind: "loading" };
    return readable<ProfileCardState>(kept(), (set) => {
        let open = true;
        let shown = kept();
        set(shown);
        const unanswered = () => {
            if (open && !cards.has(uuid)) set({ kind: "frame" });
        };
        ask(uuid)
            .then((answer) => {
                const card = answer === null ? null : answer === undefined ? undefined : parseProfileCard(answer);
                if (card === undefined) return unanswered();
                cards.set(uuid, card);
                const next: ProfileCardState = { kind: "card", card };
                if (!open || JSON.stringify(next) === JSON.stringify(shown)) return;
                shown = next;
                set(next);
            })
            .catch((error) => {
                console.error("Failed to read the profile card", error);
                unanswered();
            });
        return () => {
            open = false;
        };
    });
}
