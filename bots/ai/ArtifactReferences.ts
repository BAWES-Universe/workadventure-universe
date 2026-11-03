/**
 * Which artifacts a person pointed at (game #1781). A bot works with its own artifacts and the ones made in the chat it is
 * in; another bot's artifact opens only when the PERSON put it in their own words: they pasted its link, or replied to its
 * card. Orbit then lets that one id through for its owner. Only what the person wrote counts: what a bot said, and what a
 * tool or a file's text mentioned, never does, so no page or message can talk a bot into opening something else.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Universe's share address, `<Orbit>/a/<id>`, in a message. */
const LINK = new RegExp(`https?://[^\\s<>"'()]+/a/(${UUID})(?![0-9a-z-])`, 'gi');
/** A card as a line of nearby chat, `::artifact:<id>:<version>:<kind>::<title>`. */
const CARD_LINE = new RegExp(`::artifact:(${UUID}):`, 'gi');

/** A person can point at a few at once; Orbit takes no more than this. */
export const MAX_POINTED_ARTIFACTS = 20;

/** The artifact ids a message names: a pasted share link or a card line, in the order they appear, each once. */
export function artifactIdsIn(text: string | undefined | null): string[] {
    if (!text) return [];
    const ids: string[] = [];
    for (const pattern of [LINK, CARD_LINE]) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) ids.push(match[1].toLowerCase());
    }
    return [...new Set(ids)];
}

/** The id a replied-to card carries: a direct message's `universe.artifact` field. */
export function artifactIdOfCard(field: unknown): string | undefined {
    const id = typeof field === 'object' && field !== null ? (field as { id?: unknown }).id : undefined;
    return typeof id === 'string' && new RegExp(`^${UUID}$`, 'i').test(id) ? id.toLowerCase() : undefined;
}

/**
 * What the person pointed at: in the messages they wrote in the recent window of this chat (the ones the bot reads), and the
 * card they replied to in this turn. The newest first, at most what Orbit takes. Lines the bot wrote are never read.
 */
export function pointedArtifactIds(history: ReadonlyArray<{ sender: 'bot' | 'person'; message: string }> | undefined, replied: readonly string[] = []): string[] {
    const ids: string[] = [...replied];
    for (let i = (history?.length ?? 0) - 1; i >= 0 && ids.length < MAX_POINTED_ARTIFACTS * 2; i--) {
        if (history![i].sender === 'person') ids.push(...artifactIdsIn(history![i].message));
    }
    return [...new Set(ids)].slice(0, MAX_POINTED_ARTIFACTS);
}
