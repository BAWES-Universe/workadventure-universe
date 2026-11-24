import { derived } from "svelte/store";
import type { Readable } from "svelte/store";
import { visitingWith } from "./BrickVisit";

/**
 * The caption a visiting Brick shows under its name (game #2005): "with <person>". Follows the world's user list (the tags
 * come with it, and change in place) and the language, so a caption is rebuilt when either one changes.
 */
export function visitingCaptionStore(
    users: Readable<ReadonlyMap<string, { uuid?: string; tags?: readonly string[] }> | undefined>,
    words: Readable<{ chat: { brick: { visitingWith: (parameters: { name: string }) => string } } }>,
    botUuid: string
): Readable<string | undefined> {
    return derived([users, words], ([$users, $words]) => {
        const user = [...($users?.values() ?? [])].find((candidate) => candidate.uuid === botUuid);
        const name = visitingWith(user?.tags);
        return name ? $words.chat.brick.visitingWith({ name }) : undefined;
    });
}
